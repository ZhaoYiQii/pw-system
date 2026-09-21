/**
 * 算价模型 Task 4：报名 / 锁定 / 释放名额 / 违约记录（设计规格 §3.5、§6、§9 第 3 条）。
 *
 * 覆盖：
 * - 选中前陪玩可自助取消并可再次报名；选中（老板锁定）后自助取消返回受控 409（APPLICATION_LOCKED）；
 * - 商家「释放名额」：档位标记 RELEASED、订单回到报名阶段、重开一轮报名、原陪玩可再次报名；
 *   释放后的档位不再计入该单需要服务的人数；
 * - 违约记录写库 + 审计 + 经 Outbox 通知老板（客户侧站内通知可见）；
 * - 权限矩阵（陪玩/客户不能释放名额或记违约）与租户隔离（别家租户 404）；
 * - 陪玩端读路径（大厅可报名行 / 我的报名含 canWithdraw）。
 */
import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { drainOutbox } from "../../apps/api/src/modules/notifications/outbox.relay.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Application-Rules-Password-1";
const suffix = Date.now().toString(36);
const tenantCode = `ar_${suffix}`;
const otherTenantCode = `arb_${suffix}`;
const TEMPLATES = "/api/v1/tenant/game-templates";
const DISPATCH = "/api/v1/tenant/game-dispatch";
const PRICING = "/api/v1/tenant/game-pricing";

interface HallLine {
  lineId: string;
  positionLabel: string;
  requiredCount: number;
  appliedCount: number;
  myApplicationId: string | null;
  myApplicationStatus: string | null;
}
interface HallOrder {
  orderId: string;
  dispatchNo: string;
  orderNo: string;
  durationMinutes: number;
  roundClosesAt: string | null;
  /** 单价（分/小时，陪玩×游戏底价 + 命中加价；不乘时长）。 */
  unitPriceFen: string | null;
  lines: HallLine[];
}
interface MyApplication {
  applicationId: string;
  orderId: string;
  orderStatus: string;
  positionLabel: string;
  status: string;
  slotId: string | null;
  canWithdraw: boolean;
  unitPriceFen: string | null;
}
interface ReleaseView {
  slotId: string;
  orderId: string;
  orderStatus: string;
  roundNo: number;
}
interface BreachView {
  id: string;
  playerId: string;
  orderId: string;
  orderSlotId: string | null;
  reason: string;
}

describe("算价模型 Task 4：报名锁定、释放名额与违约记录", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId = "";
  let otherTenantId = "";
  let gameId = "";
  let ownerToken = "";
  let csToken = "";
  let otherOwnerToken = "";
  let customerToken = "";
  let playerTokens: Record<string, string> = {};
  let playerIds: Record<string, string> = {};
  let customerId = "";
  let templateId = "";
  /** Slice 0 列表筛选用例的「另一个游戏」，用来验证 gameId 过滤。 */
  let otherGameId = "";

  beforeAll(async () => {
    client = createDatabaseClient(
      process.env.PW_TEST_MIGRATION_URL ??
        (() => {
          throw new Error("missing env PW_TEST_MIGRATION_URL");
        })(),
    );
    const hash = await hashPassword(PW);
    const tenant = await client.tenant.create({
      data: { code: tenantCode, name: "报名规则测试店" },
    });
    tenantId = tenant.id;
    const other = await client.tenant.create({
      data: { code: otherTenantCode, name: "报名规则别家店" },
    });
    otherTenantId = other.id;

    async function addAccount(tid: string, username: string, role: string) {
      const account = await client.tenantAccount.create({
        data: { tenantId: tid, username, passwordHash: hash },
      });
      await client.tenantAccountRole.create({
        data: {
          tenantId: tid,
          tenantAccountId: account.id,
          role: role as never,
        },
      });
      return account;
    }

    await addAccount(tenantId, "boss", "TENANT_OWNER");
    await addAccount(tenantId, "cs", "CUSTOMER_SERVICE");
    await addAccount(otherTenantId, "boss", "TENANT_OWNER");
    const p1 = await addAccount(tenantId, `a1_${suffix}`, "PLAYER");
    const p2 = await addAccount(tenantId, `a2_${suffix}`, "PLAYER");
    const profile1 = await client.playerProfile.create({
      data: {
        tenantId,
        name: "阿一",
        tenantAccountId: p1.id,
        basePricePerHourFen: 6000n,
      },
    });
    const profile2 = await client.playerProfile.create({
      data: {
        tenantId,
        name: "阿二",
        tenantAccountId: p2.id,
        basePricePerHourFen: 6000n,
      },
    });
    playerIds = { p1: profile1.id, p2: profile2.id };

    const customer = await client.customerProfile.create({
      data: { tenantId, name: "报名规则老板" },
    });
    customerId = customer.id;
    const customerAccount = await addAccount(
      tenantId,
      `cb_${suffix}`,
      "CUSTOMER",
    );
    await client.customerProfile.update({
      where: { id: customer.id },
      data: { tenantAccountId: customerAccount.id },
    });

    const game = await client.game.create({
      data: { tenantId, name: `英雄联盟-${suffix}` },
    });
    gameId = game.id;
    const otherGame = await client.game.create({
      data: { tenantId, name: `无畏契约-${suffix}` },
    });
    otherGameId = otherGame.id;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(username: string, code = tenantCode): Promise<string> {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ kind: "tenant", tenantCode: code, username, password: PW })
        .expect(201);
      return (res.body as { data: { accessToken: string } }).data.accessToken;
    }

    ownerToken = await login("boss");
    csToken = await login("cs");
    otherOwnerToken = await login("boss", otherTenantCode);
    customerToken = await login(`cb_${suffix}`);
    playerTokens = {
      p1: await login(`a1_${suffix}`),
      p2: await login(`a2_${suffix}`),
    };

    const template = await request(app.getHttpServer())
      .post(TEMPLATES)
      .set("authorization", `Bearer ${ownerToken}`)
      .send({
        name: `报名规则模板-${suffix}`,
        fields: [
          {
            fieldKey: "rank",
            label: "目标段位",
            fieldType: "select",
            options: ["钻石"],
          },
        ],
        positions: [{ label: "打野", defaultCount: 1 }],
      })
      .expect(201);
    templateId = (template.body as { data: { id: string } }).data.id;
    await client.gameDispatchTemplate.update({
      where: { id: templateId },
      data: { gameId },
    });
    await request(app.getHttpServer())
      .put(`${PRICING}/games/${gameId}`)
      .set("authorization", `Bearer ${ownerToken}`)
      .send({ items: [{ dimensionKey: "rank=钻石", amountFen: "1000" }] })
      .expect(200);
  });

  afterAll(async () => {
    if (client) {
      const tids = [tenantId, otherTenantId].filter((t) => t !== "");
      for (const tid of tids) {
        await client.settlementItem.deleteMany({ where: { tenantId: tid } });
        await client.settlementBatch.deleteMany({ where: { tenantId: tid } });
        await client.slotEvidence.deleteMany({ where: { tenantId: tid } });
        await client.slotSession.deleteMany({ where: { tenantId: tid } });
        await client.slotEarning.deleteMany({ where: { tenantId: tid } });
        await client.playerBreachRecord.deleteMany({
          where: { tenantId: tid },
        });
        await client.orderSlot.deleteMany({ where: { tenantId: tid } });
        await client.gameDispatchApplication.deleteMany({
          where: { tenantId: tid },
        });
        await client.gameDispatchRound.deleteMany({ where: { tenantId: tid } });
        await client.gameDispatchLine.deleteMany({ where: { tenantId: tid } });
        await client.gameDispatchOrder.deleteMany({ where: { tenantId: tid } });
        await client.gameDispatchTemplateSnapshot.deleteMany({
          where: { tenantId: tid },
        });
        await client.gamePricingRuleItem.deleteMany({
          where: { tenantId: tid },
        });
        await client.gamePricingRule.deleteMany({ where: { tenantId: tid } });
        await client.orderRequirement.deleteMany({ where: { tenantId: tid } });
        await client.orderEvent.deleteMany({ where: { tenantId: tid } });
        await client.auditLog.deleteMany({ where: { tenantId: tid } });
        await client.notificationDelivery.deleteMany({
          where: { tenantId: tid },
        });
        await client.outboxEvent.deleteMany({ where: { tenantId: tid } });
        await client.order.deleteMany({ where: { tenantId: tid } });
        await client.playerProfile.deleteMany({ where: { tenantId: tid } });
        await client.walletEntry.deleteMany({ where: { tenantId: tid } });
        await client.paymentOrder.deleteMany({ where: { tenantId: tid } });
        await client.bossWallet.deleteMany({ where: { tenantId: tid } });
        await client.customerProfile.deleteMany({ where: { tenantId: tid } });
        await client.gameDispatchRankRule.deleteMany({
          where: { tenantId: tid },
        });
        await client.gameDispatchPosition.deleteMany({
          where: { tenantId: tid },
        });
        await client.gameDispatchTemplateField.deleteMany({
          where: { tenantId: tid },
        });
        await client.gameDispatchTemplate.deleteMany({
          where: { tenantId: tid },
        });
        await client.game.deleteMany({ where: { tenantId: tid } });
        const accounts = await client.tenantAccount.findMany({
          where: { tenantId: tid },
          select: { id: true },
        });
        await client.refreshSession.deleteMany({
          where: { accountId: { in: accounts.map((a) => a.id) } },
        });
        await client.tenantAccountRole.deleteMany({ where: { tenantId: tid } });
        await client.tenantAccount.deleteMany({ where: { tenantId: tid } });
        await client.tenantEntitlement.deleteMany({ where: { tenantId: tid } });
        await client.tenant.deleteMany({ where: { id: tid } });
      }
      await client.$disconnect();
    }
    if (app) await app.close();
  });

  function req(token: string) {
    const h = { authorization: `Bearer ${token}` };
    return {
      get: (u: string) => request(app.getHttpServer()).get(u).set(h),
      post: (u: string, b?: unknown) =>
        request(app.getHttpServer())
          .post(u)
          .set(h)
          .send(b ?? {}),
    };
  }

  /** 建单 → 发布：返回订单 id 与「打野」行的 lineId（报名通道已开）。 */
  async function publishedOrder() {
    const draft = await req(ownerToken)
      .post(`${DISPATCH}/orders`, {
        templateId,
        customerProfileId: customerId,
        formValues: { rank: "钻石" },
        durationMinutes: 60,
        lines: [{ positionLabel: "打野", requiredCount: 1 }],
      })
      .expect(201);
    const orderId = (draft.body as { data: { orderId: string } }).data.orderId;
    const published = await req(ownerToken)
      .post(`${DISPATCH}/orders/${orderId}/publish`)
      .expect(201);
    const lineId = (published.body as { data: { lines: { id: string }[] } })
      .data.lines[0]?.id;
    if (!lineId) throw new Error("发布后没有位置行");
    return { orderId, lineId };
  }

  function apply(token: string, orderId: string, lineId: string) {
    return req(token).post(
      `${DISPATCH}/orders/${orderId}/lines/${lineId}/applications`,
    );
  }

  async function hireOwnerSelected(orderId: string, player: "p1" | "p2") {
    const apps = (
      await req(ownerToken)
        .get(`${DISPATCH}/orders/${orderId}/applications`)
        .expect(200)
    ).body.data as {
      applications: { id: string; playerId: string; status: string }[];
    }[];
    const applicationIds = apps
      .flatMap((line) => line.applications)
      // 只选该陪玩当前仍有效的报名（历史 WITHDRAWN/RELEASED 行不参与选人）。
      .filter((a) => a.playerId === playerIds[player] && a.status === "APPLIED")
      .map((a) => a.id);
    await req(customerToken)
      .post("/api/v1/boss/wallet/recharge", { amountFen: "100000" })
      .expect(201);
    await req(ownerToken)
      .post(`${DISPATCH}/orders/${orderId}/assignment`, { applicationIds })
      .expect(201);
    return applicationIds;
  }

  it("大厅与我的报名读路径：未选中可自助取消并可再次报名", async () => {
    const { orderId, lineId } = await publishedOrder();

    const hall = (
      await req(playerTokens["p1"]).get(`${DISPATCH}/player/hall`).expect(200)
    ).body.data as HallOrder[];
    const hallOrder = hall.find((o) => o.orderId === orderId);
    expect(hallOrder).toBeTruthy();
    const hallLine = hallOrder?.lines.find((l) => l.lineId === lineId);
    expect(hallLine?.positionLabel).toBe("打野");
    expect(hallLine?.appliedCount).toBe(0);
    expect(hallLine?.myApplicationId).toBeNull();
    // 展示口径（设计规格 §3.4）：报名界面显示单价（底价 6000 + rank=钻石 1000），不乘时长。
    expect(hallOrder?.unitPriceFen).toBe("7000");

    const applied = await apply(playerTokens["p1"], orderId, lineId).expect(
      201,
    );
    const applicationId = (applied.body as { data: { id: string } }).data.id;

    const mine = (
      await req(playerTokens["p1"])
        .get(`${DISPATCH}/player/applications`)
        .expect(200)
    ).body.data as MyApplication[];
    const mineRow = mine.find((a) => a.applicationId === applicationId);
    expect(mineRow?.status).toBe("APPLIED");
    expect(mineRow?.canWithdraw).toBe(true);
    expect(mineRow?.slotId).toBeNull();
    expect(mineRow?.unitPriceFen).toBe("7000");

    await req(playerTokens["p1"])
      .post(`${DISPATCH}/applications/${applicationId}/withdraw`)
      .expect(201);
    const withdrawn = await client.gameDispatchApplication.findFirstOrThrow({
      where: { tenantId, id: applicationId },
    });
    expect(withdrawn.status).toBe("WITHDRAWN");

    // 取消后可再次报名（同一轮内刷新）。
    await apply(playerTokens["p1"], orderId, lineId).expect(201);
    const reApplied = await client.gameDispatchApplication.findFirstOrThrow({
      where: { tenantId, id: applicationId },
    });
    expect(reApplied.status).toBe("APPLIED");
  });

  it("选中后自助取消返回受控 409（APPLICATION_LOCKED），档位与报名保持不变", async () => {
    const { orderId, lineId } = await publishedOrder();
    await apply(playerTokens["p1"], orderId, lineId).expect(201);
    const [applicationId] = await hireOwnerSelected(orderId, "p1");

    const order = await client.order.findFirstOrThrow({
      where: { id: orderId },
    });
    expect(order.status).toBe("ASSIGNED");
    const slot = await client.orderSlot.findFirstOrThrow({
      where: { tenantId, applicationId },
    });
    expect(slot.status).toBe("SELECTED");

    const mine = (
      await req(playerTokens["p1"])
        .get(`${DISPATCH}/player/applications`)
        .expect(200)
    ).body.data as MyApplication[];
    const mineRow = mine.find((a) => a.applicationId === applicationId);
    expect(mineRow?.canWithdraw).toBe(false);
    expect(mineRow?.slotId).toBe(slot.id);
    // 已选中的订单不再出现在报名大厅。
    const hall = (
      await req(playerTokens["p1"]).get(`${DISPATCH}/player/hall`).expect(200)
    ).body.data as HallOrder[];
    expect(hall.some((o) => o.orderId === orderId)).toBe(false);

    const locked = await req(playerTokens["p1"])
      .post(`${DISPATCH}/applications/${applicationId}/withdraw`)
      .expect(409);
    expect((locked.body as { message: string }).message).toContain(
      "APPLICATION_LOCKED",
    );

    // 服务端状态没有被改动：报名仍是 SELECTED，档位仍是 SELECTED。
    const unchangedApp = await client.gameDispatchApplication.findFirstOrThrow({
      where: { tenantId, id: applicationId },
    });
    expect(unchangedApp.status).toBe("SELECTED");
    const unchangedSlot = await client.orderSlot.findFirstOrThrow({
      where: { tenantId, id: slot.id },
    });
    expect(unchangedSlot.status).toBe("SELECTED");
  });

  it("商家释放名额：订单回到报名阶段、重开一轮、原陪玩可再次报名并被重新选中", async () => {
    const { orderId, lineId } = await publishedOrder();
    await apply(playerTokens["p1"], orderId, lineId).expect(201);
    const [applicationId] = await hireOwnerSelected(orderId, "p1");
    const slot = await client.orderSlot.findFirstOrThrow({
      where: { tenantId, applicationId },
    });

    // 陪玩没有释放名额的权限（gameDispatch.manage）。
    await req(playerTokens["p1"])
      .post(`${DISPATCH}/slots/${slot.id}/release`)
      .expect(403);

    const released = await req(csToken)
      .post(`${DISPATCH}/slots/${slot.id}/release`, { reason: "陪玩申请换班" })
      .expect(201);
    const view = (released.body as { data: ReleaseView }).data;
    expect(view.orderId).toBe(orderId);
    expect(view.orderStatus).toBe("DISPATCHING");
    expect(view.roundNo).toBe(2);

    const releasedSlot = await client.orderSlot.findFirstOrThrow({
      where: { tenantId, id: slot.id },
    });
    expect(releasedSlot.status).toBe("RELEASED");
    const releasedApp = await client.gameDispatchApplication.findFirstOrThrow({
      where: { tenantId, id: applicationId },
    });
    expect(releasedApp.status).toBe("RELEASED");
    const order = await client.order.findFirstOrThrow({
      where: { id: orderId },
    });
    expect(order.status).toBe("DISPATCHING");
    const rounds = await client.gameDispatchRound.findMany({
      where: { tenantId, orderId },
      orderBy: { roundNo: "asc" },
    });
    expect(rounds.map((r) => r.roundNo)).toEqual([1, 2]);
    expect(rounds[1]?.status).toBe("OPEN");
    const event = await client.orderEvent.findFirstOrThrow({
      where: { tenantId, orderId, eventType: "GAME_DISPATCH_SLOT_RELEASED" },
    });
    expect(event.fromStatus).toBe("ASSIGNED");
    expect(event.toStatus).toBe("DISPATCHING");
    expect(
      await client.auditLog.count({
        where: {
          tenantId,
          resourceId: slot.id,
          action: "game_dispatch.slot_release",
        },
      }),
    ).toBe(1);
    // 重复释放被拒。
    await req(ownerToken)
      .post(`${DISPATCH}/slots/${slot.id}/release`)
      .expect(409);

    // 原陪玩在新一轮重新报名，并被商家重新选中；释放的档位不再计入该单人数。
    const reapplied = await apply(playerTokens["p1"], orderId, lineId).expect(
      201,
    );
    const newApplicationId = (reapplied.body as { data: { id: string } }).data
      .id;
    expect(newApplicationId).not.toBe(applicationId);
    await hireOwnerSelected(orderId, "p1");
    const afterOrder = await client.order.findFirstOrThrow({
      where: { id: orderId },
    });
    expect(afterOrder.status).toBe("ASSIGNED");
    const activeSlots = await client.orderSlot.findMany({
      where: { tenantId, orderId, status: { not: "RELEASED" } },
    });
    expect(activeSlots).toHaveLength(1);
    expect(activeSlots[0]?.applicationId).toBe(newApplicationId);
    expect(activeSlots[0]?.status).toBe("SELECTED");
  });

  it("记录违约：写库 + 审计 + 经 Outbox 通知老板（客户站内通知可见）", async () => {
    const { orderId, lineId } = await publishedOrder();
    await apply(playerTokens["p1"], orderId, lineId).expect(201);
    const [applicationId] = await hireOwnerSelected(orderId, "p1");
    const slot = await client.orderSlot.findFirstOrThrow({
      where: { tenantId, applicationId },
    });

    const created = await req(csToken)
      .post(`${DISPATCH}/orders/${orderId}/player-breaches`, {
        playerId: playerIds["p1"],
        orderSlotId: slot.id,
        reason: "约定时间未到场",
      })
      .expect(201);
    const breach = (created.body as { data: BreachView }).data;
    expect(breach.orderId).toBe(orderId);
    expect(breach.playerId).toBe(playerIds["p1"]);
    expect(breach.orderSlotId).toBe(slot.id);
    expect(breach.reason).toBe("约定时间未到场");

    const rows = await client.playerBreachRecord.findMany({
      where: { tenantId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.recordedBy).not.toBeNull();
    expect(
      await client.auditLog.count({
        where: {
          tenantId,
          resourceId: playerIds["p1"],
          action: "game_dispatch.player_breach",
        },
      }),
    ).toBe(1);

    // 通知走既有 Outbox → 站内通知链路，老板（客户）在自己的通知列表里能看到。
    const outbox = await client.outboxEvent.findFirstOrThrow({
      where: { tenantId, eventType: "player.breach.recorded" },
    });
    expect(outbox.aggregateId).toBe(orderId);
    await drainOutbox(client, 20, tenantId);
    const delivered = await client.notificationDelivery.findFirstOrThrow({
      where: { tenantId, recipientType: "order", recipientId: orderId },
    });
    expect(delivered.title ?? "").toContain("违约");
    const notifications = (
      await req(customerToken).get("/api/v1/tenant/notifications").expect(200)
    ).body.data as { id: string; title: string | null }[];
    expect(notifications.some((n) => (n.title ?? "").includes("违约"))).toBe(
      true,
    );

    // 输入边界：理由必填、档位必须属于该陪玩。
    await req(csToken)
      .post(`${DISPATCH}/orders/${orderId}/player-breaches`, {
        playerId: playerIds["p1"],
        reason: "   ",
      })
      .expect(400);
    await req(csToken)
      .post(`${DISPATCH}/orders/${orderId}/player-breaches`, {
        playerId: playerIds["p2"],
        orderSlotId: slot.id,
        reason: "不属于该陪玩的档位",
      })
      .expect(400);
  });

  it("权限与租户隔离：陪玩/客户不能释放或记违约，别家租户 404", async () => {
    const { orderId, lineId } = await publishedOrder();
    await apply(playerTokens["p1"], orderId, lineId).expect(201);
    const [applicationId] = await hireOwnerSelected(orderId, "p1");
    const slot = await client.orderSlot.findFirstOrThrow({
      where: { tenantId, applicationId },
    });

    await req(playerTokens["p1"])
      .post(`${DISPATCH}/slots/${slot.id}/release`)
      .expect(403);
    await req(customerToken)
      .post(`${DISPATCH}/slots/${slot.id}/release`)
      .expect(403);
    await req(playerTokens["p1"])
      .post(`${DISPATCH}/orders/${orderId}/player-breaches`, {
        playerId: playerIds["p1"],
        reason: "陪玩不能记违约",
      })
      .expect(403);

    await req(otherOwnerToken)
      .post(`${DISPATCH}/slots/${slot.id}/release`)
      .expect(404);
    await req(otherOwnerToken)
      .post(`${DISPATCH}/orders/${orderId}/player-breaches`, {
        playerId: playerIds["p1"],
        reason: "别家租户",
      })
      .expect(404);
    // 别家租户的两次尝试都没有落地记录（本单在本租户下也没有违约记录）。
    expect(
      await client.playerBreachRecord.count({ where: { tenantId, orderId } }),
    ).toBe(0);
  });

  it("商家端可见性：派单详情带档位 id，违约记录可按订单/陪玩过滤", async () => {
    const { orderId, lineId } = await publishedOrder();
    await apply(playerTokens["p1"], orderId, lineId).expect(201);
    const [applicationId] = await hireOwnerSelected(orderId, "p1");
    const slot = await client.orderSlot.findFirstOrThrow({
      where: { tenantId, applicationId },
    });

    // 派单详情：已选中的报名要带档位 id，商家端才能点「释放名额」。
    const detail = (
      await req(ownerToken).get(`${DISPATCH}/orders/${orderId}`).expect(200)
    ).body.data as {
      lines: {
        applications: {
          id: string;
          slotId: string | null;
          unitPriceFen: string | null;
        }[];
      }[];
      settlement: {
        orderAmountFen: string;
        playerShareFen: string;
        storeProfitFen: string;
        storeCutFen: string | null;
        platformFeeFen: string | null;
        splitApplied: boolean;
        approvedSlotCount: number;
        activeSlotCount: number;
      };
    };
    const detailApp = detail.lines
      .flatMap((line) => line.applications)
      .find((a) => a.id === applicationId);
    expect(detailApp?.slotId).toBe(slot.id);
    // 老板端与陪玩端看到同一个单价（设计规格 §3.4）。
    expect(detailApp?.unitPriceFen).toBe(slot.unitPriceFen.toString());
    expect(detailApp?.unitPriceFen).toBe("7000");
    // 费用口径（Task 5b-2/A）：只报真实数字——还没核定报单时支出为 0，
    // 抽成/平台费返回 null 并标记「尚未分账」，不按规格公式编造毛利。
    expect(detail.settlement.orderAmountFen).toBe("0");
    expect(detail.settlement.playerShareFen).toBe("0");
    expect(detail.settlement.storeProfitFen).toBe("0");
    expect(detail.settlement.storeCutFen).toBeNull();
    expect(detail.settlement.platformFeeFen).toBeNull();
    expect(detail.settlement.splitApplied).toBe(false);
    expect(detail.settlement.approvedSlotCount).toBe(0);
    expect(detail.settlement.activeSlotCount).toBe(1);

    // Slice 0：列表行补齐「陪玩 / 老板 / 金额」，并支持分页元信息（响应仍是 { data: [...] }）。
    const listRow = (
      await req(csToken).get(`${DISPATCH}?status=ASSIGNED&limit=50`).expect(200)
    ).body as unknown as {
      data: {
        orderId: string;
        status: string;
        playerName: string | null;
        customerName: string;
        unitPriceFen: string | null;
        estimatedAmountFen: string | null;
      }[];
      total: number;
    };
    const row = listRow.data.find((item) => item.orderId === orderId);
    expect(row?.status).toBe("ASSIGNED");
    expect(row?.playerName).toBe("阿一");
    expect(row?.customerName).toBe("报名规则老板");
    // 审核列精确徽章需要档位 id：列表行必须带上已选中档位（未选人为 null）。
    expect((row as { slotId?: string | null } | undefined)?.slotId).toBe(
      slot.id,
    );
    // 列表「游戏 / 位置」列：派单所在游戏名与首个岗位都要带出来（前端表格要用）。
    const listed = row as
      { gameName?: string | null; positionLabel?: string | null } | undefined;
    expect(listed?.gameName).toBe(`英雄联盟-${suffix}`);
    expect(listed?.positionLabel).toBe("打野");
    // 「申报 / 核定」「等待 / 倒计时」两列的数据来源：核定分钟（报单审批后落在场次上）、
    // 场次状态（决定倒计时还是等待）与开始前/报单提交时间。未报单时这些字段应为 null，
    // 不能编造 0 或当前时间。
    const timing = row as
      | {
          reviewedDurationMinutes?: number | null;
          sessionStatus?: string | null;
          reportSubmittedAt?: string | null;
          desiredStartAt?: string | null;
        }
      | undefined;
    expect(timing?.reviewedDurationMinutes ?? null).toBeNull();
    expect(timing?.reportSubmittedAt ?? null).toBeNull();
    expect(
      timing?.sessionStatus === undefined || timing?.sessionStatus === null,
    ).toBe(true);
    expect(row?.unitPriceFen).toBe("7000");
    // 60 分钟 × 7000 分/小时 = 7000 分（与结算同口径，向上取整）
    expect(row?.estimatedAmountFen).toBe("7000");
    expect(listRow.total).toBeGreaterThanOrEqual(1);
    // 页头 KPI 的数字走独立汇总端点（不是列表分页的一部分）。
    // 本用例所在租户此前没有报单、没有违约、没有核定金额，所以必须是恰好 0——
    // 写死而不是「大于等于 0」，避免计数口径漂移时测试还绿。
    const summary = (await req(csToken).get(`${DISPATCH}/summary`).expect(200))
      .body as unknown as {
      data: {
        pendingReportCount: number;
        breachCount: number;
        pendingSettlementAmountFen: string;
      };
    };
    // 断言与库里的真实计数一致，而不是写死 0：同文件靠前的用例已经记过违约，
    // 写死会把「口径正确」误判成失败（我第一版就是这么错的）。
    expect(summary.data.pendingReportCount).toBe(
      await client.slotSession.count({
        where: {
          tenantId,
          reportSubmittedAt: { not: null },
          reportReviewedAt: null,
        },
      }),
    );
    expect(summary.data.breachCount).toBe(
      await client.playerBreachRecord.count({ where: { tenantId } }),
    );
    const earningsForSummary = await client.slotEarning.findMany({
      where: { tenantId },
      select: { amountFen: true },
    });
    expect(summary.data.pendingSettlementAmountFen).toBe(
      earningsForSummary
        .reduce((sum, item) => sum + item.amountFen, 0n)
        .toString(),
    );

    // 排序与时间范围：sort=status 时按流转顺序返回；from 在未来区间时结果为空。
    const sorted = (
      await req(csToken).get(`${DISPATCH}?sort=status&limit=50`).expect(200)
    ).body as unknown as { data: { status: string }[]; total: number };
    const order = [
      "DRAFT",
      "CONFIRMED",
      "DISPATCHING",
      "ASSIGNED",
      "READY",
      "IN_PROGRESS",
      "PENDING_CONFIRMATION",
      "COMPLETED",
      "CANCELLED",
    ];
    const indices = sorted.data.map((item) => order.indexOf(item.status));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));

    const future = (
      await req(csToken)
        .get(`${DISPATCH}?from=2999-01-01T00:00:00.000Z`)
        .expect(200)
    ).body as unknown as { data: unknown[]; total: number };
    expect(future.total).toBe(0);
    expect(future.data).toEqual([]);

    await req(csToken)
      .post(`${DISPATCH}/orders/${orderId}/player-breaches`, {
        playerId: playerIds["p1"],
        orderSlotId: slot.id,
        reason: "约定时间未到场",
      })
      .expect(201);

    const byOrder = (
      await req(csToken)
        .get(`${DISPATCH}/player-breaches?orderId=${orderId}`)
        .expect(200)
    ).body.data as {
      id: string;
      playerId: string;
      playerName: string;
      orderId: string;
      orderSlotId: string | null;
      reason: string;
      createdAt: string;
    }[];
    expect(byOrder).toHaveLength(1);
    expect(byOrder[0]?.playerId).toBe(playerIds["p1"]);
    expect(byOrder[0]?.playerName).toBe("阿一");
    expect(byOrder[0]?.reason).toBe("约定时间未到场");
    expect(byOrder[0]?.createdAt).toBeTruthy();

    // 按陪玩过滤同样能看到（后续「陪玩详情看历史违约」用同一入口）。
    const byPlayer = (
      await req(ownerToken)
        .get(`${DISPATCH}/player-breaches?playerId=${playerIds["p1"]}`)
        .expect(200)
    ).body.data as { id: string }[];
    // 该陪玩的历史违约可能不止本单（本文件前面用例也记过一条），这里断言包含关系。
    expect(byPlayer.map((r) => r.id)).toEqual(
      expect.arrayContaining(byOrder.map((r) => r.id)),
    );
    // 别的陪玩看不到这条记录。
    const otherPlayer = (
      await req(ownerToken)
        .get(`${DISPATCH}/player-breaches?playerId=${playerIds["p2"]}`)
        .expect(200)
    ).body.data as { id: string }[];
    expect(otherPlayer).toHaveLength(0);
    // 陪玩无权查看违约记录台账。
    await req(playerTokens["p1"])
      .get(`${DISPATCH}/player-breaches?playerId=${playerIds["p1"]}`)
      .expect(403);
  });

  /**
   * Slice 0 剩余：列表筛选补齐「游戏 / 陪玩 / 老板 / 金额区间」，并保证 `total` 与筛选同步。
   *
   * 契约口径：`data` 仍是数组、`total` 是**同一筛选条件下的总数**（不是当前页条数）；
   * 金额区间作用在列表行已有的 `estimatedAmountFen`（整数分，含边界）。
   * 每次筛选都用「只可能命中本用例订单」的未知 id 做反向断言，避免同文件其它订单干扰。
   */
  it("订单中心列表筛选：游戏 / 陪玩 / 老板 / 金额区间 + total 同步", async () => {
    const { orderId, lineId } = await publishedOrder();
    await apply(playerTokens["p1"], orderId, lineId).expect(201);
    await hireOwnerSelected(orderId, "p1");
    const dispatch = await client.gameDispatchOrder.findFirstOrThrow({
      where: { tenantId, orderId },
    });
    expect(dispatch.gameId).toBe(gameId);

    type ListRow = {
      orderId: string;
      status: string;
      customerProfileId: string;
      customerName: string;
      playerName: string | null;
      estimatedAmountFen: string | null;
    };
    async function list(query: string) {
      const body = (
        await req(csToken).get(`${DISPATCH}?${query}&limit=100`).expect(200)
      ).body as unknown as { data: ListRow[]; total: number };
      // total 必须等于当前筛选条件下的行数（超过单页上限时至少不小于当前页）。
      expect(body.total).toBeGreaterThanOrEqual(body.data.length);
      return body;
    }

    // 游戏：命中本单所在游戏；不存在的游戏返回空集且 total 归零。
    const byGame = await list(`gameId=${gameId}`);
    expect(byGame.data.map((row) => row.orderId)).toContain(orderId);
    const unknownGame = await list(
      "gameId=00000000-0000-0000-0000-000000000000",
    );
    expect(unknownGame.data).toEqual([]);
    expect(unknownGame.total).toBe(0);
    // 另一个游戏不能把本单捞出来（证明是过滤而不是忽略参数）。
    const otherGameRows = await list(`gameId=${otherGameId}`);
    expect(otherGameRows.data.map((row) => row.orderId)).not.toContain(orderId);

    // 陪玩：按选中陪玩过滤能看到本单；另一个陪玩 / 未知 id 看不到。
    const byPlayer = await list(`playerId=${playerIds["p1"]}`);
    expect(byPlayer.data.map((row) => row.orderId)).toContain(orderId);
    expect(byPlayer.data.every((row) => row.playerName !== null)).toBe(true);
    const otherPlayerRows = await list(`playerId=${playerIds["p2"]}`);
    expect(otherPlayerRows.data.map((row) => row.orderId)).not.toContain(
      orderId,
    );
    const unknownPlayer = await list(
      "playerId=00000000-0000-0000-0000-000000000000",
    );
    expect(unknownPlayer.total).toBe(0);

    // 老板：按 customerProfileId 过滤能看到本单；未知 id 返回空集。
    const byCustomer = await list(`customerProfileId=${customerId}`);
    expect(byCustomer.data.map((row) => row.orderId)).toContain(orderId);
    expect(
      byCustomer.data.every((row) => row.customerProfileId === customerId),
    ).toBe(true);
    const unknownCustomer = await list(
      "customerProfileId=00000000-0000-0000-0000-000000000000",
    );
    expect(unknownCustomer.data).toEqual([]);
    expect(unknownCustomer.total).toBe(0);

    // 金额区间：本单 60 分钟 × 7000 分/小时 = 7000 分（含边界）。
    const tooRich = await list(
      `customerProfileId=${customerId}&minAmountFen=7001`,
    );
    expect(tooRich.data).toEqual([]);
    expect(tooRich.total).toBe(0);
    const tooCheap = await list(
      `customerProfileId=${customerId}&maxAmountFen=6999`,
    );
    expect(tooCheap.data).toEqual([]);
    expect(tooCheap.total).toBe(0);
    const exact = await list(
      `customerProfileId=${customerId}&minAmountFen=7000&maxAmountFen=7000`,
    );
    expect(exact.data.map((row) => row.orderId)).toContain(orderId);
    expect(exact.data.every((row) => row.estimatedAmountFen === "7000")).toBe(
      true,
    );
    expect(exact.total).toBe(exact.data.length);

    // 组合筛选：游戏 + 老板 + 陪玩 + 状态同时生效。
    const combined = await list(
      `gameId=${gameId}&customerProfileId=${customerId}` +
        `&playerId=${playerIds["p1"]}&status=ASSIGNED`,
    );
    const combinedRow = combined.data.find((row) => row.orderId === orderId);
    expect(combinedRow?.status).toBe("ASSIGNED");
    expect(combinedRow?.playerName).toBe("阿一");
    expect(combinedRow?.estimatedAmountFen).toBe("7000");

    // 组合筛选里只要有一个条件不匹配，整行就不出现。
    const mismatchedGame = await list(
      `gameId=${otherGameId}&customerProfileId=${customerId}`,
    );
    expect(mismatchedGame.data).toEqual([]);
    expect(mismatchedGame.total).toBe(0);
  });

  it("走查修复 F4：没有生效档位时拒绝按 0 元结算", async () => {
    const { orderId, lineId } = await publishedOrder();
    await apply(playerTokens["p1"], orderId, lineId).expect(201);
    const [applicationId] = await hireOwnerSelected(orderId, "p1");
    const slot = await client.orderSlot.findFirstOrThrow({
      where: { tenantId, applicationId },
    });
    // 正常 API 流程里「释放名额」会把订单退回报名阶段，所以这个边界状态需要直接构造：
    // 已到待核算、但生效档位为 0（例如未来出现新的释放/取消入口）。
    await client.orderSlot.update({
      where: { id: slot.id },
      data: { status: "RELEASED" },
    });
    await client.order.update({
      where: { id: orderId },
      data: { status: "PENDING_CONFIRMATION" },
    });

    const failed = await req(ownerToken)
      .post(`${DISPATCH}/orders/${orderId}/confirm-settlement`)
      .expect(409);
    expect((failed.body as { message: string }).message).toContain(
      "没有生效档位",
    );
    const after = await client.order.findFirstOrThrow({
      where: { id: orderId },
    });
    expect(after.status).toBe("PENDING_CONFIRMATION");
    expect(
      await client.slotEarning.count({ where: { tenantId, orderId } }),
    ).toBe(0);
  });

  /**
   * P3 / D3：违约台账的时间范围与分页（设计规格 §6）。
   *
   * 为了不受同文件其它用例产生的记录干扰，这里把本用例造出的 3 条记录统一回拨到
   * 「3 天前 / 2 天前 / 1 天前」，并用 `to=<12 小时前>` 把时间窗口收在历史区间内。
   */
  it("P3 / D3：违约台账支持时间范围与分页（非法日期 400）", async () => {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const offsets = [3, 2, 1];
    const players = ["p1", "p1", "p2"] as const;
    const ids: string[] = [];

    for (const [index, player] of players.entries()) {
      const { orderId, lineId } = await publishedOrder();
      await apply(playerTokens[player], orderId, lineId).expect(201);
      const [applicationId] = await hireOwnerSelected(orderId, player);
      const slot = await client.orderSlot.findFirstOrThrow({
        where: { tenantId, applicationId },
      });
      const res = await req(csToken)
        .post(`${DISPATCH}/orders/${orderId}/player-breaches`, {
          playerId: playerIds[player],
          orderSlotId: slot.id,
          reason: `台账用例-${index}`,
        })
        .expect(201);
      const id = (res.body as { data: { id: string } }).data.id;
      ids.push(id);
      await client.playerBreachRecord.update({
        where: { id },
        data: { createdAt: new Date(now - offsets[index]! * day) },
      });
    }

    const iso = (ms: number) => new Date(ms).toISOString();

    // 窗口覆盖全部 3 条（其它用例的记录都落在“现在”，被 to 排除）
    const all = (
      await req(csToken)
        .get(
          `${DISPATCH}/player-breaches?from=${encodeURIComponent(
            iso(now - 4 * day),
          )}&to=${encodeURIComponent(iso(now - 12 * 60 * 60 * 1000))}`,
        )
        .expect(200)
    ).body.data as { id: string; createdAt: string }[];
    expect(all.map((row) => row.id).sort()).toEqual([...ids].sort());
    // 倒序：最近的在最前
    expect(all[0]?.id).toBe(ids[2]);

    // 只取「1 天前」那条
    const narrowed = (
      await req(csToken)
        .get(
          `${DISPATCH}/player-breaches?from=${encodeURIComponent(
            iso(now - 36 * 60 * 60 * 1000),
          )}&to=${encodeURIComponent(iso(now - 12 * 60 * 60 * 1000))}`,
        )
        .expect(200)
    ).body.data as { id: string }[];
    expect(narrowed.map((row) => row.id)).toEqual([ids[2]]);

    // offset 分页：limit=1 逐页取出 3 条且不重复
    const paged: string[] = [];
    for (const offset of [0, 1, 2]) {
      const page = (
        await req(csToken)
          .get(
            `${DISPATCH}/player-breaches?to=${encodeURIComponent(
              iso(now - 12 * 60 * 60 * 1000),
            )}&limit=1&offset=${offset}`,
          )
          .expect(200)
      ).body.data as { id: string }[];
      expect(page).toHaveLength(1);
      paged.push(page[0]!.id);
    }
    expect(paged).toEqual([ids[2], ids[1], ids[0]]);

    // 非法日期与逆序区间都是受控 400
    await req(csToken)
      .get(`${DISPATCH}/player-breaches?from=not-a-date`)
      .expect(400);
    await req(csToken)
      .get(
        `${DISPATCH}/player-breaches?from=${encodeURIComponent(
          iso(now),
        )}&to=${encodeURIComponent(iso(now - day))}`,
      )
      .expect(400);

    // 租户隔离：别家租户读同一时间窗口拿不到本租户的记录
    const other = (
      await req(otherOwnerToken)
        .get(
          `${DISPATCH}/player-breaches?from=${encodeURIComponent(
            iso(now - 4 * day),
          )}&to=${encodeURIComponent(iso(now - 12 * 60 * 60 * 1000))}`,
        )
        .expect(200)
    ).body.data as { id: string }[];
    expect(other).toHaveLength(0);
  });
});

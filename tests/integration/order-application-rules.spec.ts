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
});

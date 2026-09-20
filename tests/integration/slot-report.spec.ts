/**
 * 算价模型 Task 3：陪玩报单（申报时长 + 开始/结束截图）与客服审批。
 *
 * 覆盖（设计规格 §3.3、§9 第 4-6 条、ADR-0003 决策 3/4）：
 * - 结束场次只留证据计时长作对照，**报单前不产生 SlotEarning**；
 * - 申报时长边界 15–1440 分钟（越界 400）、必须带报单开始/结束截图（缺图 400）；
 * - 客服审批后金额 = 单价 × 申报分钟 / 60 向上取整；
 * - 审批可人工修正时长：按修正值计费，原始申报值保留在审计里；
 * - 未报单直接审批 409；重复报单 / 重复审批 409；并发审批只有一个成功；
 * - 驳回不产生金额且可重新报单；跨租户与跨陪玩都被拒。
 */
import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Slot-Report-Password-1";
const suffix = Date.now().toString(36);
const tenantCode = `sr_${suffix}`;
const otherTenantCode = `srb_${suffix}`;
const TEMPLATES = "/api/v1/tenant/game-templates";
const DISPATCH = "/api/v1/tenant/game-dispatch";
const PRICING = "/api/v1/tenant/game-pricing";

/** 1×1 PNG 头即可通过服务端真实类型嗅探（与 game-dispatch-flow 用例同口径）。 */
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0,
]);

interface SlotReportView {
  slotId: string;
  sessionId: string;
  orderId: string;
  playerId: string;
  unitPriceFen: string;
  reportStatus: "NOT_REPORTED" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";
  declaredDurationMinutes: number | null;
  durationSeconds: number | null;
  reportSubmittedAt: string | null;
  reportReviewedAt: string | null;
  reportReviewedBy: string | null;
  reportReviewNote: string | null;
  earningFen: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("算价模型 Task 3：报单（申报时长 + 截图）与客服审批", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId = "";
  let otherTenantId = "";
  let gameId = "";
  let ownerToken = "";
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
      data: { code: tenantCode, name: "报单测试店" },
    });
    tenantId = tenant.id;
    const other = await client.tenant.create({
      data: { code: otherTenantCode, name: "报单别家店" },
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
    await addAccount(otherTenantId, "boss", "TENANT_OWNER");
    const p1 = await addAccount(tenantId, `a1_${suffix}`, "PLAYER");
    const p2 = await addAccount(tenantId, `a2_${suffix}`, "PLAYER");
    const profile1 = await client.playerProfile.create({
      data: {
        tenantId,
        name: "阿一",
        tenantAccountId: p1.id,
        // 陪玩级兜底底价 6000 分/小时。
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

    const customer = await client.customerProfile.create({
      data: { tenantId, name: "报单老板" },
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
        name: `报单模板-${suffix}`,
        fields: [
          {
            fieldKey: "rank",
            label: "目标段位",
            fieldType: "select",
            options: ["翡翠", "钻石"],
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
    // 单价 = 兜底底价 6000 + rank=钻石 1000 = 7000 分/小时（计费用这个快照价）。
    await request(app.getHttpServer())
      .put(`${PRICING}/games/${gameId}`)
      .set("authorization", `Bearer ${ownerToken}`)
      .send({ items: [{ dimensionKey: "rank=钻石", amountFen: "1000" }] })
      .expect(200);
    playerIds = { p1: profile1.id, p2: profile2.id };
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

  /** 上传一张真实 PNG 证据；evidenceType 走既有证据通道的用途标识。 */
  function uploadEvidence(token: string, slotId: string, evidenceType: string) {
    return request(app.getHttpServer())
      .post(
        `${DISPATCH}/slots/${slotId}/session/evidence?evidenceType=${evidenceType}`,
      )
      .set("authorization", `Bearer ${token}`)
      .set("x-file-name", `${evidenceType.toLowerCase()}.png`)
      .send(PNG);
  }

  /** 建单 → 发布 → 报名 → 选人：得到一个已落单价快照的档位。 */
  async function assignedSlot(player: "p1" | "p2" = "p1") {
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
    await req(playerTokens[player])
      .post(`${DISPATCH}/orders/${orderId}/lines/${lineId}/applications`)
      .expect(201);
    const applications = (
      await req(ownerToken)
        .get(`${DISPATCH}/orders/${orderId}/applications`)
        .expect(200)
    ).body.data as { applications: { id: string }[] }[];
    const applicationIds = applications.flatMap((a) =>
      a.applications.map((x) => x.id),
    );
    await req(customerToken)
      .post("/api/v1/boss/wallet/recharge", { amountFen: "100000" })
      .expect(201);
    await req(ownerToken)
      .post(`${DISPATCH}/orders/${orderId}/assignment`, { applicationIds })
      .expect(201);
    const slot = await client.orderSlot.findFirstOrThrow({
      where: { tenantId, orderId, playerId: playerIds[player] },
    });
    return { orderId, slotId: slot.id, unitPriceFen: slot.unitPriceFen };
  }

  /** 开始 → 计时 → 计时证据 → 结束（结束只写证据计时长，不再产生金额）。 */
  async function endService(player: "p1" | "p2", slotId: string) {
    const token = playerTokens[player];
    await req(token)
      .post(`${DISPATCH}/slots/${slotId}/session/start`)
      .expect(201);
    await sleep(1100);
    await uploadEvidence(token, slotId, "START").expect(201);
    await req(token)
      .post(`${DISPATCH}/slots/${slotId}/session/end`)
      .expect(201);
  }

  function report(
    token: string,
    slotId: string,
    declaredDurationMinutes: number,
  ) {
    return req(token).post(`${DISPATCH}/slots/${slotId}/report`, {
      declaredDurationMinutes,
    });
  }

  function review(
    token: string,
    slotId: string,
    body: {
      approve: boolean;
      declaredDurationMinutes?: number;
      reason?: string;
    },
  ) {
    return req(token).post(`${DISPATCH}/slots/${slotId}/report/review`, body);
  }

  it("结束场次不产生 SlotEarning：申报前金额为 0，审批后才落金额", async () => {
    const { slotId } = await assignedSlot("p1");
    await endService("p1", slotId);

    // 本版口径：结束只写证据计时长（对照用），报单审批前不产生任何金额。
    const afterEnd = await client.slotEarning.findMany({
      where: { tenantId, orderSlotId: slotId },
    });
    expect(afterEnd).toHaveLength(0);

    const session = await client.slotSession.findFirstOrThrow({
      where: { tenantId, orderSlotId: slotId },
    });
    expect(session.status).toBe("ENDED");
    expect(session.durationSeconds).toBeGreaterThan(0);
    expect(session.declaredDurationMinutes).toBeNull();

    await uploadEvidence(playerTokens["p1"], slotId, "REPORT_START").expect(
      201,
    );
    await uploadEvidence(playerTokens["p1"], slotId, "REPORT_END").expect(201);
    const submitted = await report(playerTokens["p1"], slotId, 90).expect(201);
    const view = (submitted.body as { data: SlotReportView }).data;
    expect(view.reportStatus).toBe("PENDING_REVIEW");
    expect(view.declaredDurationMinutes).toBe(90);
    expect(view.earningFen).toBeNull();
    // 申报时长与证据计时长并存：本版不做自动比对，只留对照。
    expect(view.durationSeconds).toBeGreaterThan(0);

    const stillNoEarning = await client.slotEarning.findMany({
      where: { tenantId, orderSlotId: slotId },
    });
    expect(stillNoEarning).toHaveLength(0);
  });

  it("申报时长越界 400、缺报单截图 400", async () => {
    const { slotId } = await assignedSlot("p1");
    await endService("p1", slotId);

    // 先补两张报单截图，才能单独验证时长边界。
    await uploadEvidence(playerTokens["p1"], slotId, "REPORT_START").expect(
      201,
    );
    await uploadEvidence(playerTokens["p1"], slotId, "REPORT_END").expect(201);

    await report(playerTokens["p1"], slotId, 14).expect(400);
    await report(playerTokens["p1"], slotId, 1441).expect(400);

    // 另起一单：没上传报单截图时拒绝报单。
    const missing = await assignedSlot("p1");
    await endService("p1", missing.slotId);
    const failed = await report(playerTokens["p1"], missing.slotId, 60).expect(
      400,
    );
    expect((failed.body as { message: string }).message).toContain("截图");
    expect(
      await client.slotEarning.count({
        where: { tenantId, orderSlotId: missing.slotId },
      }),
    ).toBe(0);
  });

  it("未报单直接审批 409；非本人报单被拒", async () => {
    const { slotId } = await assignedSlot("p1");
    await endService("p1", slotId);

    await review(ownerToken, slotId, { approve: true }).expect(409);
    // 别的陪玩不能替他报单（档位归属校验在服务端）。
    await uploadEvidence(playerTokens["p2"], slotId, "REPORT_START").expect(
      409,
    );
  });

  it("审批通过：金额 = 单价 × 申报分钟 / 60 向上取整，并写审计留痕", async () => {
    const { slotId, orderId, unitPriceFen } = await assignedSlot("p1");
    expect(unitPriceFen).toBe(7000n);
    await endService("p1", slotId);
    await uploadEvidence(playerTokens["p1"], slotId, "REPORT_START").expect(
      201,
    );
    await uploadEvidence(playerTokens["p1"], slotId, "REPORT_END").expect(201);
    await report(playerTokens["p1"], slotId, 95).expect(201);

    const reviewed = await review(ownerToken, slotId, { approve: true }).expect(
      201,
    );
    const view = (reviewed.body as { data: SlotReportView }).data;
    // 7000 × 95 / 60 = 11083.33… → 向上取整 11084（整数分，无浮点）。
    expect(view.earningFen).toBe("11084");
    expect(view.reportStatus).toBe("APPROVED");
    expect(view.declaredDurationMinutes).toBe(95);
    expect(view.reportReviewedAt).not.toBeNull();

    const earning = await client.slotEarning.findFirstOrThrow({
      where: { tenantId, orderSlotId: slotId },
    });
    expect(earning.amountFen).toBe(11084n);
    expect(earning.status).toBe("PENDING");

    const audits = await client.auditLog.findMany({
      where: { tenantId, resourceId: slotId },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((a) => a.action)).toContain(
      "game_dispatch.slot_report.submitted",
    );
    const approvalAudit = audits.find(
      (a) => a.action === "game_dispatch.slot_report.reviewed",
    );
    expect(approvalAudit?.summary).toContain("11084");
    expect(approvalAudit?.resourceType).toBe("slot");

    // 陪玩端读路径同步可见报单状态（mobile 报单表单用它）。
    const slots = (
      await req(playerTokens["p1"])
        .get(`${DISPATCH}/player/orders/${orderId}/service-slots`)
        .expect(200)
    ).body.data as {
      slots: {
        orderSlotId: string;
        session: {
          declaredDurationMinutes: number | null;
          reportStatus: string;
        } | null;
      }[];
    };
    const slotView = slots.slots.find((s) => s.orderSlotId === slotId);
    expect(slotView?.session?.declaredDurationMinutes).toBe(95);
    expect(slotView?.session?.reportStatus).toBe("APPROVED");
  });

  it("审批修正时长：按修正值计费，审计保留原始申报值", async () => {
    const { slotId } = await assignedSlot("p1");
    await endService("p1", slotId);
    await uploadEvidence(playerTokens["p1"], slotId, "REPORT_START").expect(
      201,
    );
    await uploadEvidence(playerTokens["p1"], slotId, "REPORT_END").expect(201);
    await report(playerTokens["p1"], slotId, 95).expect(201);

    const reviewed = await review(ownerToken, slotId, {
      approve: true,
      declaredDurationMinutes: 120,
      reason: "截图核对为 2 小时",
    }).expect(201);
    const view = (reviewed.body as { data: SlotReportView }).data;
    // 7000 × 120 / 60 = 14000（修正值，而不是申报的 95 分钟）。
    expect(view.earningFen).toBe("14000");
    expect(view.declaredDurationMinutes).toBe(120);
    expect(view.reportReviewNote).toBe("截图核对为 2 小时");

    const session = await client.slotSession.findFirstOrThrow({
      where: { tenantId, orderSlotId: slotId },
    });
    expect(session.declaredDurationMinutes).toBe(120);
    expect(session.reportReviewNote).toBe("截图核对为 2 小时");
    expect(session.reportReviewedBy).not.toBeNull();

    const audit = await client.auditLog.findFirstOrThrow({
      where: {
        tenantId,
        resourceId: slotId,
        action: "game_dispatch.slot_report.reviewed",
      },
    });
    // 原始申报 95 分钟保留在审计留痕里，不被修正覆盖。
    expect(audit.summary).toContain("95");
    expect(audit.summary).toContain("120");
    expect(audit.summary).toContain("14000");

    // 越界的修正值同样被拒（400），且不落金额。
    const another = await assignedSlot("p1");
    await endService("p1", another.slotId);
    await uploadEvidence(
      playerTokens["p1"],
      another.slotId,
      "REPORT_START",
    ).expect(201);
    await uploadEvidence(
      playerTokens["p1"],
      another.slotId,
      "REPORT_END",
    ).expect(201);
    await report(playerTokens["p1"], another.slotId, 60).expect(201);
    await review(ownerToken, another.slotId, {
      approve: true,
      declaredDurationMinutes: 5,
    }).expect(400);
    expect(
      await client.slotEarning.count({
        where: { tenantId, orderSlotId: another.slotId },
      }),
    ).toBe(0);
  });

  it("重复报单 / 重复审批 409；并发审批只有一个成功", async () => {
    const { slotId } = await assignedSlot("p1");
    await endService("p1", slotId);
    await uploadEvidence(playerTokens["p1"], slotId, "REPORT_START").expect(
      201,
    );
    await uploadEvidence(playerTokens["p1"], slotId, "REPORT_END").expect(201);
    await report(playerTokens["p1"], slotId, 60).expect(201);
    await report(playerTokens["p1"], slotId, 70).expect(409);

    const server = app.getHttpServer();
    const url = `${DISPATCH}/slots/${slotId}/report/review`;
    const [a, b] = await Promise.all([
      request(server)
        .post(url)
        .set("authorization", `Bearer ${ownerToken}`)
        .send({ approve: true }),
      request(server)
        .post(url)
        .set("authorization", `Bearer ${ownerToken}`)
        .send({ approve: true }),
    ]);
    // 行级 CAS：并发审批只有一个 201，另一个受控 409，不产生双份金额。
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(
      await client.slotEarning.count({
        where: { tenantId, orderSlotId: slotId },
      }),
    ).toBe(1);
    expect(
      await client.auditLog.count({
        where: {
          tenantId,
          resourceId: slotId,
          action: "game_dispatch.slot_report.reviewed",
        },
      }),
    ).toBe(1);
    await review(ownerToken, slotId, { approve: true }).expect(409);
  });

  it("驳回不产生金额，可重新报单后再次审批", async () => {
    const { slotId } = await assignedSlot("p1");
    await endService("p1", slotId);
    await uploadEvidence(playerTokens["p1"], slotId, "REPORT_START").expect(
      201,
    );
    await uploadEvidence(playerTokens["p1"], slotId, "REPORT_END").expect(201);
    await report(playerTokens["p1"], slotId, 60).expect(201);

    const rejected = await review(ownerToken, slotId, {
      approve: false,
      reason: "截图与申报不符",
    }).expect(201);
    expect((rejected.body as { data: SlotReportView }).data.reportStatus).toBe(
      "REJECTED",
    );
    expect(
      await client.slotEarning.count({
        where: { tenantId, orderSlotId: slotId },
      }),
    ).toBe(0);
    expect(
      await client.auditLog.count({
        where: {
          tenantId,
          resourceId: slotId,
          action: "game_dispatch.slot_report.rejected",
        },
      }),
    ).toBe(1);

    // 驳回后可重新报单；审定通过时按新值计费。
    await report(playerTokens["p1"], slotId, 120).expect(201);
    const reviewed = await review(ownerToken, slotId, { approve: true }).expect(
      201,
    );
    expect((reviewed.body as { data: SlotReportView }).data.earningFen).toBe(
      "14000",
    );
    expect((reviewed.body as { data: SlotReportView }).data.reportStatus).toBe(
      "APPROVED",
    );
  });

  it("租户隔离：别家租户读不到也审不了本店的报单", async () => {
    const { slotId } = await assignedSlot("p1");
    await endService("p1", slotId);
    await uploadEvidence(playerTokens["p1"], slotId, "REPORT_START").expect(
      201,
    );
    await uploadEvidence(playerTokens["p1"], slotId, "REPORT_END").expect(201);
    await report(playerTokens["p1"], slotId, 60).expect(201);

    await review(otherOwnerToken, slotId, { approve: true }).expect(404);
    // 别家租户也看不到本店场次详情（RLS + 服务端租户上下文）。
    await req(otherOwnerToken)
      .get(`/api/v1/tenant/sessions/${slotId}`)
      .expect(404);
    expect(
      await client.slotEarning.count({
        where: { tenantId, orderSlotId: slotId },
      }),
    ).toBe(0);
  });
});

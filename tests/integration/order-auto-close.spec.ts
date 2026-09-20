/**
 * 算价模型 Task 4：无人报名自动关单（设计规格 §3.5、§6）。
 *
 * 覆盖：
 * - 报名窗口内无人报名（关单窗口与报名窗口同源，默认 10 分钟、可配置，P3 / D4）→ 后台 tick 以 system actor 关单：
 *   订单 CANCELLED、报名轮次 CLOSED、写 order_events 与 audit_logs、经 Outbox 通知老板；
 * - 已有人报名（APPLIED/SELECTED）时绝不自动关单；窗口未到不关；窗口传 0/不传即关闭该规则；
 * - 并发：自动关单与陪玩报名同一瞬间只有一个成功（订单行锁 + 条件更新）。
 * - P3 / D4：报名窗口长度由 `DISPATCH_ROUND_WINDOW_MS` 决定（默认 10 分钟），窗口关闭后报名 409。
 */
import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { drainOutbox } from "../../apps/api/src/modules/notifications/outbox.relay.js";
import { PlatformBillingService } from "../../apps/api/src/modules/platform-billing/platform-billing.service.js";
import {
  SYSTEM_ACTOR_ID,
  runBackgroundTick,
} from "../../apps/api/src/background/worker.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Auto-Close-Password-1";
const suffix = Date.now().toString(36);
const tenantCode = `ac_${suffix}`;
const TEMPLATES = "/api/v1/tenant/game-templates";
const DISPATCH = "/api/v1/tenant/game-dispatch";
const PRICING = "/api/v1/tenant/game-pricing";

describe("算价模型 Task 4：无人报名自动关单", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId = "";
  let ownerToken = "";
  let customerToken = "";
  let playerToken = "";
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
      data: { code: tenantCode, name: "自动关单测试店" },
    });
    tenantId = tenant.id;

    async function addAccount(username: string, role: string) {
      const account = await client.tenantAccount.create({
        data: { tenantId, username, passwordHash: hash },
      });
      await client.tenantAccountRole.create({
        data: {
          tenantId,
          tenantAccountId: account.id,
          role: role as never,
        },
      });
      return account;
    }

    await addAccount("boss", "TENANT_OWNER");
    const p1 = await addAccount(`a1_${suffix}`, "PLAYER");
    await client.playerProfile.create({
      data: {
        tenantId,
        name: "阿一",
        tenantAccountId: p1.id,
        basePricePerHourFen: 6000n,
      },
    });
    const customer = await client.customerProfile.create({
      data: { tenantId, name: "自动关单老板" },
    });
    customerId = customer.id;
    const customerAccount = await addAccount(`cb_${suffix}`, "CUSTOMER");
    await client.customerProfile.update({
      where: { id: customer.id },
      data: { tenantAccountId: customerAccount.id },
    });
    const game = await client.game.create({
      data: { tenantId, name: `英雄联盟-${suffix}` },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(username: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ kind: "tenant", tenantCode, username, password: PW })
        .expect(201);
      return (res.body as { data: { accessToken: string } }).data.accessToken;
    }

    ownerToken = await login("boss");
    customerToken = await login(`cb_${suffix}`);
    playerToken = await login(`a1_${suffix}`);

    const template = await request(app.getHttpServer())
      .post(TEMPLATES)
      .set("authorization", `Bearer ${ownerToken}`)
      .send({
        name: `自动关单模板-${suffix}`,
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
      data: { gameId: game.id },
    });
    await request(app.getHttpServer())
      .put(`${PRICING}/games/${game.id}`)
      .set("authorization", `Bearer ${ownerToken}`)
      .send({ items: [{ dimensionKey: "rank=钻石", amountFen: "1000" }] })
      .expect(200);
  });

  afterAll(async () => {
    if (client) {
      await client.slotEvidence.deleteMany({ where: { tenantId } });
      await client.slotSession.deleteMany({ where: { tenantId } });
      await client.slotEarning.deleteMany({ where: { tenantId } });
      await client.playerBreachRecord.deleteMany({ where: { tenantId } });
      await client.orderSlot.deleteMany({ where: { tenantId } });
      await client.gameDispatchApplication.deleteMany({
        where: { tenantId },
      });
      await client.gameDispatchRound.deleteMany({ where: { tenantId } });
      await client.gameDispatchLine.deleteMany({ where: { tenantId } });
      await client.gameDispatchOrder.deleteMany({ where: { tenantId } });
      await client.gameDispatchTemplateSnapshot.deleteMany({
        where: { tenantId },
      });
      await client.gamePricingRuleItem.deleteMany({ where: { tenantId } });
      await client.gamePricingRule.deleteMany({ where: { tenantId } });
      await client.orderRequirement.deleteMany({ where: { tenantId } });
      await client.orderEvent.deleteMany({ where: { tenantId } });
      await client.auditLog.deleteMany({ where: { tenantId } });
      await client.notificationDelivery.deleteMany({ where: { tenantId } });
      await client.outboxEvent.deleteMany({ where: { tenantId } });
      await client.order.deleteMany({ where: { tenantId } });
      await client.playerProfile.deleteMany({ where: { tenantId } });
      await client.walletEntry.deleteMany({ where: { tenantId } });
      await client.paymentOrder.deleteMany({ where: { tenantId } });
      await client.bossWallet.deleteMany({ where: { tenantId } });
      await client.customerProfile.deleteMany({ where: { tenantId } });
      await client.gameDispatchRankRule.deleteMany({ where: { tenantId } });
      await client.gameDispatchPosition.deleteMany({ where: { tenantId } });
      await client.gameDispatchTemplateField.deleteMany({
        where: { tenantId },
      });
      await client.gameDispatchTemplate.deleteMany({ where: { tenantId } });
      await client.game.deleteMany({ where: { tenantId } });
      const accounts = await client.tenantAccount.findMany({
        where: { tenantId },
        select: { id: true },
      });
      await client.refreshSession.deleteMany({
        where: { accountId: { in: accounts.map((a) => a.id) } },
      });
      await client.tenantAccountRole.deleteMany({ where: { tenantId } });
      await client.tenantAccount.deleteMany({ where: { tenantId } });
      await client.tenantEntitlement.deleteMany({ where: { tenantId } });
      await client.tenant.deleteMany({ where: { id: tenantId } });
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

  /** 把报名轮次的 opensAt 回拨，用于构造「已超时」的无人报名订单。 */
  async function backdateRound(orderId: string, ms: number) {
    await client.gameDispatchRound.updateMany({
      where: { tenantId, orderId },
      data: { opensAt: new Date(Date.now() - ms) },
    });
  }

  function tick(options: { noApplicationTimeoutMs?: number }) {
    return runBackgroundTick(client, new PlatformBillingService(client), {
      batchSize: 20,
      tenantId,
      ...(options.noApplicationTimeoutMs === undefined
        ? {}
        : { noApplicationTimeoutMs: options.noApplicationTimeoutMs }),
    });
  }

  it("无人报名超时自动关单：订单 CANCELLED、轮次 CLOSED、写审计并通知老板", async () => {
    const { orderId } = await publishedOrder();
    // 回拨 10 分钟 > 默认/显式配置的 5 分钟窗口 → 视为已超时。
    await backdateRound(orderId, 10 * 60 * 1000);

    const result = await tick({ noApplicationTimeoutMs: 5 * 60 * 1000 });
    expect(result.autoClosed).toBe(1);

    const order = await client.order.findFirstOrThrow({
      where: { id: orderId },
    });
    expect(order.status).toBe("CANCELLED");
    const rounds = await client.gameDispatchRound.findMany({
      where: { tenantId, orderId },
    });
    expect(rounds.every((r) => r.status === "CLOSED")).toBe(true);
    const event = await client.orderEvent.findFirstOrThrow({
      where: { tenantId, orderId, eventType: "GAME_DISPATCH_AUTO_CLOSED" },
    });
    expect(event.actorType).toBe("system");
    expect(event.actorId).toBe(SYSTEM_ACTOR_ID);
    expect(event.fromStatus).toBe("DISPATCHING");
    expect(event.toStatus).toBe("CANCELLED");
    expect(
      await client.auditLog.count({
        where: {
          tenantId,
          resourceId: orderId,
          action: "game_dispatch.auto_close",
        },
      }),
    ).toBe(1);

    const outbox = await client.outboxEvent.findFirstOrThrow({
      where: { tenantId, eventType: "order.auto_closed" },
    });
    expect(outbox.aggregateId).toBe(orderId);
    await drainOutbox(client, 20, tenantId);
    const notifications = (
      await req(customerToken).get("/api/v1/tenant/notifications").expect(200)
    ).body.data as { id: string; title: string | null }[];
    expect(
      notifications.some((n) => (n.title ?? "").includes("无人报名")),
    ).toBe(true);
  });

  it("已有人报名时不自动关单", async () => {
    const { orderId, lineId } = await publishedOrder();
    await req(playerToken)
      .post(`${DISPATCH}/orders/${orderId}/lines/${lineId}/applications`)
      .expect(201);
    await backdateRound(orderId, 10 * 60 * 1000);

    const result = await tick({ noApplicationTimeoutMs: 5 * 60 * 1000 });
    expect(result.autoClosed).toBe(0);
    const order = await client.order.findFirstOrThrow({
      where: { id: orderId },
    });
    expect(order.status).toBe("DISPATCHING");
  });

  it("窗口未到不关单；规则关闭（0/不传）时即使超时也不关单", async () => {
    const { orderId } = await publishedOrder();
    await backdateRound(orderId, 1_000);

    const notDue = await tick({ noApplicationTimeoutMs: 5 * 60 * 1000 });
    expect(notDue.autoClosed).toBe(0);
    const disabled = await tick({ noApplicationTimeoutMs: 0 });
    expect(disabled.autoClosed).toBe(0);
    const defaultOff = await tick({});
    expect(defaultOff.autoClosed).toBe(0);

    await backdateRound(orderId, 60_000);
    const order = await client.order.findFirstOrThrow({
      where: { id: orderId },
    });
    expect(order.status).toBe("DISPATCHING");
  });

  it("并发：自动关单与报名只有一个成功", async () => {
    const { orderId, lineId } = await publishedOrder();
    await backdateRound(orderId, 10 * 60 * 1000);

    const [applyRes] = await Promise.all([
      request(app.getHttpServer())
        .post(`${DISPATCH}/orders/${orderId}/lines/${lineId}/applications`)
        .set("authorization", `Bearer ${playerToken}`)
        .send({}),
      tick({ noApplicationTimeoutMs: 5 * 60 * 1000 }),
    ]);

    const order = await client.order.findFirstOrThrow({
      where: { id: orderId },
    });
    const applications = await client.gameDispatchApplication.findMany({
      where: { tenantId, orderId, status: "APPLIED" },
    });
    if (applyRes.status === 201) {
      // 报名先拿到订单行锁：关单必须放弃。
      expect(order.status).toBe("DISPATCHING");
      expect(applications).toHaveLength(1);
    } else {
      // 关单先赢：报名被状态校验拒绝，且不留报名记录。
      expect([404, 409]).toContain(applyRes.status);
      expect(order.status).toBe("CANCELLED");
      expect(applications).toHaveLength(0);
    }
  });

  it("P3 / D4：报名窗口长度跟随配置（默认 10 分钟、自定义值生效）", async () => {
    const before = process.env.DISPATCH_ROUND_WINDOW_MS;
    try {
      delete process.env.DISPATCH_ROUND_WINDOW_MS;
      const { orderId: defaultOrderId } = await publishedOrder();
      const defaultRound = await client.gameDispatchRound.findFirstOrThrow({
        where: { tenantId, orderId: defaultOrderId },
      });
      expect(
        defaultRound.closesAt.getTime() - defaultRound.opensAt.getTime(),
      ).toBe(10 * 60 * 1000);

      process.env.DISPATCH_ROUND_WINDOW_MS = "120000";
      const { orderId: customOrderId } = await publishedOrder();
      const customRound = await client.gameDispatchRound.findFirstOrThrow({
        where: { tenantId, orderId: customOrderId },
      });
      expect(
        customRound.closesAt.getTime() - customRound.opensAt.getTime(),
      ).toBe(120_000);
    } finally {
      if (before === undefined) delete process.env.DISPATCH_ROUND_WINDOW_MS;
      else process.env.DISPATCH_ROUND_WINDOW_MS = before;
    }
  });

  it("P3 / D4：报名窗口关闭后报名被拒 409", async () => {
    const { orderId, lineId } = await publishedOrder();
    // 把 closesAt 拨到过去 = 报名窗口已结束（等价于等到窗口自然结束）
    await client.gameDispatchRound.updateMany({
      where: { tenantId, orderId },
      data: { closesAt: new Date(Date.now() - 1000) },
    });
    const res = await req(playerToken).post(
      `${DISPATCH}/orders/${orderId}/lines/${lineId}/applications`,
    );
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain("报名通道已关闭");
  });
});

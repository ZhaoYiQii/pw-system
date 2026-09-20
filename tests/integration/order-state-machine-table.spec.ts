/**
 * ADR-0005 切片一：订单状态机的「代码实际迁移 ⊆ 集中迁移表」只读核对。
 *
 * 覆盖：
 * - 表内包含各模块实际使用的迁移（静态清单，来源见 ADR-0005 的背景表）；
 * - game-dispatch 主线跑一遍真实流程，把写进 order_events 的每一步 (from→to) 都用
 *   `canTransition` 复核；并断言开始/结束两步现在确实留了事件（切片一补齐）；
 * - 表外的迁移必须被拒绝（防止以后有人把"顺手改状态"当成合法迁移）。
 *
 * 本切片只做核对，不改变任何迁移行为（强制在 ADR-0005 切片二接入）。
 */
import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import {
  ORDER_TRANSITIONS,
  canTransition,
} from "../../apps/api/src/modules/orders/domain/order-state-machine.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "State-Table-Password-1";
const suffix = Date.now().toString(36);
const tenantCode = `stt_${suffix}`;
const DISPATCH = "/api/v1/tenant/game-dispatch";
const TEMPLATES = "/api/v1/tenant/game-templates";
const PRICING = "/api/v1/tenant/game-pricing";

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0,
]);

/** ADR-0005 背景表列出的「代码实际使用」迁移（模块 → from→to）。 */
const ACTUAL_TRANSITIONS: Array<[string, string, string]> = [
  ["orders 仓库（确认）", "DRAFT", "CONFIRMED"],
  ["orders 仓库（取消）", "DRAFT", "CANCELLED"],
  ["经典派单（发布）", "CONFIRMED", "DISPATCHING"],
  ["经典派单（选人）", "DISPATCHING", "ASSIGNED"],
  ["经典场次（就绪）", "ASSIGNED", "READY"],
  ["经典场次（开始）", "READY", "IN_PROGRESS"],
  ["经典场次（结束）", "IN_PROGRESS", "PENDING_CONFIRMATION"],
  ["经典核算（完成）", "PENDING_CONFIRMATION", "COMPLETED"],
  ["game-dispatch（发布，草稿直发）", "DRAFT", "DISPATCHING"],
  ["game-dispatch（选人）", "DISPATCHING", "ASSIGNED"],
  ["game-dispatch（开始服务）", "ASSIGNED", "IN_PROGRESS"],
  ["game-dispatch（释放名额）", "ASSIGNED", "DISPATCHING"],
  ["game-dispatch（结束服务）", "IN_PROGRESS", "PENDING_CONFIRMATION"],
  ["game-dispatch（确认结算）", "PENDING_CONFIRMATION", "COMPLETED"],
  ["worker 自动关单", "DISPATCHING", "CANCELLED"],
];

describe("ADR-0005：订单状态迁移表与代码实际行为核对", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId = "";
  let ownerToken = "";
  let playerToken = "";
  let customerToken = "";
  let customerId = "";
  let gameId = "";
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
      data: { code: tenantCode, name: "状态表核对店" },
    });
    tenantId = tenant.id;

    async function account(username: string, role: string) {
      const acc = await client.tenantAccount.create({
        data: { tenantId, username, passwordHash: hash },
      });
      await client.tenantAccountRole.create({
        data: { tenantId, tenantAccountId: acc.id, role: role as never },
      });
      return acc;
    }

    await account("boss", "TENANT_OWNER");
    const p1 = await account(`p1_${suffix}`, "PLAYER");
    await client.playerProfile.create({
      data: {
        tenantId,
        name: "状态陪玩",
        tenantAccountId: p1.id,
        basePricePerHourFen: 6000n,
      },
    });
    const customer = await client.customerProfile.create({
      data: { tenantId, name: "状态老板" },
    });
    customerId = customer.id;
    const custAcc = await account(`cb_${suffix}`, "CUSTOMER");
    await client.customerProfile.update({
      where: { id: customer.id },
      data: { tenantAccountId: custAcc.id },
    });
    const game = await client.game.create({
      data: { tenantId, name: `状态游戏-${suffix}` },
    });
    gameId = game.id;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(username: string) {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ kind: "tenant", tenantCode, username, password: PW })
        .expect(201);
      return (res.body as { data: { accessToken: string } }).data.accessToken;
    }

    ownerToken = await login("boss");
    playerToken = await login(`p1_${suffix}`);
    customerToken = await login(`cb_${suffix}`);

    const template = await request(app.getHttpServer())
      .post(TEMPLATES)
      .set("authorization", `Bearer ${ownerToken}`)
      .send({
        name: `状态模板-${suffix}`,
        fields: [{ fieldKey: "mode", label: "模式", fieldType: "text" }],
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
      .send({ items: [] })
      .expect(200);
  });

  afterAll(async () => {
    if (client) {
      await client.slotEvidence.deleteMany({ where: { tenantId } });
      await client.slotSession.deleteMany({ where: { tenantId } });
      await client.slotEarning.deleteMany({ where: { tenantId } });
      await client.orderSlot.deleteMany({ where: { tenantId } });
      await client.gameDispatchApplication.deleteMany({ where: { tenantId } });
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
      await client.order.deleteMany({ where: { tenantId } });
      await client.playerProfile.deleteMany({ where: { tenantId } });
      await client.walletEntry.deleteMany({ where: { tenantId } });
      await client.paymentOrder.deleteMany({ where: { tenantId } });
      await client.bossWallet.deleteMany({ where: { tenantId } });
      await client.customerProfile.deleteMany({ where: { tenantId } });
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
      await client.financeRateRule.deleteMany({ where: { tenantId } });
      // 兜底清理：任何仍引用该租户的行（不同流程可能产生的表）都先删掉，避免租户删除被外键挡住。
      for (const cleanup of [
        () => client.idempotencyRecord.deleteMany({ where: { tenantId } }),
        () => client.playerSkill.deleteMany({ where: { tenantId } }),
        () => client.playerGamePrice.deleteMany({ where: { tenantId } }),
        () => client.notificationDelivery.deleteMany({ where: { tenantId } }),
        () => client.outboxEvent.deleteMany({ where: { tenantId } }),
        () =>
          client.gameDispatchTemplateVersion.deleteMany({
            where: { tenantId },
          }),
        () =>
          client.gameDispatchTemplateSection.deleteMany({
            where: { tenantId },
          }),
        () => client.gameDispatchRankRule.deleteMany({ where: { tenantId } }),
        () => client.earning.deleteMany({ where: { tenantId } }),
        () => client.settlementItem.deleteMany({ where: { tenantId } }),
        () => client.settlementBatch.deleteMany({ where: { tenantId } }),
        () => client.orderPriceSnapshot.deleteMany({ where: { tenantId } }),
        () => client.serviceProduct.deleteMany({ where: { tenantId } }),
        () => client.tenantConfigVersion.deleteMany({ where: { tenantId } }),
        () => client.playerApplication.deleteMany({ where: { tenantId } }),
        () => client.dispatchPublication.deleteMany({ where: { tenantId } }),
        () => client.application.deleteMany({ where: { tenantId } }),
        () => client.assignment.deleteMany({ where: { tenantId } }),
      ]) {
        await cleanup().catch(() => undefined);
      }
      await client.tenant.deleteMany({ where: { id: tenantId } });
      await client.$disconnect();
    }
    if (app) await app.close();
  });

  function req(token: string) {
    const h = { authorization: `Bearer ${token}` };
    return {
      post: (u: string, b?: unknown) =>
        request(app.getHttpServer())
          .post(u)
          .set(h)
          .send(b ?? {}),
    };
  }

  it("集中迁移表包含各模块实际使用的迁移", () => {
    for (const [owner, from, to] of ACTUAL_TRANSITIONS) {
      expect(
        canTransition(
          from as keyof typeof ORDER_TRANSITIONS,
          to as keyof typeof ORDER_TRANSITIONS,
        ),
        `${owner}：${from} → ${to} 必须在表内`,
      ).toBe(true);
    }
    // 表外迁移仍应被拒绝（示例：已完成/已取消是终态，不能回退）。
    expect(canTransition("COMPLETED", "IN_PROGRESS")).toBe(false);
    expect(canTransition("CANCELLED", "DISPATCHING")).toBe(false);
    expect(canTransition("DISPATCHING", "IN_PROGRESS")).toBe(false);
  });

  it("game-dispatch 主线每一步状态迁移都写事件且都在表内（含开始/结束）", async () => {
    const draft = await req(ownerToken)
      .post(`${DISPATCH}/orders`, {
        templateId,
        customerProfileId: customerId,
        formValues: { mode: "single" },
        durationMinutes: 60,
        lines: [{ positionLabel: "打野", requiredCount: 1 }],
      })
      .expect(201);
    const orderId = (draft.body as { data: { orderId: string } }).data.orderId;
    const published = await req(ownerToken)
      .post(`${DISPATCH}/orders/${orderId}/publish`)
      .expect(201);
    const lineId = (published.body as { data: { lines: { id: string }[] } })
      .data.lines[0]?.id as string;
    const application = await req(playerToken)
      .post(`${DISPATCH}/orders/${orderId}/lines/${lineId}/applications`)
      .expect(201);
    await req(customerToken)
      .post("/api/v1/boss/wallet/recharge", { amountFen: "100000" })
      .expect(201);
    await req(ownerToken)
      .post(`${DISPATCH}/orders/${orderId}/assignment`, {
        applicationIds: [
          (application.body as { data: { id: string } }).data.id,
        ],
      })
      .expect(201);
    const slot = await client.orderSlot.findFirstOrThrow({
      where: { tenantId, orderId },
    });
    await req(playerToken)
      .post(`${DISPATCH}/slots/${slot.id}/session/start`)
      .expect(201);
    await new Promise((r) => setTimeout(r, 1100));
    await request(app.getHttpServer())
      .post(`${DISPATCH}/slots/${slot.id}/session/evidence?evidenceType=START`)
      .set("authorization", `Bearer ${playerToken}`)
      .set("x-file-name", "start.png")
      .send(PNG)
      .expect(201);
    await req(playerToken)
      .post(`${DISPATCH}/slots/${slot.id}/session/end`)
      .expect(201);

    const events = await client.orderEvent.findMany({
      where: { tenantId, orderId },
      orderBy: { occurredAt: "asc" },
    });
    const transitions = events
      .filter((e) => e.fromStatus !== null && e.toStatus !== null)
      .map((e) => `${e.fromStatus}→${e.toStatus}`);
    expect(transitions).toEqual([
      "DRAFT→DISPATCHING",
      "DISPATCHING→ASSIGNED",
      "ASSIGNED→IN_PROGRESS",
      "IN_PROGRESS→PENDING_CONFIRMATION",
    ]);
    // 表内校验：实际写下的每一步都能在集中表里找到。
    for (const event of events) {
      if (event.fromStatus === null || event.toStatus === null) continue;
      expect(
        canTransition(
          event.fromStatus as keyof typeof ORDER_TRANSITIONS,
          event.toStatus as keyof typeof ORDER_TRANSITIONS,
        ),
        `${event.eventType}：${event.fromStatus} → ${event.toStatus} 必须在表内`,
      ).toBe(true);
    }
    // ADR-0005 切片一补齐的两处事件。
    expect(events.map((e) => e.eventType)).toContain(
      "GAME_DISPATCH_SESSION_STARTED",
    );
    expect(events.map((e) => e.eventType)).toContain(
      "GAME_DISPATCH_SESSION_ENDED",
    );
  });
});

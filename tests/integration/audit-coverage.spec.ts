import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Audit-Password-1";
const suffix = Date.now().toString(36);

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

interface Data {
  accessToken?: string;
}

const VALID_CONFIG = {
  schemaVersion: "v1",
  brand: {
    primaryColor: "#123456",
    accentColor: "#abcdef",
    logoText: "审计店",
    borderRadius: 8,
  },
  storefront: {
    allowCustomerSelection: true,
    showServiceDuration: true,
  },
};

describe("C1 audit coverage: 关键写操作统一写入 audit_logs", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId: string;
  let tenantCode: string;
  let ownerToken: string;
  let financeToken: string;
  let playerToken: string;
  let platformToken: string;

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);
    tenantCode = `ac_${suffix}`;
    const t = await client.tenant.create({
      data: { code: tenantCode, name: "审计店" },
    });
    tenantId = t.id;
    await client.tenantEntitlement.createMany({
      data: [
        {
          tenantId,
          featureKey: "addon.customer_self_service",
          enabled: true,
          source: "test",
        },
        {
          tenantId,
          featureKey: "addon.player_order_hall",
          enabled: true,
          source: "test",
        },
      ],
    });

    const owner = await client.tenantAccount.create({
      data: { tenantId, username: "boss", passwordHash: hash },
    });
    await client.tenantAccountRole.create({
      data: { tenantId, tenantAccountId: owner.id, role: "TENANT_OWNER" },
    });
    const fin = await client.tenantAccount.create({
      data: { tenantId, username: "fin", passwordHash: hash },
    });
    await client.tenantAccountRole.create({
      data: { tenantId, tenantAccountId: fin.id, role: "FINANCE" },
    });

    await client.customerProfile.create({ data: { tenantId, name: "审计客" } });
    const playerAcc = await client.tenantAccount.create({
      data: { tenantId, username: "player", passwordHash: hash },
    });
    await client.tenantAccountRole.create({
      data: { tenantId, tenantAccountId: playerAcc.id, role: "PLAYER" },
    });
    const player = await client.playerProfile.create({
      data: { tenantId, name: "审计陪玩", tenantAccountId: playerAcc.id },
    });
    const game = await client.game.create({
      data: { tenantId, name: "审计游戏" },
    });
    const product = await client.serviceProduct.create({
      data: { tenantId, gameId: game.id, name: "审计产品" },
    });
    await client.pricingRule.create({
      data: {
        tenantId,
        serviceProductId: product.id,
        durationSeconds: 3600,
        priceFen: BigInt(20000),
        playerCostFen: BigInt(5000),
      },
    });
    await client.playerSkill.create({
      data: { tenantId, playerId: player.id, gameId: game.id },
    });

    await client.platformAccount.create({
      data: {
        username: `audit_platform_${suffix}`,
        passwordHash: hash,
        role: "PLATFORM_SUPER_ADMIN",
      },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(
      kind: "platform" | "tenant",
      username: string,
      password: string,
      code?: string,
    ): Promise<string> {
      const body: Record<string, string> = { kind, username, password };
      if (code) body.tenantCode = code;
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send(body)
        .expect(201);
      return (res.body as { data: Data }).data.accessToken as string;
    }

    ownerToken = await login("tenant", "boss", PW, tenantCode);
    financeToken = await login("tenant", "fin", PW, tenantCode);
    playerToken = await login("tenant", "player", PW, tenantCode);
    platformToken = await login("platform", `audit_platform_${suffix}`, PW);
  });

  afterAll(async () => {
    if (client) {
      await client.notificationDelivery.deleteMany({ where: { tenantId } });
      await client.outboxEvent.deleteMany({ where: { tenantId } });
      await client.auditLog.deleteMany({ where: { tenantId } });
      await client.manualPaymentRecord.deleteMany({ where: { tenantId } });
      await client.settlementItem.deleteMany({ where: { tenantId } });
      await client.settlementBatch.deleteMany({ where: { tenantId } });
      await client.earning.deleteMany({ where: { tenantId } });
      await client.ledgerEntry.deleteMany({ where: { tenantId } });
      await client.ledgerTransaction.deleteMany({ where: { tenantId } });
      await client.ledgerAccount.deleteMany({ where: { tenantId } });
      await client.disputeEvent.deleteMany({ where: { tenantId } });
      await client.dispute.deleteMany({ where: { tenantId } });
      await client.evidenceAsset.deleteMany({ where: { tenantId } });
      const sessions = await client.serviceSession.findMany({
        where: { tenantId },
      });
      for (const s of sessions) {
        await client.sessionAdjustment.deleteMany({
          where: { sessionId: s.id },
        });
        await client.sessionEvent.deleteMany({ where: { sessionId: s.id } });
      }
      await client.serviceSession.deleteMany({ where: { tenantId } });
      await client.assignment.deleteMany({ where: { tenantId } });
      await client.application.deleteMany({ where: { tenantId } });
      await client.dispatchPublication.deleteMany({ where: { tenantId } });
      const orders = await client.order.findMany({ where: { tenantId } });
      for (const o of orders) {
        await client.orderEvent.deleteMany({ where: { orderId: o.id } });
        await client.orderPriceSnapshot.deleteMany({
          where: { orderId: o.id },
        });
        await client.orderRequirement.deleteMany({ where: { orderId: o.id } });
      }
      await client.order.deleteMany({ where: { tenantId } });
      await client.playerSkill.deleteMany({ where: { tenantId } });
      await client.playerProfile.deleteMany({ where: { tenantId } });
      await client.customerProfile.deleteMany({ where: { tenantId } });
      await client.pricingRule.deleteMany({ where: { tenantId } });
      await client.serviceProduct.deleteMany({ where: { tenantId } });
      await client.game.deleteMany({ where: { tenantId } });
      await client.tenantEntitlement.deleteMany({ where: { tenantId } });
      await client.tenantConfigVersion.deleteMany({ where: { tenantId } });
      await client.financeRateRule.deleteMany({ where: { tenantId } });
      await client.tenantSubscription.deleteMany({ where: { tenantId } });
      await client.tenantAccountRole.deleteMany({ where: { tenantId } });
      await client.tenantAccount.deleteMany({ where: { tenantId } });
      await client.tenant.deleteMany({ where: { id: tenantId } });
      await client.platformAccount.deleteMany({
        where: { username: `audit_platform_${suffix}` },
      });
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
      patch: (u: string, b?: unknown) =>
        request(app.getHttpServer())
          .patch(u)
          .set(h)
          .send(b ?? {}),
    };
  }

  async function auditActions(): Promise<string[]> {
    const list = (await req(ownerToken).get("/api/v1/tenant/audit").expect(200))
      .body.data as Array<{ action: string }>;
    return list.map((r) => r.action);
  }

  it("订单→派单→场次→核算主链路全部写审计", async () => {
    const customers = (
      await req(ownerToken).get("/api/v1/tenant/customers").expect(200)
    ).body.data as Array<{ id: string }>;
    const customerId = customers[0]?.id as string;
    const games = (
      await req(ownerToken).get("/api/v1/tenant/catalog/games").expect(200)
    ).body.data as Array<{ id: string }>;
    const gameId = games[0]?.id as string;
    const products = (
      await req(ownerToken)
        .get(`/api/v1/tenant/catalog/products?gameId=${gameId}`)
        .expect(200)
    ).body.data as Array<{ id: string }>;
    const productId = products[0]?.id as string;

    const created = (
      await req(ownerToken)
        .post("/api/v1/tenant/orders", {
          customerProfileId: customerId,
          requirement: {
            description: "审计链路订单",
            serviceProductId: productId,
            durationSeconds: 3600,
          },
        })
        .expect(201)
    ).body.data as { id: string };

    const confirmed = (
      await req(ownerToken)
        .post(`/api/v1/tenant/orders/${created.id}/confirm`)
        .expect(201)
    ).body.data as { status: string };
    expect(confirmed.status).toBe("CONFIRMED");

    await req(ownerToken)
      .post(`/api/v1/tenant/orders/${created.id}/publish`)
      .expect(201);
    await req(playerToken)
      .post(`/api/v1/tenant/player/orders/${created.id}/applications`, {
        note: "报名审计单",
      })
      .expect(201);

    const apps = (
      await req(ownerToken)
        .get(`/api/v1/tenant/orders/${created.id}/applications`)
        .expect(200)
    ).body.data as Array<{ id: string }>;
    const appId = apps[0]?.id as string;
    await req(ownerToken)
      .post(
        `/api/v1/tenant/orders/${created.id}/applications/${appId}/shortlist`,
        { shortlisted: true },
      )
      .expect(201);
    const assigned = (
      await req(ownerToken)
        .post(`/api/v1/tenant/orders/${created.id}/assignment`, {
          applicationId: appId,
        })
        .expect(201)
    ).body.data as { id: string };
    expect(assigned.id).toBeTruthy();

    const start = (
      await req(playerToken)
        .post(`/api/v1/tenant/orders/${created.id}/session/start`)
        .expect(201)
    ).body.data as { id: string };
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1100));
    const ended = (
      await req(playerToken)
        .post(`/api/v1/tenant/orders/${created.id}/session/end`)
        .expect(201)
    ).body.data as { durationSeconds: number };
    expect(ended.durationSeconds).toBeGreaterThanOrEqual(1);

    const adjustment = (
      await req(ownerToken)
        .post(`/api/v1/tenant/sessions/${start.id}/adjustments`, {
          requestedDurationSeconds: ended.durationSeconds + 600,
          reason: "等待补时",
        })
        .expect(201)
    ).body.data as { status: string };
    expect(adjustment.status).toBe("ADJUSTMENT_PENDING");
    const detail = (
      await req(ownerToken)
        .get(`/api/v1/tenant/orders/${created.id}/session`)
        .expect(200)
    ).body.data as {
      adjustments: Array<{ id: string }>;
    };
    // 发起人不能复核自己的调整
    await req(ownerToken)
      .post(
        `/api/v1/tenant/sessions/${start.id}/adjustments/${detail.adjustments[0]?.id}/review`,
        { approve: true, comment: "自审应拒" },
      )
      .expect(409);
    // 财务复核通过
    await req(financeToken)
      .post(
        `/api/v1/tenant/sessions/${start.id}/adjustments/${detail.adjustments[0]?.id}/review`,
        { approve: true, comment: "财务同意" },
      )
      .expect(201);

    const accounting = (
      await req(ownerToken)
        .post(`/api/v1/tenant/orders/${created.id}/accounting`)
        .expect(201)
    ).body.data as { earningId: string };
    expect(accounting.earningId).toBeTruthy();

    const actions = await auditActions();
    for (const expected of [
      "auth.login",
      "order.create",
      "order.confirm",
      "dispatch.publish",
      "dispatch.apply",
      "dispatch.shortlist",
      "dispatch.assign",
      "session.start",
      "session.end",
      "session.adjustment.request",
      "session.adjustment.review",
      "ledger.accounting",
    ]) {
      expect(actions).toContain(expected);
    }
  });

  it("结算批次全流程写审计", async () => {
    const earning = await client.earning.findFirst({ where: { tenantId } });
    const earningId = earning?.id as string;

    const batch = (
      await req(ownerToken).post("/api/v1/tenant/settlements").expect(201)
    ).body.data as { id: string };
    await req(financeToken)
      .post(`/api/v1/tenant/settlements/${batch.id}/items`, {
        earningIds: [earningId],
      })
      .expect(201);
    await req(financeToken)
      .post(`/api/v1/tenant/settlements/${batch.id}/review`)
      .expect(201);
    await req(financeToken)
      .post(`/api/v1/tenant/settlements/${batch.id}/approve`)
      .expect(201);
    await req(ownerToken)
      .post(`/api/v1/tenant/settlements/${batch.id}/pay`)
      .expect(201);

    const actions = await auditActions();
    for (const expected of [
      "settlement.create",
      "settlement.add_items",
      "settlement.review",
      "settlement.approve",
      "settlement.pay",
    ]) {
      expect(actions).toContain(expected);
    }
  });

  it("配置保存/回滚、费率、平台功能开关与登录失败写审计", async () => {
    await req(ownerToken)
      .post("/api/v1/tenant/config", { config: VALID_CONFIG })
      .expect(201);
    await req(ownerToken)
      .post("/api/v1/tenant/config", { config: VALID_CONFIG })
      .expect(201);
    await req(ownerToken).post("/api/v1/tenant/config/rollback").expect(201);

    await req(ownerToken)
      .post("/api/v1/tenant/finance-rules/store-cut", { storeCutBp: 2500 })
      .expect(201);
    await req(platformToken)
      .patch(`/api/v1/platform/tenants/${tenantId}/finance-rules`, {
        platformFeeBp: 400,
      })
      .expect(200);
    await req(platformToken)
      .post(`/api/v1/platform/tenants/${tenantId}/entitlements`, {
        featureKey: "addon.ai_requirement_parser",
        enabled: true,
      })
      .expect(201);

    // 登录失败（有效账号+错误密码）应产生 auth.login_failed
    await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({
        kind: "tenant",
        tenantCode,
        username: "boss",
        password: "wrong-password",
      })
      .expect(401);

    const actions = await auditActions();
    for (const expected of [
      "tenant-config.save",
      "tenant-config.rollback",
      "finance-rules.store-cut",
      "finance-rules.platform-fee",
      "entitlement.set",
      "auth.login_failed",
    ]) {
      expect(actions).toContain(expected);
    }
  });

  it("审计读取脱敏手机号/密钥值；平台只读审计需要 reason 并落审计", async () => {
    const account = await client.tenantAccount.findFirst({
      where: { tenantId, username: "boss" },
    });
    await client.auditLog.create({
      data: {
        tenantId,
        actorType: "tenant_account",
        actorId: account?.id ?? null,
        action: "debug.pii",
        summary: "手机 13800138000 token=abc123456",
      },
    });
    const rows = (await req(ownerToken).get("/api/v1/tenant/audit").expect(200))
      .body.data as Array<{ action: string; summary: string | null }>;
    const pii = rows.find((r) => r.action === "debug.pii");
    expect(pii?.summary).toContain("138****8000");
    expect(pii?.summary).not.toContain("13800138000");
    expect(pii?.summary).not.toContain("abc123456");

    await request(app.getHttpServer())
      .get(`/api/v1/platform/tenants/${tenantId}/audit`)
      .set("authorization", `Bearer ${platformToken}`)
      .expect(400);
    const platformRows = (
      await request(app.getHttpServer())
        .get(`/api/v1/platform/tenants/${tenantId}/audit?reason=合规核查`)
        .set("authorization", `Bearer ${platformToken}`)
        .expect(200)
    ).body.data as Array<{ action: string; summary: string | null }>;
    expect(platformRows.some((r) => r.action === "platform.audit.read")).toBe(
      true,
    );
  });
});

import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "StateMachine-1";
const suffix = Date.now().toString(36);
function envOrThrow(name: string): string { const v = process.env[name]; if (!v) throw new Error(`missing env ${name}`); return v; }

describe("B1 order state machine (完整迁移链，无跳状态)", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId: string;
  let ownerToken: string;
  let playerToken: string;
  let customerToken: string;

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);
    const t = await client.tenant.create({ data: { code: `sm_${suffix}`, name: "状态机店" } });
    tenantId = t.id;
    await client.tenantEntitlement.createMany({ data: [ { tenantId: tenantId, featureKey: "addon.customer_self_service", enabled: true, source: "test" }, { tenantId: tenantId, featureKey: "addon.player_order_hall", enabled: true, source: "test" } ] });
    const owner = await client.tenantAccount.create({ data: { tenantId, username: "boss", passwordHash: hash } });
    await client.tenantAccountRole.create({ data: { tenantId, tenantAccountId: owner.id, role: "TENANT_OWNER" } });
    const pAcc = await client.tenantAccount.create({ data: { tenantId, username: "player", passwordHash: hash } });
    await client.tenantAccountRole.create({ data: { tenantId, tenantAccountId: pAcc.id, role: "PLAYER" } });
    const player = await client.playerProfile.create({ data: { tenantId, name: "状态机陪玩", tenantAccountId: pAcc.id } });
    const custAcc = await client.tenantAccount.create({ data: { tenantId, username: "customer", passwordHash: hash } });
    await client.tenantAccountRole.create({ data: { tenantId, tenantAccountId: custAcc.id, role: "CUSTOMER" } });
    const cust = await client.customerProfile.create({ data: { tenantId, name: "状态机客", tenantAccountId: custAcc.id } });
    const game = await client.game.create({ data: { tenantId, name: "游戏" } });
    const product = await client.serviceProduct.create({ data: { tenantId, gameId: game.id, name: "产品" } });
    await client.pricingRule.create({ data: { tenantId, serviceProductId: product.id, durationSeconds: 3600, priceFen: BigInt(10000), playerCostFen: BigInt(0) } });
    await client.playerSkill.create({ data: { tenantId, playerId: player.id, gameId: game.id } });
    void cust;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    async function login(username: string) {
      const res = await request(app.getHttpServer()).post("/api/v1/auth/login").send({ kind: "tenant", tenantCode: t.code, username, password: PW }).expect(201);
      return (res.body as { data: { accessToken: string } }).data.accessToken;
    }
    ownerToken = await login("boss");
    playerToken = await login("player");
    customerToken = await login("customer");
  });

  afterAll(async () => {
    if (client) {
      await client.outboxEvent.deleteMany({ where: { tenantId } });
      await client.auditLog.deleteMany({ where: { tenantId } });
      await client.ledgerEntry.deleteMany({ where: { tenantId } });
      await client.ledgerTransaction.deleteMany({ where: { tenantId } });
      await client.ledgerAccount.deleteMany({ where: { tenantId } });
      await client.earning.deleteMany({ where: { tenantId } });
      const sessions = await client.serviceSession.findMany({ where: { tenantId } });
      for (const s of sessions) { await client.sessionAdjustment.deleteMany({ where: { sessionId: s.id } }); await client.sessionEvent.deleteMany({ where: { sessionId: s.id } }); }
      await client.serviceSession.deleteMany({ where: { tenantId } });
      await client.assignment.deleteMany({ where: { tenantId } });
      await client.application.deleteMany({ where: { tenantId } });
      await client.dispatchPublication.deleteMany({ where: { tenantId } });
      const orders = await client.order.findMany({ where: { tenantId } });
      for (const o of orders) { await client.orderEvent.deleteMany({ where: { orderId: o.id } }); await client.orderPriceSnapshot.deleteMany({ where: { orderId: o.id } }); await client.orderRequirement.deleteMany({ where: { orderId: o.id } }); }
      await client.order.deleteMany({ where: { tenantId } });
      await client.playerSkill.deleteMany({ where: { tenantId } });
      await client.playerProfile.deleteMany({ where: { tenantId } });
      await client.customerProfile.deleteMany({ where: { tenantId } });
      await client.pricingRule.deleteMany({ where: { tenantId } });
      await client.serviceProduct.deleteMany({ where: { tenantId } });
      await client.game.deleteMany({ where: { tenantId } });
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
    return { get: (u: string) => request(app.getHttpServer()).get(u).set(h), post: (u: string, b?: unknown) => request(app.getHttpServer()).post(u).set(h).send(b ?? {}) };
  }

  async function makeOrder(status?: string): Promise<{ id: string }> {
    const customers = (await req(ownerToken).get("/api/v1/tenant/customers").expect(200)).body.data as Array<{ id: string }>;
    const games = (await req(ownerToken).get("/api/v1/tenant/catalog/games").expect(200)).body.data as Array<{ id: string }>;
    const products = (await req(ownerToken).get(`/api/v1/tenant/catalog/products?gameId=${games[0]?.id}`).expect(200)).body.data as Array<{ id: string }>;
    if (status) {
      const row = await client.order.create({ data: { tenantId, orderNo: `smc_${Date.now().toString(36)}`, customerProfileId: customers[0]?.id as string, status: status as never } });
      return { id: row.id };
    }
    const created = (await req(ownerToken).post("/api/v1/tenant/orders", {
      customerProfileId: customers[0]?.id,
      requirement: { description: "状态机主链", serviceProductId: products[0]?.id, durationSeconds: 3600 }
    }).expect(201)).body.data as { id: string };
    return created;
  }

  it("完整迁移链：ASSIGNED→READY→IN_PROGRESS→PENDING_CONFIRMATION→COMPLETED", async () => {
    const customers = (await req(ownerToken).get("/api/v1/tenant/customers").expect(200)).body.data as Array<{ id: string }>;
    const games = (await req(ownerToken).get("/api/v1/tenant/catalog/games").expect(200)).body.data as Array<{ id: string }>;
    const products = (await req(ownerToken).get(`/api/v1/tenant/catalog/products?gameId=${games[0]?.id}`).expect(200)).body.data as Array<{ id: string }>;
    const order = (await req(ownerToken).post("/api/v1/tenant/orders", {
      customerProfileId: customers[0]?.id,
      requirement: { description: "状态机主链", serviceProductId: products[0]?.id, durationSeconds: 3600 }
    }).expect(201)).body.data as { id: string };

    await req(ownerToken).post(`/api/v1/tenant/orders/${order.id}/confirm`).expect(201);
    await req(ownerToken).post(`/api/v1/tenant/orders/${order.id}/publish`).expect(201);
    await req(playerToken).post(`/api/v1/tenant/player/orders/${order.id}/applications`).expect(201);
    const apps = (await req(ownerToken).get(`/api/v1/tenant/orders/${order.id}/applications`).expect(200)).body.data as Array<{ id: string }>;
    await req(ownerToken).post(`/api/v1/tenant/orders/${order.id}/assignment`, { applicationId: apps[0]?.id }).expect(201);

    let view = (await req(ownerToken).get(`/api/v1/tenant/orders/${order.id}`).expect(200)).body.data as { status: string };
    expect(view.status).toBe("ASSIGNED");

    await req(playerToken).post(`/api/v1/tenant/orders/${order.id}/session/start`).expect(201);
    view = (await req(ownerToken).get(`/api/v1/tenant/orders/${order.id}`).expect(200)).body.data as { status: string; timeline: Array<{ eventType: string }> };
    expect(view.status).toBe("IN_PROGRESS");
    expect(view.timeline.map((e) => e.eventType)).toEqual(expect.arrayContaining(["ORDER_READY", "ORDER_STARTED"]));

    await new Promise((r) => setTimeout(r, 1100));
    await req(playerToken).post(`/api/v1/tenant/orders/${order.id}/session/end`).expect(201);
    view = (await req(ownerToken).get(`/api/v1/tenant/orders/${order.id}`).expect(200)).body.data as { status: string; timeline: Array<{ eventType: string }> };
    expect(view.status).toBe("PENDING_CONFIRMATION");
    expect(view.timeline.filter((e) => e.eventType === "ORDER_SESSION_ENDED")).toHaveLength(1);

    const accounted = (await req(customerToken).post(`/api/v1/tenant/customer/orders/${order.id}/complete`).expect(201)).body.data as { earningId: string };
    expect(accounted.earningId).toBeTruthy();
    view = (await req(ownerToken).get(`/api/v1/tenant/orders/${order.id}`).expect(200)).body.data as { status: string; timeline: Array<{ eventType: string; fromStatus: string | null; toStatus: string | null }> };
    expect(view.status).toBe("COMPLETED");
    const accountedEvent = view.timeline.find((e) => e.eventType === "ORDER_ACCOUNTED");
    expect(accountedEvent?.fromStatus).toBe("PENDING_CONFIRMATION");
    expect(accountedEvent?.toStatus).toBe("COMPLETED");
    const sessionView = (await req(ownerToken).get(`/api/v1/tenant/orders/${order.id}/session`).expect(200)).body.data as { status: string };
    expect(sessionView.status).toBe("CONFIRMED");
  });

  it("DISPATCHING 订单可直接取消（状态机可取消集合）", async () => {
    const order = await makeOrder();
    await req(ownerToken).post(`/api/v1/tenant/orders/${order.id}/confirm`).expect(201);
    await req(ownerToken).post(`/api/v1/tenant/orders/${order.id}/publish`).expect(201);
    const cancelled = (await req(ownerToken).post(`/api/v1/tenant/orders/${order.id}/cancel`, { reason: "临时取消" }).expect(201)).body.data as { status: string };
    expect(cancelled.status).toBe("CANCELLED");
  });
});

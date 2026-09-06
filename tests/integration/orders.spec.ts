import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Slice5-Password-1";
const suffix = Date.now().toString(36);

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

interface Data { accessToken?: string }

describe("Slice 5 orders (DRAFT->CONFIRMED / 快照稳定 / 幂等 / Outbox)", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantCode: string;
  let ownerToken: string;

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);
    tenantCode = `o5_${suffix}`;
    const t = await client.tenant.create({ data: { code: tenantCode, name: "订单店" } });
    const owner = await client.tenantAccount.create({ data: { tenantId: t.id, username: "boss", passwordHash: hash } });
    await client.tenantAccountRole.create({ data: { tenantId: t.id, tenantAccountId: owner.id, role: "TENANT_OWNER" } });
    await client.customerProfile.create({ data: { tenantId: t.id, name: "下单客" } });
    const game = await client.game.create({ data: { tenantId: t.id, name: "英雄联盟" } });
    const product = await client.serviceProduct.create({ data: { tenantId: t.id, gameId: game.id, name: "LOL 陪玩1小时" } });
    await client.pricingRule.create({
      data: { tenantId: t.id, serviceProductId: product.id, durationSeconds: 3600, priceFen: BigInt(2000), playerCostFen: BigInt(1000) }
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ kind: "tenant", tenantCode, username: "boss", password: PW })
      .expect(201);
    ownerToken = (login.body as { data: Data }).data.accessToken as string;
  });

  afterAll(async () => {
    if (client) {
      const tenants = await client.tenant.findMany({ where: { code: tenantCode } });
      for (const t of tenants) {
        const orders = await client.order.findMany({ where: { tenantId: t.id } });
        for (const o of orders) {
          await client.orderEvent.deleteMany({ where: { orderId: o.id } });
          await client.orderPriceSnapshot.deleteMany({ where: { orderId: o.id } });
          await client.orderRequirement.deleteMany({ where: { orderId: o.id } });
        }
        await client.order.deleteMany({ where: { tenantId: t.id } });
        await client.pricingRule.deleteMany({ where: { tenantId: t.id } });
        await client.serviceProduct.deleteMany({ where: { tenantId: t.id } });
        await client.game.deleteMany({ where: { tenantId: t.id } });
        await client.customerProfile.deleteMany({ where: { tenantId: t.id } });
        await client.idempotencyRecord.deleteMany({ where: { tenantId: t.id } });
        await client.tenantAccountRole.deleteMany({ where: { tenantId: t.id } });
        await client.tenantAccount.deleteMany({ where: { tenantId: t.id } });
        await client.tenant.deleteMany({ where: { id: t.id } });
      }
      await client.$disconnect();
    }
    if (app) await app.close();
  });

  function req(token: string) {
    const headers = { authorization: `Bearer ${token}` };
    return {
      get: (u: string) => request(app.getHttpServer()).get(u).set(headers),
      post: (u: string) => request(app.getHttpServer()).post(u).set(headers),
      patch: (u: string) => request(app.getHttpServer()).patch(u).set(headers)
    };
  }

  async function setupProduct(priceFen: number) {
    const games = await req(ownerToken).get("/api/v1/tenant/catalog/games").expect(200);
    const gameId = (games.body.data as Array<{ id: string }>)[0]?.id as string;
    const pname = `产品${Date.now().toString(36)}`;
    const product = await req(ownerToken).post("/api/v1/tenant/catalog/products").send({ gameId, name: pname }).expect(201);
    const productId = (product.body.data as { id: string }).id;
    await req(ownerToken).post(`/api/v1/tenant/catalog/products/${productId}/pricing`).send({ durationSeconds: 3600, priceFen }).expect(201);
    return { gameId, productId };
  }

  it("创建草稿、缺需求/缺产品被拒、确认生成快照并进入 CONFIRMED", async () => {
    const customers = await req(ownerToken).get("/api/v1/tenant/customers").expect(200);
    const customerId = (customers.body.data as Array<{ id: string }>)[0]?.id as string;
    const { gameId, productId } = await setupProduct(2100);

    // 缺 description
    await req(ownerToken).post("/api/v1/tenant/orders").send({ customerProfileId: customerId, requirement: { serviceProductId: productId, durationSeconds: 3600 } }).expect(400);
    // 合法草稿（先不带产品）
    const draftRes = await req(ownerToken).post("/api/v1/tenant/orders").send({
      customerProfileId: customerId,
      requirement: { description: "找陪玩带排位，要求意识好", gameId, durationSeconds: 3600 }
    }).expect(201);
    const draft = draftRes.body.data as { id: string; status: string; orderNo: string };
    expect(draft.status).toBe("DRAFT");
    expect(draft.orderNo).toBeTruthy();

    // 缺产品不能确认
    await req(ownerToken).post(`/api/v1/tenant/orders/${draft.id}/confirm`).expect(400);

    // 带产品重新建草稿并确认
    const okRes = await req(ownerToken).post("/api/v1/tenant/orders").send({
      customerProfileId: customerId,
      requirement: { description: "找陪玩带排位", serviceProductId: productId, durationSeconds: 3600 }
    }).expect(201);
    const ok = okRes.body.data as { id: string; status: string };
    const confirmed = await req(ownerToken).post(`/api/v1/tenant/orders/${ok.id}/confirm`).expect(201);
    const view = confirmed.body.data as { status: string; snapshot: Array<{ unitPriceFen: number }>; timeline: Array<{ eventType: string }> };
    expect(view.status).toBe("CONFIRMED");
    expect(view.snapshot[0]?.unitPriceFen).toBe(2100);
    const eventTypes = view.timeline.map((e) => e.eventType);
    expect(eventTypes).toContain("ORDER_CREATED");
    expect(eventTypes).toContain("SNAPSHOT_CREATED");
    expect(eventTypes).toContain("ORDER_CONFIRMED");
    // 重复确认 409
    await req(ownerToken).post(`/api/v1/tenant/orders/${ok.id}/confirm`).expect(409);

    // Outbox 事件已写入
    const tenants = await client.tenant.findMany({ where: { code: tenantCode } });
    const count = await client.outboxEvent.count({ where: { tenantId: tenants[0]?.id, eventType: "order.confirmed" } });
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("价格修改不影响已确认旧订单快照；新订单用新价", async () => {
    const customers = await req(ownerToken).get("/api/v1/tenant/customers").expect(200);
    const customerId = (customers.body.data as Array<{ id: string }>)[0]?.id as string;
    const { productId } = await setupProduct(5000);
    const first = await req(ownerToken).post("/api/v1/tenant/orders").send({
      customerProfileId: customerId,
      requirement: { description: "第一单", serviceProductId: productId, durationSeconds: 3600 }
    }).expect(201);
    const firstView = (await req(ownerToken).post(`/api/v1/tenant/orders/${(first.body.data as { id: string }).id}/confirm`).expect(201)).body.data as {
      id: string;
      snapshot: Array<{ unitPriceFen: number }>;
    };
    expect(firstView.snapshot[0]?.unitPriceFen).toBe(5000);

    // 改价 7000
    const rules = await req(ownerToken).get(`/api/v1/tenant/catalog/products/${productId}/pricing`).expect(200);
    const ruleId = (rules.body.data as Array<{ id: string }>)[0]?.id as string;
    await req(ownerToken).patch(`/api/v1/tenant/catalog/pricing/${ruleId}`).send({ priceFen: 7000 }).expect(200);

    const second = await req(ownerToken).post("/api/v1/tenant/orders").send({
      customerProfileId: customerId,
      requirement: { description: "第二单", serviceProductId: productId, durationSeconds: 3600 }
    }).expect(201);
    const secondView = (await req(ownerToken).post(`/api/v1/tenant/orders/${(second.body.data as { id: string }).id}/confirm`).expect(201)).body.data as {
      snapshot: Array<{ unitPriceFen: number }>;
    };
    expect(secondView.snapshot[0]?.unitPriceFen).toBe(7000);

    const oldView = (await req(ownerToken).get(`/api/v1/tenant/orders/${firstView.id}`).expect(200)).body.data as {
      snapshot: Array<{ unitPriceFen: number }>;
    };
    expect(oldView.snapshot[0]?.unitPriceFen).toBe(5000);
  });

  it("幂等：同 idempotencyKey 重复创建返回同一订单", async () => {
    const customers = await req(ownerToken).get("/api/v1/tenant/customers").expect(200);
    const customerId = (customers.body.data as Array<{ id: string }>)[0]?.id as string;
    const key = `idem-${suffix}`;
    const { gameId } = await setupProduct(1000);
    const body = { customerProfileId: customerId, idempotencyKey: key, requirement: { description: "幂等单", gameId } };
    const a = (await req(ownerToken).post("/api/v1/tenant/orders").send(body).expect(201)).body.data as { id: string };
    const b = (await req(ownerToken).post("/api/v1/tenant/orders").send(body).expect(201)).body.data as { id: string };
    expect(a.id).toBe(b.id);
  });

  it("取消 CONFIRMED 订单成功；重复取消 409", async () => {
    const customers = await req(ownerToken).get("/api/v1/tenant/customers").expect(200);
    const customerId = (customers.body.data as Array<{ id: string }>)[0]?.id as string;
    const { productId } = await setupProduct(900);
    const order = await req(ownerToken).post("/api/v1/tenant/orders").send({
      customerProfileId: customerId,
      requirement: { description: "取消单", serviceProductId: productId, durationSeconds: 3600 }
    }).expect(201);
    await req(ownerToken).post(`/api/v1/tenant/orders/${(order.body.data as { id: string }).id}/confirm`).expect(201);
    const cancelled = await req(ownerToken).post(`/api/v1/tenant/orders/${(order.body.data as { id: string }).id}/cancel`).send({ reason: "客户改期" }).expect(201);
    expect((cancelled.body.data as { status: string }).status).toBe("CANCELLED");
    await req(ownerToken).post(`/api/v1/tenant/orders/${(order.body.data as { id: string }).id}/cancel`).expect(409);
  });
});
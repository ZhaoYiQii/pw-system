import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Slice6-Password-1";
const suffix = Date.now().toString(36);
function envOrThrow(name: string): string { const v = process.env[name]; if (!v) throw new Error(`missing env ${name}`); return v; }
interface Data { accessToken?: string }

describe("Slice 6 dispatch (publish/apply/shortlist/assign 并发与冲突)", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId: string;
  let tenantCode: string;
  let ownerToken: string;
  let p1Token: string;
  let p2Token: string;
  let productId: string;

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);
    tenantCode = `d6_${suffix}`;
    const t = await client.tenant.create({ data: { code: tenantCode, name: "派单店" } });
    tenantId = t.id;
    const owner = await client.tenantAccount.create({ data: { tenantId, username: "boss", passwordHash: hash } });
    await client.tenantAccountRole.create({ data: { tenantId, tenantAccountId: owner.id, role: "TENANT_OWNER" } });
    const customer = await client.customerProfile.create({ data: { tenantId, name: "派单客" } });
    const game = await client.game.create({ data: { tenantId, name: "绝地求生" } });
    const product = await client.serviceProduct.create({ data: { tenantId, gameId: game.id, name: "吃鸡陪玩" } });
    productId = product.id;
    await client.pricingRule.create({ data: { tenantId, serviceProductId: product.id, durationSeconds: 3600, priceFen: BigInt(3000), playerCostFen: BigInt(1500) } });

    async function makePlayer(username: string, name: string) {
      const acc = await client.tenantAccount.create({ data: { tenantId, username, passwordHash: hash } });
      await client.tenantAccountRole.create({ data: { tenantId, tenantAccountId: acc.id, role: "PLAYER" } });
      const profile = await client.playerProfile.create({ data: { tenantId, name, tenantAccountId: acc.id } });
      await client.playerSkill.create({ data: { tenantId, playerId: profile.id, gameId: game.id } });
      return { acc, profile };
    }
    await makePlayer(`p1_${suffix}`, "陪玩一");
    await makePlayer(`p2_${suffix}`, "陪玩二");

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    async function login(username: string) {
      const res = await request(app.getHttpServer()).post("/api/v1/auth/login").send({ kind: "tenant", tenantCode, username, password: PW }).expect(201);
      return (res.body as { data: Data }).data.accessToken as string;
    }
    ownerToken = await login("boss");
    p1Token = await login(`p1_${suffix}`);
    p2Token = await login(`p2_${suffix}`);
    void customer;
  });

  afterAll(async () => {
    if (client) {
      const ids = await client.tenant.findMany({ where: { id: tenantId } });
      if (ids.length > 0) {
        await client.assignment.deleteMany({ where: { tenantId } });
        await client.application.deleteMany({ where: { tenantId } });
        await client.dispatchPublication.deleteMany({ where: { tenantId } });
        const orders = await client.order.findMany({ where: { tenantId } });
        for (const o of orders) {
          await client.orderEvent.deleteMany({ where: { orderId: o.id } });
          await client.orderPriceSnapshot.deleteMany({ where: { orderId: o.id } });
          await client.orderRequirement.deleteMany({ where: { orderId: o.id } });
        }
        await client.order.deleteMany({ where: { tenantId } });
        await client.playerSkill.deleteMany({ where: { tenantId } });
        await client.playerAvailability.deleteMany({ where: { tenantId } });
        await client.playerProfile.deleteMany({ where: { tenantId } });
        await client.pricingRule.deleteMany({ where: { tenantId } });
        await client.serviceProduct.deleteMany({ where: { tenantId } });
        await client.game.deleteMany({ where: { tenantId } });
        await client.customerProfile.deleteMany({ where: { tenantId } });
        await client.tenantAccountRole.deleteMany({ where: { tenantId } });
        await client.tenantAccount.deleteMany({ where: { tenantId } });
        await client.tenant.deleteMany({ where: { id: tenantId } });
      }
      await client.$disconnect();
    }
    if (app) await app.close();
  });

  function req(token: string) {
    const headers = { authorization: `Bearer ${token}` };
    return {
      get: (u: string) => request(app.getHttpServer()).get(u).set(headers),
      post: (u: string, b?: unknown) => request(app.getHttpServer()).post(u).set(headers).send(b ?? {})
    };
  }

  async function makeConfirmedOrder() {
    const customers = await client.customerProfile.findFirst({ where: { tenantId } });
    const res = await req(ownerToken).post("/api/v1/tenant/orders", {
      customerProfileId: customers?.id,
      requirement: { description: "四排缺一，稳定吃鸡", serviceProductId: productId, durationSeconds: 3600 }
    }).expect(201);
    const order = res.body.data as { id: string };
    await req(ownerToken).post(`/api/v1/tenant/orders/${order.id}/confirm`).expect(201);
    return order.id;
  }

  it("发布→双人报名→短名单→并发选人仅一人成功且其余过期", async () => {
    const orderId = await makeConfirmedOrder();
    await req(ownerToken).post(`/api/v1/tenant/orders/${orderId}/publish`).expect(201);
    await req(p1Token).post(`/api/v1/tenant/player/orders/${orderId}/applications`).expect(201);
    await req(p2Token).post(`/api/v1/tenant/player/orders/${orderId}/applications`).expect(201);

    const apps = (await req(ownerToken).get(`/api/v1/tenant/orders/${orderId}/applications`).expect(200)).body.data as Array<{ id: string }>;
    expect(apps).toHaveLength(2);

    const [a, b] = await Promise.all([
      req(ownerToken).post(`/api/v1/tenant/orders/${orderId}/assignment`, { applicationId: apps[0]?.id }),
      req(ownerToken).post(`/api/v1/tenant/orders/${orderId}/assignment`, { applicationId: apps[1]?.id })
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await client.assignment.count({ where: { tenantId, orderId } })).toBe(1);
    expect((await client.order.findFirst({ where: { tenantId, id: orderId } }))?.status).toBe("ASSIGNED");
    expect((await client.dispatchPublication.findFirst({ where: { tenantId, orderId } }))?.status).toBe("CLOSED");
    const appRows = await client.application.findMany({ where: { tenantId, orderId } });
    expect(appRows.filter((r) => r.status === "SELECTED")).toHaveLength(1);
    expect(appRows.filter((r) => r.status === "EXPIRED").length + 1).toBe(2);
    await req(ownerToken).post(`/api/v1/tenant/orders/${orderId}/assignment`, { applicationId: apps[0]?.id }).expect(409);
  });

  it("重复报名 409；时间冲突报名 400", async () => {
    const o1 = await makeConfirmedOrder();
    await req(ownerToken).post(`/api/v1/tenant/orders/${o1}/publish`).expect(201);
    await req(p1Token).post(`/api/v1/tenant/player/orders/${o1}/applications`).expect(201);
    await req(p1Token).post(`/api/v1/tenant/player/orders/${o1}/applications`).expect(409);

    const p1row = await client.playerProfile.findFirst({ where: { tenantId, name: "陪玩一" } });
    await client.playerAvailability.create({
      data: { tenantId, playerId: p1row?.id as string, startsAt: new Date("2031-01-01T10:00:00Z"), endsAt: new Date("2031-01-01T14:00:00Z") }
    });
    const customers = await client.customerProfile.findFirst({ where: { tenantId } });
    const res = await req(ownerToken).post("/api/v1/tenant/orders", {
      customerProfileId: customers?.id,
      requirement: { description: "冲突测试单", serviceProductId: productId, durationSeconds: 3600, desiredStartAt: "2031-01-01T12:00:00Z" }
    }).expect(201);
    const o2 = (res.body.data as { id: string }).id;
    await req(ownerToken).post(`/api/v1/tenant/orders/${o2}/confirm`).expect(201);
    await req(ownerToken).post(`/api/v1/tenant/orders/${o2}/publish`).expect(201);
    await req(p1Token).post(`/api/v1/tenant/player/orders/${o2}/applications`).expect(400);
  });
});
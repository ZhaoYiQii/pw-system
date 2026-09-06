import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Ai-Password-1";
const suffix = Date.now().toString(36);
function envOrThrow(name: string): string { const v = process.env[name]; if (!v) throw new Error(`missing env ${name}`); return v; }
interface Data { accessToken?: string }

describe("Slice 10 AI (deterministic/不可用标记/合法候选)", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId: string;
  let orderId = "";
  let ownerToken: string;

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);
    const t = await client.tenant.create({ data: { code: `ai_${suffix}`, name: "AI店" } });
    tenantId = t.id;
    const owner = await client.tenantAccount.create({ data: { tenantId, username: "boss", passwordHash: hash } });
    await client.tenantAccountRole.create({ data: { tenantId, tenantAccountId: owner.id, role: "TENANT_OWNER" } });
    const cust = await client.customerProfile.create({ data: { tenantId, name: "AI客" } });
    const game = await client.game.create({ data: { tenantId, name: "无畏契约" } });
    const product = await client.serviceProduct.create({ data: { tenantId, gameId: game.id, name: "双排1h" } });
    const p1 = await client.playerProfile.create({ data: { tenantId, name: "有技能" } });
    const p2 = await client.playerProfile.create({ data: { tenantId, name: "无技能" } });
    await client.playerSkill.create({ data: { tenantId, playerId: p1.id, gameId: game.id } });
    const order = await client.order.create({ data: { tenantId, orderNo: `aio-${suffix}`, customerProfileId: cust.id, status: "DISPATCHING" } });
    orderId = order.id;
    await client.orderRequirement.create({ data: { tenantId, orderId: order.id, description: "双排", serviceProductId: product.id, durationSeconds: 3600 } });
    void p2;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const login = await request(app.getHttpServer()).post("/api/v1/auth/login").send({ kind: "tenant", tenantCode: t.code, username: "boss", password: PW }).expect(201);
    ownerToken = (login.body as { data: Data }).data.accessToken as string;
  });

  afterAll(async () => {
    if (client) {
      await client.aiSuggestion.deleteMany({ where: { tenantId } });
      await client.aiRun.deleteMany({ where: { tenantId } });
      await client.orderRequirement.deleteMany({ where: { tenantId } });
      await client.orderEvent.deleteMany({ where: { tenantId: { in: [tenantId] } } }).catch(() => undefined);
      const orders = await client.order.findMany({ where: { tenantId } });
      for (const o of orders) await client.orderEvent.deleteMany({ where: { orderId: o.id } });
      await client.order.deleteMany({ where: { tenantId } });
      await client.playerSkill.deleteMany({ where: { tenantId } });
      await client.playerProfile.deleteMany({ where: { tenantId } });
      await client.serviceProduct.deleteMany({ where: { tenantId } });
      await client.game.deleteMany({ where: { tenantId } });
      await client.customerProfile.deleteMany({ where: { tenantId } });
      await client.tenantAccountRole.deleteMany({ where: { tenantId } });
      await client.tenantAccount.deleteMany({ where: { tenantId } });
      await client.tenant.deleteMany({ where: { id: tenantId } });
      await client.$disconnect();
    }
    if (app) await app.close();
  });

  function req(token: string) {
    const h = { authorization: `Bearer ${token}` };
    return { get: (u: string) => request(app.getHttpServer()).get(u).set(h), post: (u: string, b?: unknown) => request(app.getHttpServer()).post(u).set(h).send(b ?? {}) };
  }

  it("capabilities 明确不可用；缺失检查 NEEDS_REVIEW；候选仅合法集合", async () => {
    const caps = (await req(ownerToken).get("/api/v1/tenant/ai/capabilities").expect(200)).body.data as { supported: boolean; reason: string };
    expect(caps.supported).toBe(false);
    expect(caps.reason).toContain("AI_PROVIDER_NOT_CONFIGURED");

    const partial = (await req(ownerToken).post("/api/v1/tenant/ai/parse-requirement", { description: "双排上分" }).expect(201)).body.data as {
      status: string;
      missing: string[];
    };
    expect(partial.status).toBe("NEEDS_REVIEW");
    expect(partial.missing).toContain("serviceProductId");
    expect(partial.missing).toContain("durationSeconds");

    const rec = (await req(ownerToken).get(`/api/v1/tenant/ai/orders/${orderId}/recommendations`).expect(200)).body.data as { candidates: Array<{ name: string }> };
    expect(rec.candidates.map((x) => x.name)).toEqual(["有技能"]);
    expect(await client.aiRun.count({ where: { tenantId } })).toBeGreaterThanOrEqual(2);
    expect(await client.aiSuggestion.count({ where: { tenantId } })).toBeGreaterThanOrEqual(2);
  });
});
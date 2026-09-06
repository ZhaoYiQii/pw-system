import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Dispute-Password-1";
const suffix = Date.now().toString(36);
function envOrThrow(name: string): string { const v = process.env[name]; if (!v) throw new Error(`missing env ${name}`); return v; }
interface Data { accessToken?: string }

describe("Slice 9 dispute freeze & audit", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId: string;
  let ownerToken: string;
  let financeToken: string;
  let playerId = "";
  const eIds: string[] = [];

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);
    const t = await client.tenant.create({ data: { code: `dp_${suffix}`, name: "争议店" } });
    tenantId = t.id;
    const owner = await client.tenantAccount.create({ data: { tenantId, username: "boss", passwordHash: hash } });
    await client.tenantAccountRole.create({ data: { tenantId, tenantAccountId: owner.id, role: "TENANT_OWNER" } });
    const fin = await client.tenantAccount.create({ data: { tenantId, username: "fin", passwordHash: hash } });
    await client.tenantAccountRole.create({ data: { tenantId, tenantAccountId: fin.id, role: "FINANCE" } });
    const player = await client.playerProfile.create({ data: { tenantId, name: "争议玩" } });
    playerId = player.id;
    for (let i = 1; i <= 2; i += 1) {
      const cust = await client.customerProfile.create({ data: { tenantId, name: `客${i}` } });
      const order = await client.order.create({ data: { tenantId, orderNo: `dp${i}_${suffix}`, customerProfileId: cust.id } });
      const e = await client.earning.create({ data: { tenantId, orderId: order.id, playerId, amountFen: BigInt(7700) } });
      eIds.push(e.id);
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    async function login(username: string) {
      const r = await request(app.getHttpServer()).post("/api/v1/auth/login").send({ kind: "tenant", tenantCode: t.code, username, password: PW }).expect(201);
      return (r.body as { data: Data }).data.accessToken as string;
    }
    ownerToken = await login("boss");
    financeToken = await login("fin");
  });

  afterAll(async () => {
    if (client) {
      await client.disputeEvent.deleteMany({ where: { tenantId } });
      await client.dispute.deleteMany({ where: { tenantId } });
      await client.auditLog.deleteMany({ where: { tenantId } });
      await client.manualPaymentRecord.deleteMany({ where: { tenantId } });
      await client.settlementItem.deleteMany({ where: { tenantId } });
      await client.settlementBatch.deleteMany({ where: { tenantId } });
      await client.earning.deleteMany({ where: { tenantId } });
      const orders = await client.order.findMany({ where: { tenantId } });
      for (const o of orders) await client.orderEvent.deleteMany({ where: { orderId: o.id } });
      await client.order.deleteMany({ where: { tenantId } });
      await client.playerProfile.deleteMany({ where: { tenantId } });
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

  it("开放争议 earning 不能入批/不能支付；处理后审计可查", async () => {
    const orderA = (await client.earning.findFirst({ where: { tenantId, id: eIds[0] } }))?.orderId as string;
    const d = (await req(ownerToken).post(`/api/v1/tenant/orders/${orderA}/disputes`, { reason: "服务中途消失", earningId: eIds[0] }).expect(201)).body.data as { id: string };

    // 开争议后不能入批
    const b1 = (await req(ownerToken).post("/api/v1/tenant/settlements").expect(201)).body.data as { id: string };
    await req(ownerToken).post(`/api/v1/tenant/settlements/${b1.id}/items`, { earningIds: [eIds[0] as string] }).expect(409);

    // 另一 earning 入批、复核、批准，但随后开争议 → 支付被冻结
    const orderB = (await client.earning.findFirst({ where: { tenantId, id: eIds[1] } }))?.orderId as string;
    const b2 = (await req(ownerToken).post("/api/v1/tenant/settlements").expect(201)).body.data as { id: string };
    await req(ownerToken).post(`/api/v1/tenant/settlements/${b2.id}/items`, { earningIds: [eIds[1] as string] }).expect(201);
    await req(ownerToken).post(`/api/v1/tenant/orders/${orderB}/disputes`, { reason: "场次不符", earningId: eIds[1] }).expect(201);
    await req(ownerToken).post(`/api/v1/tenant/settlements/${b2.id}/review`).expect(201);
    await req(financeToken).post(`/api/v1/tenant/settlements/${b2.id}/approve`).expect(201);
    await req(ownerToken).post(`/api/v1/tenant/settlements/${b2.id}/pay`).expect(409);

    // 处理争议后可支付
    await req(ownerToken).post(`/api/v1/tenant/disputes/${d.id}/resolve`, { resolution: "已退款并结案" }).expect(201);
    await req(ownerToken).post(`/api/v1/tenant/settlements/${b2.id}/pay`).expect(409); // 争议2仍 OPEN
    const allOpen = await client.dispute.findMany({ where: { tenantId, status: "OPEN" }, select: { id: true } });
    for (const open of allOpen) {
      await req(ownerToken).post(`/api/v1/tenant/disputes/${open.id}/resolve`, { resolution: "调解完成" }).expect(201);
    }
    await req(ownerToken).post(`/api/v1/tenant/settlements/${b2.id}/pay`).expect(201);

    const audit = (await req(ownerToken).get("/api/v1/tenant/audit").expect(200)).body.data as unknown[];
    expect(audit.length).toBeGreaterThanOrEqual(4);
  });
});
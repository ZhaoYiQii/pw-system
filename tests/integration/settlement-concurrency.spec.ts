import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Settle-Password-1";
const suffix = Date.now().toString(36);
function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}
interface Data {
  accessToken?: string;
}

describe("Slice 8 settlement (批次状态机/并发唯一/职责分离)", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId: string;
  let ownerToken: string;
  let financeToken: string;
  const earningIds: string[] = [];

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);
    const t = await client.tenant.create({
      data: { code: `st_${suffix}`, name: "结算店" },
    });
    tenantId = t.id;
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
    const player = await client.playerProfile.create({
      data: { tenantId, name: "结算玩" },
    });
    for (let i = 1; i <= 2; i += 1) {
      const cust = await client.customerProfile.create({
        data: { tenantId, name: `客${i}` },
      });
      const order = await client.order.create({
        data: {
          tenantId,
          orderNo: `so${i}_${suffix}`,
          customerProfileId: cust.id,
        },
      });
      const e = await client.earning.create({
        data: {
          tenantId,
          orderId: order.id,
          playerId: player.id,
          amountFen: BigInt(7700),
        },
      });
      earningIds.push(e.id);
    }
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    async function login(username: string) {
      const r = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ kind: "tenant", tenantCode: t.code, username, password: PW })
        .expect(201);
      return (r.body as { data: Data }).data.accessToken as string;
    }
    ownerToken = await login("boss");
    financeToken = await login("fin");
  });

  afterAll(async () => {
    if (client) {
      await client.auditLog.deleteMany({ where: { tenantId } });
      await client.manualPaymentRecord.deleteMany({ where: { tenantId } });
      await client.settlementItem.deleteMany({ where: { tenantId } });
      await client.settlementBatch.deleteMany({ where: { tenantId } });
      await client.earning.deleteMany({ where: { tenantId } });
      const orders = await client.order.findMany({ where: { tenantId } });
      for (const o of orders)
        await client.orderEvent.deleteMany({ where: { orderId: o.id } });
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
    return {
      get: (u: string) => request(app.getHttpServer()).get(u).set(h),
      post: (u: string, b?: unknown) =>
        request(app.getHttpServer())
          .post(u)
          .set(h)
          .send(b ?? {}),
    };
  }

  it("DRAFT 批次加 earning；重复入其他批次 409；职责分离：发起人不能批准；PAID 后不可改", async () => {
    const b1 = (
      await req(ownerToken).post("/api/v1/tenant/settlements").expect(201)
    ).body.data as { id: string };
    await req(ownerToken)
      .post(`/api/v1/tenant/settlements/${b1.id}/items`, { earningIds })
      .expect(201);

    // 同一 earning 进第二个批次被拒
    const b2 = (
      await req(ownerToken).post("/api/v1/tenant/settlements").expect(201)
    ).body.data as { id: string };
    await req(ownerToken)
      .post(`/api/v1/tenant/settlements/${b2.id}/items`, {
        earningIds: [earningIds[0] as string],
      })
      .expect(409);

    // 状态流转：review -> 发起人不能 approve -> finance approve -> pay
    await req(ownerToken)
      .post(`/api/v1/tenant/settlements/${b1.id}/review`)
      .expect(201);
    await req(ownerToken)
      .post(`/api/v1/tenant/settlements/${b1.id}/approve`)
      .expect(409);
    await req(financeToken)
      .post(`/api/v1/tenant/settlements/${b1.id}/approve`)
      .expect(201);
    await req(ownerToken)
      .post(`/api/v1/tenant/settlements/${b1.id}/pay`)
      .expect(201);

    const paid = await client.earning.findMany({
      where: { tenantId, id: { in: earningIds } },
    });
    expect(paid.every((e) => e.status === "PAID")).toBe(true);
    // PAID 后不可再添加/冲正
    await req(ownerToken)
      .post(`/api/v1/tenant/settlements/${b1.id}/items`, {
        earningIds: [earningIds[1] as string],
      })
      .expect(409);
    await req(ownerToken)
      .post(`/api/v1/tenant/settlements/${b1.id}/void`)
      .expect(409);
  });

  it("并发 pay：批次行锁保证仅一次成功、一条线下支付记录", async () => {
    const cust = await client.customerProfile.create({
      data: { tenantId, name: "并发客" },
    });
    const order = await client.order.create({
      data: { tenantId, orderNo: `so4_${suffix}`, customerProfileId: cust.id },
    });
    const player = await client.playerProfile.findFirst({
      where: { tenantId },
    });
    const e4 = await client.earning.create({
      data: {
        tenantId,
        orderId: order.id,
        playerId: player?.id as string,
        amountFen: BigInt(7700),
      },
    });
    const b4 = (
      await req(ownerToken).post("/api/v1/tenant/settlements").expect(201)
    ).body.data as { id: string };
    await req(ownerToken)
      .post(`/api/v1/tenant/settlements/${b4.id}/items`, {
        earningIds: [e4.id],
      })
      .expect(201);
    await req(financeToken)
      .post(`/api/v1/tenant/settlements/${b4.id}/review`)
      .expect(201);
    await req(financeToken)
      .post(`/api/v1/tenant/settlements/${b4.id}/approve`)
      .expect(201);

    const results = await Promise.allSettled([
      req(ownerToken).post(`/api/v1/tenant/settlements/${b4.id}/pay`),
      req(ownerToken).post(`/api/v1/tenant/settlements/${b4.id}/pay`),
    ]);
    const fulfilled = results.filter(
      (r) => r.status === "fulfilled" && r.value.status === 201,
    ).length;
    const rejectedOrConflict = results.filter(
      (r) =>
        r.status === "rejected" ||
        (r.status === "fulfilled" && r.value.status === 409),
    ).length;
    expect(fulfilled).toBe(1);
    expect(rejectedOrConflict).toBe(1);
    expect(
      await client.manualPaymentRecord.count({
        where: { tenantId, batchId: b4.id },
      }),
    ).toBe(1);
  });
  it("VOID 可让 DRAFT/REVIEWED 批次退回 earning 为 PENDING", async () => {
    const cust = await client.customerProfile.create({
      data: { tenantId, name: "客3" },
    });
    const order = await client.order.create({
      data: { tenantId, orderNo: `so3_${suffix}`, customerProfileId: cust.id },
    });
    const player = await client.playerProfile.findFirst({
      where: { tenantId },
    });
    const e3 = await client.earning.create({
      data: {
        tenantId,
        orderId: order.id,
        playerId: player?.id as string,
        amountFen: BigInt(7700),
      },
    });
    const b3 = (
      await req(ownerToken).post("/api/v1/tenant/settlements").expect(201)
    ).body.data as { id: string };
    await req(ownerToken)
      .post(`/api/v1/tenant/settlements/${b3.id}/items`, {
        earningIds: [e3.id],
      })
      .expect(201);
    await req(ownerToken)
      .post(`/api/v1/tenant/settlements/${b3.id}/void`)
      .expect(201);
    const after = await client.earning.findFirst({
      where: { tenantId, id: e3.id },
    });
    expect(after?.status).toBe("PENDING");
  });
});

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
  let fundAccountId: string;
  let archivedFundAccountId: string;
  let foreignTenantId: string;
  let foreignFundAccountId: string;
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
    fundAccountId = (
      await client.fundAccount.create({
        data: {
          tenantId,
          code: `BANK_${suffix}`,
          name: "结算测试银行账户",
          kind: "BANK",
        },
      })
    ).id;
    archivedFundAccountId = (
      await client.fundAccount.create({
        data: {
          tenantId,
          code: `OLD_${suffix}`,
          name: "已归档账户",
          kind: "OFFLINE",
          status: "ARCHIVED",
        },
      })
    ).id;
    foreignTenantId = (
      await client.tenant.create({
        data: { code: `st_other_${suffix}`, name: "其他结算店" },
      })
    ).id;
    foreignFundAccountId = (
      await client.fundAccount.create({
        data: {
          tenantId: foreignTenantId,
          code: `FOREIGN_${suffix}`,
          name: "其他租户账户",
          kind: "BANK",
        },
      })
    ).id;
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
      await client.ledgerEntry.deleteMany({ where: { tenantId } });
      await client.ledgerTransaction.deleteMany({ where: { tenantId } });
      await client.ledgerAccount.deleteMany({ where: { tenantId } });
      await client.fundAccount.deleteMany({ where: { tenantId } });
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
      await client.fundAccount.deleteMany({
        where: { tenantId: foreignTenantId },
      });
      await client.tenant.deleteMany({ where: { id: foreignTenantId } });
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

  function paymentBody(
    key: string,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      fundAccountId,
      evidenceRef: `BANK_${key}`,
      occurredAt: "2026-09-24T12:00:00.000Z",
      idempotencyKey: key,
      note: "测试付款备注",
      ...overrides,
    };
  }

  it("DRAFT 批次加 earning；重复入其他批次 409；职责分离：发起人不能批准；PAID 后不可改", async () => {
    const b1 = (
      await req(ownerToken).post("/api/v1/tenant/settlements").expect(201)
    ).body.data as { id: string };

    const pending = (
      await req(ownerToken)
        .get("/api/v1/tenant/settlements/earnings")
        .expect(200)
    ).body.data as Array<{
      id: string;
      amountFen: string;
      playerName: string;
      orderNo: string;
    }>;
    expect(
      pending.some(
        (e) =>
          e.id === earningIds[0] &&
          e.amountFen === "7700" &&
          e.playerName === "结算玩" &&
          typeof e.orderNo === "string" &&
          e.orderNo.length > 0,
      ),
    ).toBe(true);

    await req(ownerToken)
      .post(`/api/v1/tenant/settlements/${b1.id}/items`, { earningIds })
      .expect(201);

    const detail = (
      await req(ownerToken)
        .get(`/api/v1/tenant/settlements/${b1.id}`)
        .expect(200)
    ).body.data as {
      id: string;
      itemCount: number;
      items: Array<{
        earningId: string;
        amountFen: string;
        playerName: string;
        orderNo: string;
      }>;
    };
    expect(detail.itemCount).toBe(2);
    expect(detail.items).toHaveLength(2);
    expect(detail.items.every((i) => i.amountFen === "7700")).toBe(true);

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
    // 旧路由不再允许无资金事实的空请求体。
    await req(ownerToken)
      .post(`/api/v1/tenant/settlements/${b1.id}/pay`)
      .expect(400);
    const payment = await req(ownerToken)
      .post(
        `/api/v1/tenant/settlements/${b1.id}/payments`,
        paymentBody("payout_success_1"),
      )
      .expect(201);
    expect(payment.body.data).toMatchObject({
      batchId: b1.id,
      status: "PAID",
      amountFen: "15400",
      duplicate: false,
    });

    const paid = await client.earning.findMany({
      where: { tenantId, id: { in: earningIds } },
    });
    expect(paid.every((e) => e.status === "PAID")).toBe(true);
    const payoutTransaction = await client.ledgerTransaction.findFirstOrThrow({
      where: {
        tenantId,
        sourceType: "settlement_batch",
        sourceId: b1.id,
        eventType: "PLAYER_PAYOUT_CONFIRMED",
      },
    });
    const payoutEntries = await client.ledgerEntry.findMany({
      where: { tenantId, transactionId: payoutTransaction.id },
      orderBy: { direction: "asc" },
    });
    expect(payoutEntries).toHaveLength(2);
    expect(
      payoutEntries.reduce(
        (sum, entry) =>
          sum +
          (entry.direction === "DEBIT" ? entry.amountFen : -entry.amountFen),
        0n,
      ),
    ).toBe(0n);
    expect(
      payoutEntries.filter((entry) => entry.fundAccountId !== null),
    ).toHaveLength(1);
    expect(
      payoutEntries.find((entry) => entry.direction === "CREDIT")
        ?.fundAccountId,
    ).toBe(fundAccountId);
    const audit = await client.auditLog.findFirstOrThrow({
      where: {
        tenantId,
        action: "settlement.payment.confirmed",
        resourceId: b1.id,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit.summary).not.toContain("BANK_payout_success_1");
    expect(audit.summary).not.toContain("测试付款备注");
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

  it("跨租户/归档资金账户拒绝；并发付款只产生一次资金事实", async () => {
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

    await req(ownerToken)
      .post(
        `/api/v1/tenant/settlements/${b4.id}/payments`,
        paymentBody("payout_foreign", { fundAccountId: foreignFundAccountId }),
      )
      .expect(409);
    await req(ownerToken)
      .post(
        `/api/v1/tenant/settlements/${b4.id}/payments`,
        paymentBody("payout_archived", {
          fundAccountId: archivedFundAccountId,
        }),
      )
      .expect(409);
    expect(
      await client.ledgerTransaction.count({
        where: {
          tenantId,
          sourceType: "settlement_batch",
          sourceId: b4.id,
          eventType: "PLAYER_PAYOUT_CONFIRMED",
        },
      }),
    ).toBe(0);

    const results = await Promise.allSettled([
      req(ownerToken).post(
        `/api/v1/tenant/settlements/${b4.id}/payments`,
        paymentBody("payout_concurrent"),
      ),
      req(ownerToken).post(
        `/api/v1/tenant/settlements/${b4.id}/payments`,
        paymentBody("payout_concurrent"),
      ),
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
    const transactions = await client.ledgerTransaction.findMany({
      where: {
        tenantId,
        sourceType: "settlement_batch",
        sourceId: b4.id,
        eventType: "PLAYER_PAYOUT_CONFIRMED",
      },
      select: { id: true },
    });
    expect(transactions).toHaveLength(1);
    expect(
      await client.ledgerEntry.count({
        where: { tenantId, transactionId: transactions[0]?.id },
      }),
    ).toBe(2);
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

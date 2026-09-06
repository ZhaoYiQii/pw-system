import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Ledger-Password-1";
const suffix = Date.now().toString(36);
function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}
interface Data {
  accessToken?: string;
}

describe("Slice 8 ledger accounting (平衡/分成/幂等)", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId: string;
  let orderId: string;
  let ownerToken: string;

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);
    const t = await client.tenant.create({
      data: { code: `ld_${suffix}`, name: "账本店" },
    });
    tenantId = t.id;
    const owner = await client.tenantAccount.create({
      data: { tenantId, username: "boss", passwordHash: hash },
    });
    await client.tenantAccountRole.create({
      data: { tenantId, tenantAccountId: owner.id, role: "TENANT_OWNER" },
    });
    const cust = await client.customerProfile.create({
      data: { tenantId, name: "账本客" },
    });
    const player = await client.playerProfile.create({
      data: { tenantId, name: "账本玩" },
    });
    const order = await client.order.create({
      data: {
        tenantId,
        orderNo: `ldo-${suffix}`,
        customerProfileId: cust.id,
        status: "PENDING_CONFIRMATION",
      },
    });
    orderId = order.id;
    await client.assignment.create({
      data: { tenantId, orderId: order.id, playerId: player.id },
    });
    const now = new Date();
    await client.serviceSession.create({
      data: {
        tenantId,
        orderId: order.id,
        playerId: player.id,
        startedAt: new Date(now.getTime() - 3600 * 1000),
        endedAt: now,
        durationSeconds: 3600,
        status: "ENDED",
      },
    });
    await client.orderPriceSnapshot.create({
      data: {
        tenantId,
        orderId: order.id,
        snapshotVersion: 1,
        productName: "双排1小时",
        durationSeconds: 3600,
        unitPriceFen: BigInt(10000),
        lineTotalFen: BigInt(10000),
      },
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({
        kind: "tenant",
        tenantCode: t.code,
        username: "boss",
        password: PW,
      })
      .expect(201);
    ownerToken = (login.body as { data: Data }).data.accessToken as string;
  });

  afterAll(async () => {
    if (client) {
      await client.outboxEvent.deleteMany({ where: { tenantId } });
      await client.auditLog.deleteMany({ where: { tenantId } });
      await client.ledgerEntry.deleteMany({ where: { tenantId } });
      await client.ledgerTransaction.deleteMany({ where: { tenantId } });
      await client.ledgerAccount.deleteMany({ where: { tenantId } });
      await client.earning.deleteMany({ where: { tenantId } });
      const sessions = await client.serviceSession.findMany({
        where: { tenantId },
      });
      for (const s of sessions)
        await client.sessionEvent.deleteMany({ where: { sessionId: s.id } });
      await client.serviceSession.deleteMany({ where: { tenantId } });
      await client.assignment.deleteMany({ where: { tenantId } });
      await client.orderPriceSnapshot.deleteMany({ where: { tenantId } });
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

  it("核算生成 earning（77%）+ 平衡账本（借=贷），重复核算幂等", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/tenant/orders/${orderId}/accounting`)
      .set("authorization", `Bearer ${ownerToken}`)
      .expect(201);
    const first = res.body.data as {
      earningId: string;
      playerShareFen: number;
    };
    expect(first.playerShareFen).toBe("7700");
    const earning = await client.earning.findFirst({
      where: { tenantId, orderId },
    });
    expect(earning?.amountFen).toBe(BigInt(7700));

    const entries = await client.ledgerEntry
      .findMany({
        where: { tenantId, transaction: { order: { id: orderId } } },
      })
      .catch(async () => {
        const txRows = await client.ledgerTransaction.findMany({
          where: { tenantId },
        });
        const ids = txRows.map((t) => t.id);
        return client.ledgerEntry.findMany({
          where: { tenantId, transactionId: { in: ids } },
        });
      });
    const debit = entries
      .filter((e) => e.direction === "DEBIT")
      .reduce((a, e) => a + Number(e.amountFen), 0);
    const credit = entries
      .filter((e) => e.direction === "CREDIT")
      .reduce((a, e) => a + Number(e.amountFen), 0);
    expect(debit).toBe(credit);
    expect(debit).toBe(10000);

    // 幂等
    const res2 = await request(app.getHttpServer())
      .post(`/api/v1/tenant/orders/${orderId}/accounting`)
      .set("authorization", `Bearer ${ownerToken}`)
      .expect(201);
    expect((res2.body.data as { earningId: string }).earningId).toBe(
      first.earningId,
    );
    expect(await client.earning.count({ where: { tenantId, orderId } })).toBe(
      1,
    );
  });
});

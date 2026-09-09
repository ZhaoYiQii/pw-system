import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Record-Closure-Password-1";
const suffix = Date.now().toString(36);
function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

describe("商家记录台闭环：客户/陪玩账户、场次证据、争议详情、收入账本", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId = "";
  let ownerToken = "";
  let customerId = "";
  let playerId = "";
  let orderId = "";
  let sessionId = "";
  let earningId = "";
  let disputeId = "";

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);
    const tenant = await client.tenant.create({
      data: { code: `rc_${suffix}`, name: "记录台验收店" },
    });
    tenantId = tenant.id;
    const owner = await client.tenantAccount.create({
      data: { tenantId, username: "rc_owner", passwordHash: hash },
    });
    await client.tenantAccountRole.create({
      data: {
        tenantId,
        tenantAccountId: owner.id,
        role: "TENANT_OWNER",
      },
    });
    const customer = await client.customerProfile.create({
      data: { tenantId, name: "记录台客户" },
    });
    customerId = customer.id;
    const player = await client.playerProfile.create({
      data: { tenantId, name: "记录台陪玩", basePricePerHourFen: 30000n },
    });
    playerId = player.id;
    const order = await client.order.create({
      data: {
        tenantId,
        orderNo: `RC-${suffix}`,
        customerProfileId: customer.id,
        status: "PENDING_CONFIRMATION",
      },
    });
    orderId = order.id;

    const wallet = await client.bossWallet.create({
      data: {
        tenantId,
        customerProfileId: customer.id,
        bossNo: `B${suffix.toUpperCase()}`,
        balanceFen: 10000n,
      },
    });
    await client.walletEntry.create({
      data: {
        tenantId,
        customerProfileId: customer.id,
        walletId: wallet.id,
        txNo: `T${suffix}`,
        type: "RECHARGE",
        amountFen: 10000n,
        balanceAfterFen: 10000n,
        reason: "测试充值",
      },
    });

    const session = await client.serviceSession.create({
      data: {
        tenantId,
        orderId,
        playerId: player.id,
        status: "STARTED",
        startedAt: new Date(),
        durationSeconds: 600,
      },
    });
    sessionId = session.id;
    await client.sessionEvent.create({
      data: {
        tenantId,
        sessionId: session.id,
        eventType: "SESSION_STARTED",
        fromStatus: "SCHEDULED",
        toStatus: "STARTED",
        payload: {},
      },
    });
    await client.evidenceAsset.create({
      data: {
        tenantId,
        sessionId: session.id,
        objectKey: `${tenantId}/test.png`,
        originalName: "test.png",
        mimeType: "image/png",
        sizeBytes: 10,
        sha256: "a".repeat(64),
        uploadedBy: owner.id,
      },
    });
    await client.sessionAdjustment.create({
      data: {
        tenantId,
        sessionId: session.id,
        originalDurationSeconds: 600,
        requestedDurationSeconds: 900,
        reason: "等待排队导致延长",
        requestedBy: player.id,
      },
    });

    const earning = await client.earning.create({
      data: {
        tenantId,
        orderId,
        playerId: player.id,
        amountFen: 9000n,
        status: "PENDING",
      },
    });
    earningId = earning.id;
    const dispute = await client.dispute.create({
      data: {
        tenantId,
        orderId,
        earningId: earning.id,
        playerId: player.id,
        customerProfileId: customer.id,
        reason: "服务时长争议",
        openedBy: customer.id,
      },
    });
    disputeId = dispute.id;
    await client.disputeEvent.create({
      data: {
        tenantId,
        disputeId: dispute.id,
        eventType: "DISPUTE_OPENED",
        toStatus: "OPEN",
        payload: { reason: "服务时长争议" },
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
        tenantCode: tenant.code,
        username: "rc_owner",
        password: PW,
      })
      .expect(201);
    ownerToken = (login.body as { data: { accessToken: string } }).data
      .accessToken;
  });

  afterAll(async () => {
    if (client) {
      await client.disputeEvent.deleteMany({ where: { tenantId } });
      await client.dispute.deleteMany({ where: { tenantId } });
      await client.auditLog.deleteMany({ where: { tenantId } });
      await client.sessionAdjustment.deleteMany({ where: { tenantId } });
      await client.evidenceAsset.deleteMany({ where: { tenantId } });
      await client.sessionEvent.deleteMany({ where: { tenantId } });
      await client.serviceSession.deleteMany({ where: { tenantId } });
      await client.walletEntry.deleteMany({ where: { tenantId } });
      await client.bossWallet.deleteMany({ where: { tenantId } });
      await client.earning.deleteMany({ where: { tenantId } });
      await client.orderEvent.deleteMany({ where: { orderId } });
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

  it("客户详情可读到账户余额/流水与订单历史", async () => {
    const account = (
      await req(ownerToken)
        .get(`/api/v1/tenant/customers/${customerId}/account`)
        .expect(200)
    ).body.data as {
      wallet: { bossNo: string; balanceFen: string; entries: unknown[] };
    };
    expect(account.wallet.balanceFen).toBe("10000");
    expect(account.wallet.entries.length).toBeGreaterThanOrEqual(1);
    const orders = (
      await req(ownerToken)
        .get(`/api/v1/tenant/customers/${customerId}/orders`)
        .expect(200)
    ).body.data as Array<{ orderId: string }>;
    expect(orders.map((o) => o.orderId)).toContain(orderId);
  });

  it("陪玩账户返回收入合计与记录", async () => {
    const account = (
      await req(ownerToken)
        .get(`/api/v1/tenant/players/${playerId}/account`)
        .expect(200)
    ).body.data as {
      finance: { paidFen: string; unpaidFen: string; records: unknown[] };
    };
    expect(account.finance.unpaidFen).toBe("9000");
    expect(account.finance.records.length).toBeGreaterThanOrEqual(1);
  });

  it("场次台账/详情包含事件、证据与待复核调整", async () => {
    const list = (
      await req(ownerToken).get("/api/v1/tenant/sessions").expect(200)
    ).body.data as Array<{
      id: string;
      evidenceCount: number;
      adjustmentPendingCount: number;
    }>;
    const row = list.find((s) => s.id === sessionId);
    expect(row).toBeTruthy();
    expect(row?.evidenceCount).toBeGreaterThanOrEqual(1);
    expect(row?.adjustmentPendingCount).toBeGreaterThanOrEqual(1);
    const detail = (
      await req(ownerToken)
        .get(`/api/v1/tenant/sessions/${sessionId}`)
        .expect(200)
    ).body.data as {
      evidence: unknown[];
      adjustments: Array<{ status: string }>;
      events: unknown[];
    };
    expect(detail.evidence.length).toBeGreaterThanOrEqual(1);
    expect(detail.adjustments[0]?.status).toBe("PENDING");
    expect(detail.events.length).toBeGreaterThanOrEqual(1);
  });

  it("争议详情含事件时间线与关联应收状态", async () => {
    const detail = (
      await req(ownerToken)
        .get(`/api/v1/tenant/disputes/${disputeId}`)
        .expect(200)
    ).body.data as {
      earning: { amountFen: string; status: string } | null;
      events: unknown[];
      orderNo: string;
    };
    expect(detail.earning?.amountFen).toBe("9000");
    expect(detail.events.length).toBeGreaterThanOrEqual(1);
    expect(detail.orderNo).toBe(`RC-${suffix}`);
  });

  it("收入账本列出 CLASSIC 应收", async () => {
    const ledger = (
      await req(ownerToken)
        .get("/api/v1/tenant/settlements/ledger")
        .expect(200)
    ).body.data as {
      unpaidFen: string;
      rows: Array<{ id: string; source: string }>;
    };
    expect(ledger.unpaidFen).toBe("9000");
    expect(ledger.rows.map((r) => r.id)).toContain(earningId);
  });
});

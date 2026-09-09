import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Dash-Password-1";
const suffix = `${Date.now().toString(36)}_${Math.random()
  .toString(36)
  .slice(2, 7)}`;
const DAY_MS = 24 * 60 * 60 * 1000;

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

describe("reporting dashboard summary (角色/口径/隔离)", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantA: { id: string; code: string };
  let tenantB: { id: string; code: string };
  let ownerToken = "";
  let csToken = "";
  let financeToken = "";
  let playerToken = "";
  let customerToken = "";
  let ownerBToken = "";

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);

    const ta = await client.tenant.create({
      data: { code: `dash_a_${suffix}`, name: "工作台A店" },
    });
    const tb = await client.tenant.create({
      data: { code: `dash_b_${suffix}`, name: "工作台B店" },
    });
    tenantA = ta;
    tenantB = tb;

    async function account(
      tenantId: string,
      username: string,
      role: string,
    ) {
      const acct = await client.tenantAccount.create({
        data: { tenantId, username, passwordHash: hash },
      });
      await client.tenantAccountRole.create({
        data: { tenantId, tenantAccountId: acct.id, role },
      });
      return acct;
    }

    const bossA = await account(ta.id, `boss_${suffix}`, "TENANT_OWNER");
    const csA = await account(ta.id, `cs_${suffix}`, "CUSTOMER_SERVICE");
    const finA = await account(ta.id, `fin_${suffix}`, "FINANCE");
    const playerA = await account(ta.id, `player_${suffix}`, "PLAYER");
    const customerA = await account(ta.id, `customer_${suffix}`, "CUSTOMER");
    const bossB = await account(tb.id, `bossb_${suffix}`, "TENANT_OWNER");
    void bossA;
    void bossB;

    const cust = await client.customerProfile.create({
      data: { tenantId: ta.id, name: "工作台老板客户" },
    });
    const player = await client.playerProfile.create({
      data: { tenantId: ta.id, name: "工作台陪玩" },
    });

    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * DAY_MS);

    const orderA = await client.order.create({
      data: {
        tenantId: ta.id,
        orderNo: `dash_a_${suffix}`,
        customerProfileId: cust.id,
        status: "PENDING_CONFIRMATION",
        processType: "CLASSIC",
      },
    });
    const orderB = await client.order.create({
      data: {
        tenantId: ta.id,
        orderNo: `dash_b_${suffix}`,
        customerProfileId: cust.id,
        status: "COMPLETED",
        processType: "CLASSIC",
      },
    });
    const orderC = await client.order.create({
      data: {
        tenantId: ta.id,
        orderNo: `dash_c_${suffix}`,
        customerProfileId: cust.id,
        status: "ASSIGNED",
        processType: "CLASSIC",
      },
    });

    const sessionA = await client.serviceSession.create({
      data: {
        tenantId: ta.id,
        orderId: orderA.id,
        playerId: player.id,
        startedAt: new Date(now.getTime() - 60 * 60 * 1000),
        endedAt: now,
        durationSeconds: 3600,
        status: "ENDED",
      },
    });
    const sessionB = await client.serviceSession.create({
      data: {
        tenantId: ta.id,
        orderId: orderB.id,
        playerId: player.id,
        startedAt: twoDaysAgo,
        endedAt: twoDaysAgo,
        durationSeconds: 3600,
        status: "ENDED",
      },
    });
    await client.serviceSession.create({
      data: {
        tenantId: ta.id,
        orderId: orderC.id,
        playerId: player.id,
        startedAt: now,
        durationSeconds: null,
        status: "STARTED",
      },
    });

    await client.sessionAdjustment.create({
      data: {
        tenantId: ta.id,
        sessionId: sessionA.id,
        originalDurationSeconds: 3600,
        requestedDurationSeconds: 3900,
        reason: "超时待复核",
        status: "PENDING",
      },
    });
    void sessionB;

    await client.settlementBatch.create({
      data: {
        tenantId: ta.id,
        batchNo: `db_${suffix}_draft`,
        totalAmountFen: BigInt(210000),
        status: "DRAFT",
      },
    });
    await client.settlementBatch.create({
      data: {
        tenantId: ta.id,
        batchNo: `db_${suffix}_paid`,
        totalAmountFen: BigInt(50000),
        status: "PAID",
      },
    });

    await client.dispute.create({
      data: {
        tenantId: ta.id,
        orderId: orderB.id,
        playerId: player.id,
        customerProfileId: cust.id,
        reason: "测试争议",
        status: "OPEN",
      },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(tenantCode: string, username: string) {
      const r = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ kind: "tenant", tenantCode, username, password: PW })
        .expect(201);
      return (r.body as { data: { accessToken?: string } }).data
        .accessToken as string;
    }

    ownerToken = await login(ta.code, `boss_${suffix}`);
    csToken = await login(ta.code, `cs_${suffix}`);
    financeToken = await login(ta.code, `fin_${suffix}`);
    playerToken = await login(ta.code, `player_${suffix}`);
    customerToken = await login(ta.code, `customer_${suffix}`);
    ownerBToken = await login(tb.code, `bossb_${suffix}`);
    void playerA;
    void customerA;
    void csA;
    void finA;
  });

  afterAll(async () => {
    if (client) {
      for (const t of [tenantA, tenantB]) {
        if (!t) continue;
        await client.auditLog.deleteMany({ where: { tenantId: t.id } });
        await client.sessionAdjustment.deleteMany({ where: { tenantId: t.id } });
        await client.serviceSession.deleteMany({ where: { tenantId: t.id } });
        await client.dispute.deleteMany({ where: { tenantId: t.id } });
        await client.settlementBatch.deleteMany({ where: { tenantId: t.id } });
        await client.order.deleteMany({ where: { tenantId: t.id } });
        await client.playerProfile.deleteMany({ where: { tenantId: t.id } });
        await client.customerProfile.deleteMany({ where: { tenantId: t.id } });
        await client.tenantAccountRole.deleteMany({ where: { tenantId: t.id } });
        await client.tenantAccount.deleteMany({ where: { tenantId: t.id } });
        await client.tenant.deleteMany({ where: { id: t.id } });
      }
      await client.$disconnect();
    }
    if (app) await app.close();
  });

  function req(token: string) {
    return request(app.getHttpServer())
      .get("/api/v1/tenant/dashboard/summary")
      .set("authorization", `Bearer ${token}`);
  }

  it("owner 看到待办/场次/结算/争议口径，金额为分字符串", async () => {
    const res = await req(ownerToken).expect(200);
    const body = res.body as {
      data: {
        day: { date: string; tz: string };
        metrics: {
          todoOrders: number;
          liveSessions: number;
          financeTodos: number;
          openDisputes: number;
          todayServiceCount: number;
          pendingSettlementCount: number;
          pendingSettlementAmountFen: string;
        };
        attention: Array<{ kind: string }>;
        riskFeed: Array<{ kind: string }>;
      };
    };
    const data = body.data;
    expect(data.day.tz).toBe("Asia/Shanghai");
    expect(data.day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data.metrics.todoOrders).toBe(1);
    expect(data.metrics.liveSessions).toBe(1);
    expect(data.metrics.todayServiceCount).toBe(1);
    expect(data.metrics.financeTodos).toBe(1);
    expect(data.metrics.pendingSettlementCount).toBe(1);
    expect(data.metrics.pendingSettlementAmountFen).toBe("210000");
    expect(data.metrics.openDisputes).toBe(1);
    expect(data.attention.some((item) => item.kind === "ORDER_TODO")).toBe(
      true,
    );
    expect(data.attention.some((item) => item.kind === "SETTLEMENT_TODO")).toBe(
      true,
    );
    expect(data.attention.some((item) => item.kind === "DISPUTE_TODO")).toBe(
      true,
    );
    expect(data.riskFeed.some((item) => item.kind === "SETTLEMENT_TODO")).toBe(
      true,
    );
  });

  it("finance 可见财务字段；CS 看不到财务字段与结算类待办", async () => {
    const fin = await req(financeToken).expect(200);
    const finData = fin.body as {
      data: {
        metrics: { pendingSettlementAmountFen?: string };
        attention: Array<{ kind: string }>;
      };
    };
    expect(finData.data.metrics.pendingSettlementAmountFen).toBe("210000");

    const cs = await req(csToken).expect(200);
    const csBody = cs.body as {
      data: {
        metrics: {
          todoOrders: number;
          pendingSettlementAmountFen?: string;
          pendingSettlementCount?: number;
          financeTodos?: number;
        };
        attention: Array<{ kind: string }>;
        riskFeed: Array<{ kind: string }>;
      };
    };
    expect(csBody.data.metrics.todoOrders).toBe(1);
    expect(csBody.data.metrics.pendingSettlementAmountFen).toBeUndefined();
    expect(csBody.data.metrics.pendingSettlementCount).toBeUndefined();
    expect(csBody.data.metrics.financeTodos).toBeUndefined();
    expect(
      csBody.data.attention.some((item) => item.kind === "SETTLEMENT_TODO"),
    ).toBe(false);
    expect(
      csBody.data.riskFeed.some((item) => item.kind === "SETTLEMENT_TODO"),
    ).toBe(false);
  });

  it("PLAYER/CUSTOMER 403；空店返回 0 计数", async () => {
    await req(playerToken).expect(403);
    await req(customerToken).expect(403);

    const b = await req(ownerBToken).expect(200);
    const body = b.body as {
      data: {
        metrics: {
          todoOrders: number;
          liveSessions: number;
          financeTodos: number;
          openDisputes: number;
          todayServiceCount: number;
        };
        attention: unknown[];
        riskFeed: unknown[];
      };
    };
    expect(body.data.metrics.todoOrders).toBe(0);
    expect(body.data.metrics.liveSessions).toBe(0);
    expect(body.data.metrics.financeTodos).toBe(0);
    expect(body.data.metrics.openDisputes).toBe(0);
    expect(body.data.metrics.todayServiceCount).toBe(0);
    expect(body.data.attention).toHaveLength(0);
    expect(body.data.riskFeed).toHaveLength(0);
  });
});

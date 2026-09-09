import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Grant-Renew-Password-1";
const suffix = Date.now().toString(36);
const actorUsername = `grant_admin_${suffix}`;
const supportUsername = `grant_support_${suffix}`;
const tenantCode = `grant_${suffix}`;

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

describe("P-B2b/P-B3/续费：跨租户临时授权门禁、平台审计汇总与订阅续费", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId = "";
  let subscriptionId = "";
  let actorId = "";
  let supportId = "";
  let actorToken = "";
  let supportToken = "";
  const createdAccountIds: string[] = [];

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);
    const actor = await client.platformAccount.create({
      data: {
        username: actorUsername,
        passwordHash: hash,
        role: "PLATFORM_SUPER_ADMIN",
      },
    });
    actorId = actor.id;
    createdAccountIds.push(actorId);
    const support = await client.platformAccount.create({
      data: {
        username: supportUsername,
        passwordHash: hash,
        role: "PLATFORM_SUPPORT",
      },
    });
    supportId = support.id;
    createdAccountIds.push(supportId);

    const tenant = await client.tenant.create({
      data: { code: tenantCode, name: "授权续费店", status: "ACTIVE" },
    });
    tenantId = tenant.id;
    const now = new Date();
    const subscription = await client.tenantSubscription.create({
      data: {
        tenantId,
        packageCode: "PRO",
        status: "ACTIVE",
        startsAt: now,
        endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    subscriptionId = subscription.id;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(username: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ kind: "platform", username, password: PW })
        .expect(201);
      return (res.body as { data: { accessToken: string } }).data.accessToken;
    }
    actorToken = await login(actorUsername);
    supportToken = await login(supportUsername);
  });

  afterAll(async () => {
    if (client) {
      await client.platformAccessGrant.deleteMany({
        where: {
          OR: [
            { grantorPlatformAccountId: { in: createdAccountIds } },
            { granteePlatformAccountId: { in: createdAccountIds } },
          ],
        },
      });
      await client.platformAuditEvent.deleteMany({
        where: { actorPlatformAccountId: { in: createdAccountIds } },
      });
      await client.auditLog.deleteMany({ where: { tenantId } });
      await client.tenantSubscription.deleteMany({ where: { tenantId } });
      await client.refreshSession.deleteMany({
        where: { accountId: { in: createdAccountIds } },
      });
      await client.platformAccount.deleteMany({
        where: { id: { in: createdAccountIds } },
      });
      await client.tenant.deleteMany({ where: { id: tenantId } });
      await client.$disconnect();
    }
    if (app) await app.close();
  });

  function req(token: string) {
    const headers = { authorization: `Bearer ${token}` };
    return {
      get: (url: string) => request(app.getHttpServer()).get(url).set(headers),
      post: (url: string, body?: unknown) =>
        request(app.getHttpServer())
          .post(url)
          .set(headers)
          .send(body ?? {}),
    };
  }

  it("support 无授权不能读门店明细；超管创建授权后 support 可读 detail/entitlements/audit", async () => {
    await req(supportToken)
      .get(`/api/v1/platform/tenants/${tenantId}/detail`)
      .expect(403);

    const created = await req(actorToken)
      .post("/api/v1/platform/grants", {
        granteeAccountId: supportId,
        tenantId,
        reason: "协助门店排查订单异常",
        durationMinutes: 120,
      })
      .expect(201);
    const grant = (created.body as { data: { id: string } }).data;
    expect(grant.id).toBeTruthy();

    const detail = await req(supportToken)
      .get(`/api/v1/platform/tenants/${tenantId}/detail`)
      .expect(200);
    expect((detail.body as { data: { code: string } }).data.code).toBe(
      tenantCode,
    );
    await req(supportToken)
      .get(`/api/v1/platform/tenants/${tenantId}/entitlements`)
      .expect(200);
    await req(supportToken)
      .get(`/api/v1/platform/tenants/${tenantId}/audit`)
      .expect(400);
    const audit = await req(supportToken)
      .get(
        `/api/v1/platform/tenants/${tenantId}/audit?reason=${encodeURIComponent(
          "订单结算客诉核查",
        )}`,
      )
      .expect(200);
    expect(Array.isArray((audit.body as { data: unknown }).data)).toBe(true);

    const list = await req(actorToken)
      .get("/api/v1/platform/grants")
      .expect(200);
    const rows = (list.body as { data: Array<{ id: string; status: string }> })
      .data;
    expect(
      rows.some((row) => row.id === grant.id && row.status === "ACTIVE"),
    ).toBe(true);

    await req(actorToken)
      .post(`/api/v1/platform/grants/${grant.id}/revoke`)
      .expect(200);
    await req(supportToken)
      .get(`/api/v1/platform/tenants/${tenantId}/detail`)
      .expect(403);
  });

  it("授权与撤销写平台审计；平台级审计汇总仅超管可见并含真实指标", async () => {
    const summary = await req(actorToken)
      .get("/api/v1/platform/audit")
      .expect(200);
    const body = (
      summary.body as {
        data: {
          rows: Array<{ action: string }>;
          metrics: {
            todayPlatformEvents: number;
            activeGrants: number;
          };
        };
      }
    ).data;
    expect(body.rows.some((row) => row.action === "access-grant.create")).toBe(
      true,
    );
    expect(body.rows.some((row) => row.action === "access-grant.revoke")).toBe(
      true,
    );
    expect(body.metrics.todayPlatformEvents).toBeGreaterThanOrEqual(1);
    expect(body.metrics.activeGrants).toBeGreaterThanOrEqual(0);

    await req(supportToken).get("/api/v1/platform/audit").expect(403);
  });

  it("超管可为 ACTIVE 订阅续费并写审计；非法周期/非 ACTIVE 被拒", async () => {
    const before = await client.tenantSubscription.findUniqueOrThrow({
      where: { id: subscriptionId },
    });
    const beforeEnds = before.endsAt?.getTime() ?? 0;
    const renewed = await req(actorToken)
      .post(`/api/v1/platform/subscriptions/${subscriptionId}/renew`, {
        months: 3,
        note: "线下已确认季付",
      })
      .expect(201);
    const result = (
      renewed.body as {
        data: { subscriptionId: string; packageCode: string; endsAt: string };
      }
    ).data;
    expect(result.subscriptionId).toBe(subscriptionId);
    expect(result.packageCode).toBe("PRO");
    expect(new Date(result.endsAt).getTime()).toBeGreaterThan(beforeEnds);

    const audit = await client.auditLog.findFirst({
      where: { tenantId, action: "subscription.renew" },
    });
    expect(audit).not.toBeNull();

    await req(actorToken)
      .post(`/api/v1/platform/subscriptions/${subscriptionId}/renew`, {
        months: 7,
      })
      .expect(400);
    await client.tenantSubscription.update({
      where: { id: subscriptionId },
      data: { status: "EXPIRED" },
    });
    await req(actorToken)
      .post(`/api/v1/platform/subscriptions/${subscriptionId}/renew`, {
        months: 1,
      })
      .expect(400);
  });
});

import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Merchant-Admin-Password-1";
const suffix = Date.now().toString(36);
const code = `ma_${suffix}`;

function envOrThrow(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing env ${name}`);
  return value;
}

describe("商家端管理/概览支撑 API（账号/通知未读/订阅/审计导出）", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId: string;
  let ownerToken: string;
  let ownerId: string;
  const createdAccountIds: string[] = [];
  const createdNotificationIds: string[] = [];

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);
    const tenant = await client.tenant.create({
      data: { code, name: "商家管理测试店" },
    });
    tenantId = tenant.id;
    const owner = await client.tenantAccount.create({
      data: { tenantId, username: "owner", passwordHash: hash },
    });
    ownerId = owner.id;
    await client.tenantAccountRole.create({
      data: { tenantId, tenantAccountId: owner.id, role: "TENANT_OWNER" },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ kind: "tenant", tenantCode: code, username: "owner", password: PW })
      .expect(201);
    ownerToken = (
      login.body as { data: { accessToken?: string } }
    ).data.accessToken as string;
  });

  afterAll(async () => {
    if (client) {
      await client.auditLog.deleteMany({ where: { tenantId } });
      await client.notificationDelivery.deleteMany({
        where: { tenantId },
      });
      await client.tenantSubscription.deleteMany({ where: { tenantId } });
      await client.tenantAccountRole.deleteMany({
        where: { tenantId, tenantAccountId: { in: createdAccountIds } },
      });
      await client.tenantAccount.deleteMany({
        where: { tenantId, id: { in: createdAccountIds } },
      });
      await client.tenantAccountRole.deleteMany({
        where: { tenantId, tenantAccountId: ownerId },
      });
      await client.tenantAccount.deleteMany({
        where: { tenantId, id: ownerId },
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
      patch: (url: string, body: unknown) =>
        request(app.getHttpServer()).patch(url).set(headers).send(body),
    };
  }

  it("店主可创建/列出员工并改角色与状态", async () => {
    const created = await req(ownerToken)
      .post("/api/v1/tenant/accounts", {
        username: "service01",
        password: PW,
        roles: ["CUSTOMER_SERVICE"],
      })
      .expect(201);
    const account = (
      created.body as { data: { id: string; username: string; roles: string[] } }
    ).data;
    createdAccountIds.push(account.id);
    expect(account.username).toBe("service01");
    expect(account.roles).toEqual(["CUSTOMER_SERVICE"]);

    const list = await req(ownerToken).get("/api/v1/tenant/accounts").expect(200);
    const rows = (
      list.body as {
        data: Array<{ id: string; username: string; roles: string[] }>;
      }
    ).data;
    expect(rows.some((row) => row.username === "service01")).toBe(true);

    const updated = await req(ownerToken)
      .patch(`/api/v1/tenant/accounts/${account.id}/roles`, {
        roles: ["CUSTOMER_SERVICE", "FINANCE"],
      })
      .expect(200);
    expect(
      (updated.body as { data: { roles: string[] } }).data.roles.sort(),
    ).toEqual(["CUSTOMER_SERVICE", "FINANCE"]);

    const disabled = await req(ownerToken)
      .patch(`/api/v1/tenant/accounts/${account.id}/status`, {
        status: "DISABLED",
      })
      .expect(200);
    expect(
      (disabled.body as { data: { status: string } }).data.status,
    ).toBe("DISABLED");

    await req(ownerToken)
      .patch(`/api/v1/tenant/accounts/${ownerId}/status`, {
        status: "DISABLED",
      })
      .expect(409);
  });

  it("非法角色/重复用户名返回 4xx", async () => {
    await req(ownerToken)
      .post("/api/v1/tenant/accounts", {
        username: "badrole",
        password: PW,
        roles: ["PLATFORM_SUPER_ADMIN"],
      })
      .expect(400);
    await req(ownerToken)
      .post("/api/v1/tenant/accounts", {
        username: "service01",
        password: PW,
        roles: ["CUSTOMER_SERVICE"],
      })
      .expect(409);
  });

  it("通知未读统计只返回未读数量", async () => {
    const created = await client.notificationDelivery.create({
      data: {
        tenantId,
        channel: "INAPP",
        title: "商家测试",
        content: "新订单提醒",
        recipientType: "order",
        recipientId: "00000000-0000-4000-8000-000000000009",
      },
    });
    createdNotificationIds.push(created.id);
    const result = await req(ownerToken)
      .get("/api/v1/tenant/notifications/unread-count")
      .expect(200);
    expect(
      (result.body as { data: { count: number } }).data.count,
    ).toBeGreaterThanOrEqual(1);
  });

  it("订阅读取接口返回当前 ACTIVE 订阅", async () => {
    const now = new Date();
    const endsAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await client.tenantSubscription.create({
      data: {
        tenantId,
        packageCode: "BASIC",
        status: "ACTIVE",
        startsAt: now,
        endsAt,
      },
    });
    const result = await req(ownerToken)
      .get("/api/v1/tenant/subscription")
      .expect(200);
    expect(
      (
        result.body as {
          data: { packageCode: string; status: string };
        }
      ).data.packageCode,
    ).toBe("BASIC");
  });

  it("审计支持关键词筛选与 CSV 导出", async () => {
    await client.auditLog.create({
      data: {
        tenantId,
        actorType: "TENANT_OWNER",
        actorId: ownerId,
        action: "order.create",
        resourceType: "order",
        resourceId: "00000000-0000-4000-8000-000000000010",
        summary: "创建订单 MA-TEST-ORDER",
      },
    });
    const filtered = await req(ownerToken)
      .get(
        `/api/v1/tenant/audit?q=${encodeURIComponent("MA-TEST-ORDER")}&action=order.create`,
      )
      .expect(200);
    const rows = (
      filtered.body as {
        data: Array<{ action: string; summary: string | null }>;
      }
    ).data;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.action).toBe("order.create");

    const exported = await req(ownerToken)
      .get(
        `/api/v1/tenant/audit/export?q=${encodeURIComponent("MA-TEST-ORDER")}`,
      )
      .expect(200);
    const csv = (
      exported.body as { data: { csv: string; filename: string } }
    ).data.csv;
    expect(csv).toContain("MA-TEST-ORDER");
    expect(csv).toContain("order.create");
  });
});

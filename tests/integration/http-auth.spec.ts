import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { RateLimitService } from "../../apps/api/src/common/auth/rate-limit.service.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "E2e-Password-1";
const suffix = Date.now().toString(36);

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

describe("HTTP auth E2E (cookie / permission matrix / audience / origin / rate limit)", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let rl: RateLimitService;
  let adminUsername: string;
  let supportUsername: string;
  let tenantCode: string;
  const tenantCodes: string[] = [];

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);
    adminUsername = `e2e_admin_${suffix}`;
    supportUsername = `e2e_support_${suffix}`;
    await client.platformAccount.create({
      data: {
        username: adminUsername,
        passwordHash: hash,
        role: "PLATFORM_SUPER_ADMIN",
      },
    });
    await client.platformAccount.create({
      data: {
        username: supportUsername,
        passwordHash: hash,
        role: "PLATFORM_SUPPORT",
      },
    });

    tenantCode = `e2e_${suffix}`;
    const tenant = await client.tenant.create({
      data: { code: tenantCode, name: "E2E 店" },
    });
    tenantCodes.push(tenantCode);
    const owner = await client.tenantAccount.create({
      data: { tenantId: tenant.id, username: "boss", passwordHash: hash },
    });
    await client.tenantAccountRole.create({
      data: {
        tenantId: tenant.id,
        tenantAccountId: owner.id,
        role: "TENANT_OWNER",
      },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    rl = app.get(RateLimitService);
  });

  beforeEach(() => {
    rl.resetAll();
  });

  afterAll(async () => {
    if (client) {
      await client.tenantAccountRole
        .deleteMany({ where: { tenantId: { in: tenantCodes.map(() => "") } } })
        .catch(() => undefined);
      await client.platformAccount.deleteMany({
        where: { username: { in: [adminUsername, supportUsername] } },
      });
      if (tenantCode) {
        await client.tenantAccountRole.deleteMany({
          where: { tenantAccount: { tenant: { code: tenantCode } } },
        });
        await client.tenantAccount.deleteMany({
          where: { tenant: { code: tenantCode } },
        });
        await client.tenantDomain.deleteMany({
          where: { tenant: { code: tenantCode } },
        });
        const httpTenant = await client.tenant.findUnique({
          where: { code: tenantCode },
        });
        if (httpTenant)
          await client.auditLog.deleteMany({
            where: { tenantId: httpTenant.id },
          });
        await client.tenant.deleteMany({ where: { code: tenantCode } });
      }
      await client.$disconnect();
    }
    if (app) await app.close();
  });

  async function login(
    kind: "platform" | "tenant",
    username: string,
    password: string,
    tenant?: string,
  ) {
    return request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({
        kind,
        username,
        password,
        ...(tenant ? { tenantCode: tenant } : {}),
      })
      .expect(201);
  }

  it("登录签发 access token 并设置 HttpOnly refresh cookie", async () => {
    const res = await login("platform", adminUsername, PW);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeUndefined();
    const setCookie = (res.headers["set-cookie"] ?? []).join(";");
    expect(setCookie).toContain("pw_refresh=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
  });

  it("权限矩阵：admin 可建租户，support 只有 view 不可建；平台/门店 audience 隔离", async () => {
    const admin = await login("platform", adminUsername, PW);
    const support = await login("platform", supportUsername, PW);

    const listAdmin = await request(app.getHttpServer())
      .get("/api/v1/platform/tenants")
      .set("authorization", `Bearer ${admin.body.data.accessToken}`)
      .expect(200);
    expect(Array.isArray(listAdmin.body.data)).toBe(true);

    await request(app.getHttpServer())
      .get("/api/v1/platform/tenants")
      .set("authorization", `Bearer ${support.body.data.accessToken}`)
      .expect(200);

    // support 无 tenant.manage
    await request(app.getHttpServer())
      .post("/api/v1/platform/tenants")
      .set("authorization", `Bearer ${support.body.data.accessToken}`)
      .send({ code: `denied_${suffix}`, name: "x" })
      .expect(403);

    // admin 可创建
    const code = `made_${suffix}`;
    tenantCodes.push(code);
    await request(app.getHttpServer())
      .post("/api/v1/platform/tenants")
      .set("authorization", `Bearer ${admin.body.data.accessToken}`)
      .send({ code, name: "创建测试店" })
      .expect(201);

    // 门店 token 不能访问平台端点
    const owner = await login("tenant", "boss", PW, tenantCode);
    await request(app.getHttpServer())
      .get("/api/v1/platform/tenants")
      .set("authorization", `Bearer ${owner.body.data.accessToken}`)
      .expect(401);
    // 门店 token 访问门店 me 正常
    const me = await request(app.getHttpServer())
      .get("/api/v1/tenant/me")
      .set("authorization", `Bearer ${owner.body.data.accessToken}`)
      .expect(200);
    expect(me.body.data.tenantId).toBeTruthy();
  });

  it("refresh 经 HttpOnly cookie 旋转，旧 token 立即失效", async () => {
    const agent = request.agent(app.getHttpServer());
    const first = await agent
      .post("/api/v1/auth/login")
      .send({ kind: "platform", username: adminUsername, password: PW })
      .expect(201);
    const cookieHeader = (first.headers["set-cookie"] ?? []) as string[];
    const oldRefresh = cookieHeader
      .find((c: string) => c.startsWith("pw_refresh="))
      ?.split(";")[0]
      ?.replace("pw_refresh=", "");
    expect(oldRefresh).toBeTruthy();
    const second = await agent
      .post("/api/v1/auth/refresh")
      .send({ scope: "platform" })
      .expect(201);
    expect(second.body.data.refreshToken).toBeUndefined();
    const newCookie = ((second.headers["set-cookie"] ?? []) as string[])
      .find((c: string) => c.startsWith("pw_refresh="))
      ?.split(";")[0]
      ?.replace("pw_refresh=", "");
    expect(newCookie).toBeTruthy();
    expect(newCookie).not.toBe(oldRefresh);

    const freshAgent = request.agent(app.getHttpServer());
    await freshAgent
      .post("/api/v1/auth/refresh")
      .send({ scope: "platform" })
      .expect(401);
    // 携带旧 token 的 cookie 也被拒绝
    await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .set("Cookie", `pw_refresh=${oldRefresh}`)
      .send({ scope: "platform" })
      .expect(401);
  });

  it("跨站 Origin 的 cookie refresh 被拒绝", async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post("/api/v1/auth/login")
      .send({ kind: "platform", username: adminUsername, password: PW })
      .expect(201);
    await agent
      .post("/api/v1/auth/refresh")
      .set("Origin", "https://evil.example")
      .send({ scope: "platform" })
      .expect(403);
  });

  it("登录失败限流：连续 5 次失败后返回 429", async () => {
    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ kind: "platform", username: adminUsername, password: "wrong" })
        .expect(401);
    }
    await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ kind: "platform", username: adminUsername, password: "wrong" })
      .expect(429);
  });
});

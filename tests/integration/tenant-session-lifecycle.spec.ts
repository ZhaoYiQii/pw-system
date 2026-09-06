import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Lifecycle-Password-1";
const suffix = Date.now().toString(36);

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

describe("A2 tenant session lifecycle (停用租户→登录/刷新拒绝 + refresh session 吊销)", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId: string;
  let tenantCode: string;
  let ownerAccountId = "";
  let platformToken: string;

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);
    tenantCode = `lc_${suffix}`;
    const t = await client.tenant.create({
      data: { code: tenantCode, name: "生命周期店" },
    });
    tenantId = t.id;
    const owner = await client.tenantAccount.create({
      data: { tenantId, username: "boss", passwordHash: hash },
    });
    ownerAccountId = owner.id;
    await client.tenantAccountRole.create({
      data: { tenantId, tenantAccountId: owner.id, role: "TENANT_OWNER" },
    });
    await client.platformAccount.create({
      data: {
        username: `lc_pf_${suffix}`,
        passwordHash: hash,
        role: "PLATFORM_SUPER_ADMIN",
      },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const pf = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ kind: "platform", username: `lc_pf_${suffix}`, password: PW })
      .expect(201);
    platformToken = (pf.body as { data: { accessToken: string } }).data
      .accessToken;
  });

  afterAll(async () => {
    if (client) {
      await client.auditLog.deleteMany({ where: { tenantId } });
      await client.refreshSession.deleteMany({
        where: { accountId: ownerAccountId },
      });
      await client.tenantAccountRole.deleteMany({ where: { tenantId } });
      await client.tenantAccount.deleteMany({ where: { tenantId } });
      await client.tenant.deleteMany({ where: { id: tenantId } });
      await client.platformAccount.deleteMany({
        where: { username: `lc_pf_${suffix}` },
      });
      await client.$disconnect();
    }
    if (app) await app.close();
  });

  function tenantLogin(): Promise<request.Response> {
    return request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ kind: "tenant", tenantCode, username: "boss", password: PW });
  }

  it("停用租户后：登录 401、refresh 401、refresh session 全部吊销；重新激活后可登录", async () => {
    const agent = request.agent(app.getHttpServer());
    const first = await agent
      .post("/api/v1/auth/login")
      .send({ kind: "tenant", tenantCode, username: "boss", password: PW })
      .expect(201);
    expect(
      (first.body as { data: { refreshToken?: string } }).data.refreshToken,
    ).toBeUndefined();
    await agent
      .post("/api/v1/auth/refresh")
      .send({ scope: "tenant" })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/platform/tenants/${tenantId}/deactivate`)
      .set("authorization", `Bearer ${platformToken}`)
      .expect(200);

    const openSessions = await client.refreshSession.count({
      where: { tenantId, revokedAt: null },
    });
    expect(openSessions).toBe(0);

    await tenantLogin().expect(401);
    await agent
      .post("/api/v1/auth/refresh")
      .send({ scope: "tenant" })
      .expect(401);

    await request(app.getHttpServer())
      .post(`/api/v1/platform/tenants/${tenantId}/activate`)
      .set("authorization", `Bearer ${platformToken}`)
      .expect(201);
    const again = await agent
      .post("/api/v1/auth/login")
      .send({ kind: "tenant", tenantCode, username: "boss", password: PW })
      .expect(201);
    expect(
      (again.body as { data: { accessToken: string } }).data.accessToken,
    ).toBeTruthy();
  });
});

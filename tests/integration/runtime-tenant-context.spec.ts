import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";

const PW = "Runtime-Isolation-1";
const suffix = Date.now().toString(36);
function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

describe("A4 runtime RLS acceptance (HTTP path + pw_runtime)", () => {
  let app: INestApplication;
  let migration: PrismaClient;
  let runtime: PrismaClient;
  let tenantA: { id: string; code: string };
  let tenantB: { id: string; code: string };
  let ownerAToken: string;
  let ownerBToken: string;

  beforeAll(async () => {
    migration = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    runtime = createDatabaseClient(envOrThrow("PW_TEST_RUNTIME_URL"));
    const hash = await hashPassword(PW);
    async function make(code: string, username: string) {
      const tenant = await migration.tenant.create({
        data: { code, name: code },
      });
      const account = await migration.tenantAccount.create({
        data: { tenantId: tenant.id, username, passwordHash: hash },
      });
      await migration.tenantAccountRole.create({
        data: {
          tenantId: tenant.id,
          tenantAccountId: account.id,
          role: "TENANT_OWNER",
        },
      });
      return { tenant, account };
    }
    const a = await make(`ra_${suffix}`, "boss_a");
    const b = await make(`rb_${suffix}`, "boss_b");
    tenantA = { id: a.tenant.id, code: a.tenant.code };
    tenantB = { id: b.tenant.id, code: b.tenant.code };

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    async function login(code: string, username: string) {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ kind: "tenant", tenantCode: code, username, password: PW })
        .expect(201);
      return (res.body as { data: { accessToken: string } }).data.accessToken;
    }
    ownerAToken = await login(tenantA.code, "boss_a");
    ownerBToken = await login(tenantB.code, "boss_b");
  });

  afterAll(async () => {
    if (migration) {
      for (const t of [tenantA, tenantB]) {
        if (!t) continue;
        await migration.customerProfile.deleteMany({
          where: { tenantId: t.id },
        });
        await migration.auditLog.deleteMany({ where: { tenantId: t.id } });
        await migration.tenantAccountRole.deleteMany({
          where: { tenantId: t.id },
        });
        await migration.tenantAccount.deleteMany({ where: { tenantId: t.id } });
        await migration.tenant.deleteMany({ where: { id: t.id } });
      }
      await migration.$disconnect();
      await runtime.$disconnect();
    }
    if (app) await app.close();
  });

  it("pw_runtime 无 GUC 时读不到任意租户账号（RLS 默认拒绝）", async () => {
    const count = await runtime.tenantAccount.count({
      where: { tenantId: { in: [tenantA.id, tenantB.id] } },
    });
    expect(count).toBe(0);
  });

  it("A 店 token 不能读/改 B 店资源（HTTP 404），不匹配 tenantId 被全局拒绝", async () => {
    const createdA = (
      await request(app.getHttpServer())
        .post("/api/v1/tenant/customers")
        .set("authorization", `Bearer ${ownerAToken}`)
        .send({ name: "A 店客户" })
        .expect(201)
    ).body.data as { id: string };

    await request(app.getHttpServer())
      .get(`/api/v1/tenant/customers/${createdA.id}`)
      .set("authorization", `Bearer ${ownerBToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/tenant/customers/${createdA.id}`)
      .set("authorization", `Bearer ${ownerBToken}`)
      .send({ name: "越权改名" })
      .expect(404);

    await request(app.getHttpServer())
      .post("/api/v1/tenant/customers")
      .set("authorization", `Bearer ${ownerAToken}`)
      .send({ name: "伪造 tenant", tenantId: tenantB.id })
      .expect(400);
  });
});

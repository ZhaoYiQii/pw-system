import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Fin-Password-1";
const suffix = Date.now().toString(36);
function envOrThrow(name: string): string { const v = process.env[name]; if (!v) throw new Error(`missing env ${name}`); return v; }
interface Data { accessToken?: string }

describe("Slice 8 finance rules (默认 3%/20%，可后台调整，split preview)", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId: string;
  let tenantCode: string;
  let ownerToken: string;
  let platformToken: string;

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);
    tenantCode = `fin_${suffix}`;
    const t = await client.tenant.create({ data: { code: tenantCode, name: "财务店" } });
    tenantId = t.id;
    const owner = await client.tenantAccount.create({ data: { tenantId, username: "boss", passwordHash: hash } });
    await client.tenantAccountRole.create({ data: { tenantId, tenantAccountId: owner.id, role: "TENANT_OWNER" } });
    const pa = await client.platformAccount.create({ data: { username: `pf_${suffix}`, passwordHash: hash, role: "PLATFORM_SUPER_ADMIN" } });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    async function loginT(username: string) {
      const res = await request(app.getHttpServer()).post("/api/v1/auth/login").send({ kind: "tenant", tenantCode, username, password: PW }).expect(201);
      return (res.body as { data: Data }).data.accessToken as string;
    }
    const pRes = await request(app.getHttpServer()).post("/api/v1/auth/login").send({ kind: "platform", username: `pf_${suffix}`, password: PW }).expect(201);
    ownerToken = await loginT("boss");
    platformToken = (pRes.body as { data: Data }).data.accessToken as string;
    void pa;
  });

  afterAll(async () => {
    if (client) {
      await client.auditLog.deleteMany({ where: { tenantId } });
      await client.financeRateRule.deleteMany({ where: { tenantId } });
      await client.tenantAccountRole.deleteMany({ where: { tenantId } });
      await client.tenantAccount.deleteMany({ where: { tenantId } });
      await client.platformAccount.deleteMany({ where: { username: `pf_${suffix}` } });
      await client.tenant.deleteMany({ where: { id: tenantId } });
      await client.$disconnect();
    }
    if (app) await app.close();
  });

  function req(token: string) {
    const h = { authorization: `Bearer ${token}` };
    return { get: (u: string) => request(app.getHttpServer()).get(u).set(h), post: (u: string, b: unknown) => request(app.getHttpServer()).post(u).set(h).send(b) };
  }

  it("默认 3%/20%；门店可改门店抽成；preview 分配守恒", async () => {
    const def = (await req(ownerToken).get("/api/v1/tenant/finance-rules").expect(200)).body.data as { platformFeeBp: number; storeCutBp: number };
    expect(def).toEqual({ platformFeeBp: 300, storeCutBp: 2000 });

    const preview = (await req(ownerToken).post("/api/v1/tenant/finance-rules/split-preview", { amountFen: 10000 }).expect(201)).body.data as {
      platformFeeFen: number;
      storeCutFen: number;
      playerShareFen: number;
    };
    expect(Number(preview.platformFeeFen) + Number(preview.storeCutFen) + Number(preview.playerShareFen)).toBe(10000);
    expect(preview).toEqual({ platformFeeFen: "300", storeCutFen: "2000", playerShareFen: "7700" });

    const set = await request(app.getHttpServer()).post("/api/v1/tenant/finance-rules/store-cut").set("authorization", `Bearer ${ownerToken}`).send({ storeCutBp: 1500 }).expect(201);
    expect((set.body.data as { storeCutBp: number }).storeCutBp).toBe(1500);
  });

  it("平台可调平台费率（跨租户）", async () => {
    const patched = await request(app.getHttpServer())
      .patch(`/api/v1/platform/tenants/${tenantId}/finance-rules`)
      .set("authorization", `Bearer ${platformToken}`)
      .send({ platformFeeBp: 400 })
      .expect(200);
    const data = patched.body.data as { platformFeeBp: number; storeCutBp: number };
    expect(data.platformFeeBp).toBe(400);
    expect(data.storeCutBp).toBe(1500);
  });
});

import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Pii-Mobile-Password-1";
const suffix = Date.now().toString(36);

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

describe("A5 手机号加密存储（AES-GCM + 租户内不可逆查询哈希）", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantA: string;
  let tenantB: string;
  let ownerAToken: string;
  let ownerBToken: string;

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);
    const codeA = `a5_${suffix}`;
    const codeB = `a5b_${suffix}`;
    const tA = await client.tenant.create({
      data: { code: codeA, name: "A5店" },
    });
    const tB = await client.tenant.create({
      data: { code: codeB, name: "A5隔壁店" },
    });
    tenantA = tA.id;
    tenantB = tB.id;

    async function createOwner(tenantId: string, username: string) {
      const acc = await client.tenantAccount.create({
        data: { tenantId, username, passwordHash: hash },
      });
      await client.tenantAccountRole.create({
        data: { tenantId, tenantAccountId: acc.id, role: "TENANT_OWNER" },
      });
      return acc;
    }
    await createOwner(tenantA, "ownerA");
    await createOwner(tenantB, "ownerB");

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(tenantCode: string, username: string) {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ kind: "tenant", tenantCode, username, password: PW })
        .expect(201);
      return (
        res.body as {
          data: { accessToken?: string };
        }
      ).data.accessToken as string;
    }
    ownerAToken = await login(codeA, "ownerA");
    ownerBToken = await login(codeB, "ownerB");
  });

  afterAll(async () => {
    if (client) {
      for (const tenantId of [tenantA, tenantB]) {
        await client.auditLog.deleteMany({ where: { tenantId } });
        await client.customerProfile.deleteMany({ where: { tenantId } });
        await client.playerProfile.deleteMany({ where: { tenantId } });
        await client.tenantAccountRole.deleteMany({ where: { tenantId } });
        await client.tenantAccount.deleteMany({ where: { tenantId } });
        await client.tenant.deleteMany({ where: { id: tenantId } });
      }
      await client.$disconnect();
    }
    if (app) await app.close();
  });

  function req(token: string) {
    const headers = { authorization: `Bearer ${token}` };
    return {
      get: (url: string) => request(app.getHttpServer()).get(url).set(headers),
      post: (url: string) =>
        request(app.getHttpServer()).post(url).set(headers),
      patch: (url: string) =>
        request(app.getHttpServer()).patch(url).set(headers),
    };
  }

  it("mobile 密文+哈希落库；读取返回解密明文；完整号码可按哈希精确检索", async () => {
    const created = (
      await req(ownerAToken)
        .post("/api/v1/tenant/customers")
        .send({ name: "手机客户甲", mobile: "138 0013 8000" })
        .expect(201)
    ).body.data as { id: string; name: string; mobile: string | null };
    expect(created.mobile).toBe("13800138000");

    const raw = await client.customerProfile.findFirstOrThrow({
      where: { tenantId: tenantA, name: "手机客户甲" },
      select: { mobileEnc: true, mobileHash: true },
    });
    expect(raw.mobileEnc).not.toBeNull();
    expect(raw.mobileEnc).not.toContain("13800138000");
    expect(raw.mobileEnc).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(raw.mobileHash).toMatch(/^[0-9a-f]{64}$/);

    const exact = (
      await req(ownerAToken)
        .get("/api/v1/tenant/customers?q=13800138000")
        .expect(200)
    ).body.data as Array<{ id: string }>;
    expect(exact.map((x) => x.id)).toContain(created.id);

    // 明文不再落库：部分号码不能靠 contains 命中。
    const partial = (
      await req(ownerAToken)
        .get("/api/v1/tenant/customers?q=1380013")
        .expect(200)
    ).body.data as Array<{ id: string }>;
    expect(partial.map((x) => x.id)).not.toContain(created.id);
  });

  it("同租户不同格式的同一号码创建 409；跨租户允许同号码", async () => {
    const a1 = (
      await req(ownerAToken)
        .post("/api/v1/tenant/customers")
        .send({ name: "手机客户乙", mobile: "139 0013 8000" })
        .expect(201)
    ).body.data as { id: string };
    await req(ownerAToken)
      .post("/api/v1/tenant/customers")
      .send({ name: "手机客户丙", mobile: "139-0013-8000" })
      .expect(409);
    const b1 = (
      await req(ownerBToken)
        .post("/api/v1/tenant/customers")
        .send({ name: "隔壁同号客户", mobile: "139 0013 8000" })
        .expect(201)
    ).body.data as { id: string };
    expect(b1.id).not.toBe(a1.id);
  });

  it("PATCH 清空 mobile 后密文与哈希均为 NULL", async () => {
    const created = (
      await req(ownerAToken)
        .post("/api/v1/tenant/customers")
        .send({ name: "待清空手机客户", mobile: "137 0013 8000" })
        .expect(201)
    ).body.data as { id: string };
    const cleared = (
      await req(ownerAToken)
        .patch(`/api/v1/tenant/customers/${created.id}`)
        .send({ mobile: null })
        .expect(200)
    ).body.data as { mobile: string | null };
    expect(cleared.mobile).toBeNull();
    const raw = await client.customerProfile.findFirstOrThrow({
      where: { id: created.id },
      select: { mobileEnc: true, mobileHash: true },
    });
    expect(raw.mobileEnc).toBeNull();
    expect(raw.mobileHash).toBeNull();
  });

  it("陪玩 mobile 同样密文落库并在 detail/me 解密返回", async () => {
    const created = (
      await req(ownerAToken)
        .post("/api/v1/tenant/players")
        .send({ name: "陪玩甲", mobile: "136 0013 8000" })
        .expect(201)
    ).body.data as { id: string; mobile: string | null };
    expect(created.mobile).toBe("13600138000");
    const raw = await client.playerProfile.findFirstOrThrow({
      where: { id: created.id },
      select: { mobileEnc: true, mobileHash: true },
    });
    expect(raw.mobileEnc).not.toBeNull();
    expect(raw.mobileEnc).not.toContain("13600138000");
    expect(raw.mobileHash).toMatch(/^[0-9a-f]{64}$/);
    const detail = (
      await req(ownerAToken)
        .get(`/api/v1/tenant/players/${created.id}`)
        .expect(200)
    ).body.data as { mobile: string | null };
    expect(detail.mobile).toBe("13600138000");
  });
});

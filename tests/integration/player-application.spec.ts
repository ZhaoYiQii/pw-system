import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import type { RoleKey } from "../../apps/api/src/modules/identity-access/domain/roles.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "PlayerApply-1";
const suffix = Date.now().toString(36);
const tenantCode = `pa_${suffix}`;

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

describe("P-3 player application（申请/审核/追加 PLAYER）", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId = "";
  let ownerToken = "";
  let customerToken = "";
  let customerAccountId = "";

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);
    const tenant = await client.tenant.create({
      data: { code: tenantCode, name: "陪玩申请店" },
    });
    tenantId = tenant.id;

    async function account(username: string, role: RoleKey) {
      const a = await client.tenantAccount.create({
        data: { tenantId, username, passwordHash: hash },
      });
      await client.tenantAccountRole.create({
        data: { tenantId, tenantAccountId: a.id, role },
      });
      return a;
    }
    const owner = await account("boss", "TENANT_OWNER");
    const customer = await account("bossone", "CUSTOMER");
    customerAccountId = customer.id;
    await client.customerProfile.create({
      data: {
        tenantId,
        tenantAccountId: customer.id,
        name: "申请老板",
      },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    async function login(username: string) {
      const r = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ kind: "tenant", tenantCode, username, password: PW })
        .expect(201);
      return (r.body as { data: { accessToken?: string } }).data
        .accessToken as string;
    }
    ownerToken = await login("boss");
    customerToken = await login("bossone");
    void owner;
  });

  afterAll(async () => {
    if (client) {
      await client.auditLog.deleteMany({ where: { tenantId } });
      await client.playerApplication.deleteMany({ where: { tenantId } });
      await client.playerProfile.deleteMany({ where: { tenantId } });
      await client.customerProfile.deleteMany({ where: { tenantId } });
      await client.tenantAccountRole.deleteMany({ where: { tenantId } });
      await client.tenantAccount.deleteMany({ where: { tenantId } });
      await client.tenant.deleteMany({ where: { id: tenantId } });
      await client.$disconnect();
    }
    if (app) await app.close();
  });

  function customerReq() {
    return request(app.getHttpServer())
      .post("/api/v1/tenant/player-applications")
      .set("authorization", `Bearer ${customerToken}`);
  }

  function ownerReq(path: string) {
    return request(app.getHttpServer())
      .post(path)
      .set("authorization", `Bearer ${ownerToken}`);
  }

  it("老板申请成为陪玩 → 店长审核通过 → 同一账号追加 PLAYER 并建档", async () => {
    const created = await customerReq()
      .send({ intro: "主玩三角洲，可陪可带" })
      .expect(201);
    const appId = (created.body as { data: { id: string } }).data.id;
    expect(appId.length).toBeGreaterThan(0);

    await customerReq().send({ intro: "重复申请" }).expect(409);

    const list = await request(app.getHttpServer())
      .get("/api/v1/tenant/player-applications")
      .set("authorization", `Bearer ${ownerToken}`)
      .expect(200);
    expect(
      (list.body as { data: Array<{ id: string }> }).data.some(
        (item) => item.id === appId,
      ),
    ).toBe(true);

    await ownerReq(`/api/v1/tenant/player-applications/${appId}/approve`)
      .send({})
      .expect(201);

    const profile = await client.playerProfile.findFirst({
      where: { tenantId, tenantAccountId: customerAccountId },
    });
    expect(profile).not.toBeNull();
    const roles = await client.tenantAccountRole.findMany({
      where: { tenantId, tenantAccountId: customerAccountId },
    });
    expect(roles.some((r) => r.role === "PLAYER")).toBe(true);
    const updated = await client.playerApplication.findUniqueOrThrow({
      where: { id: appId },
    });
    expect(updated.status).toBe("APPROVED");

    const switched = await request(app.getHttpServer())
      .post("/api/v1/auth/switch-context")
      .set("authorization", `Bearer ${customerToken}`)
      .send({ context: "PLAYER" })
      .expect(201);
    expect(
      (switched.body as { data: { principal: { role: string } } }).data
        .principal.role,
    ).toBe("PLAYER");
  });
});

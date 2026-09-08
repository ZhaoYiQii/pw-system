import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Platform-Ops-Password-1";
const suffix = Date.now().toString(36);
const code = `pops_${suffix}`;
const platformUsername = `pfops_${suffix}`;

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

describe("P-B1 platform ops（总览 / 订阅用量 / 门店详情）", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId: string;
  let platformToken: string;

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);
    await client.platformAccount.create({
      data: {
        username: platformUsername,
        passwordHash: hash,
        role: "PLATFORM_SUPER_ADMIN",
      },
    });

    const tenant = await client.tenant.create({
      data: { code, name: "运营对账店", status: "ACTIVE" },
    });
    tenantId = tenant.id;
    await client.tenantDomain.create({
      data: {
        tenantId,
        host: `${code}.example.com`,
        isPrimary: true,
      },
    });
    const owner = await client.tenantAccount.create({
      data: { tenantId, username: "boss", passwordHash: hash },
    });
    await client.tenantAccountRole.create({
      data: {
        tenantId,
        tenantAccountId: owner.id,
        role: "TENANT_OWNER",
      },
    });
    const startsAt = new Date();
    const endsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    await client.tenantSubscription.create({
      data: {
        tenantId,
        packageCode: "PRO",
        status: "ACTIVE",
        startsAt,
        endsAt,
      },
    });
    await client.tenantConfigVersion.create({
      data: {
        tenantId,
        version: 1,
        status: "ACTIVE",
        config: {
          schemaVersion: "v1",
          brand: {
            primaryColor: "#2f54eb",
            accentColor: "#fa8c16",
            logoText: code,
            borderRadius: 8,
          },
          storefront: {
            allowCustomerSelection: true,
            showServiceDuration: true,
          },
        },
      },
    });
    await client.financeRateRule.create({
      data: { tenantId, platformFeeBp: 300, storeCutBp: 2000 },
    });
    const customer = await client.customerProfile.create({
      data: { tenantId, name: "测试老板", mobileHash: `hash_${suffix}` },
    });
    await client.order.create({
      data: {
        tenantId,
        customerProfileId: customer.id,
        orderNo: `P${suffix}`,
        status: "CONFIRMED",
      },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ kind: "platform", username: platformUsername, password: PW })
      .expect(201);
    platformToken = (login.body as { data: { accessToken: string } }).data
      .accessToken;
  });

  afterAll(async () => {
    if (client) {
      const tenant = await client.tenant.findUnique({ where: { code } });
      if (tenant) {
        await client.order.deleteMany({ where: { tenantId: tenant.id } });
        await client.customerProfile.deleteMany({ where: { tenantId: tenant.id } });
        await client.tenantSubscription.deleteMany({
          where: { tenantId: tenant.id },
        });
        await client.tenantEntitlement.deleteMany({
          where: { tenantId: tenant.id },
        });
        await client.tenantConfigVersion.deleteMany({
          where: { tenantId: tenant.id },
        });
        await client.financeRateRule.deleteMany({
          where: { tenantId: tenant.id },
        });
        await client.auditLog.deleteMany({ where: { tenantId: tenant.id } });
        await client.tenantDomain.deleteMany({ where: { tenantId: tenant.id } });
        await client.tenantAccountRole.deleteMany({
          where: { tenantId: tenant.id },
        });
        await client.tenantAccount.deleteMany({ where: { tenantId: tenant.id } });
        await client.tenant.deleteMany({ where: { id: tenant.id } });
      }
      await client.platformAccount.deleteMany({
        where: { username: platformUsername },
      });
      await client.$disconnect();
    }
    if (app) await app.close();
  });

  function get(path: string) {
    return request(app.getHttpServer())
      .get(path)
      .set("authorization", `Bearer ${platformToken}`);
  }

  it("GET /platform/overview 返回门店计数与 7 天内到期订阅", async () => {
    const res = await get("/api/v1/platform/overview").expect(200);
    const data = (res.body as { data: { tenants: { total: number; active: number }; expiringSoon: number; health: { outboxPending: number; storageBytes: number | null } } }).data;
    expect(data.tenants.total).toBeGreaterThanOrEqual(1);
    expect(data.tenants.active).toBeGreaterThanOrEqual(1);
    expect(data.expiringSoon).toBeGreaterThanOrEqual(1);
    expect(data.health).toBeTypeOf("object");
    expect("storageBytes" in data.health).toBe(true);
  });

  it("GET /platform/subscriptions 返回套餐/到期与订单量", async () => {
    const res = await get("/api/v1/platform/subscriptions").expect(200);
    const rows = (res.body as { data: Array<{ tenantCode: string; packageCode: string | null; subscriptionStatus: string | null; orderCount: number }> }).data;
    const row = rows.find((r) => r.tenantCode === code);
    expect(row).toBeDefined();
    expect(row?.packageCode).toBe("PRO");
    expect(row?.subscriptionStatus).toBe("ACTIVE");
    expect(row?.orderCount).toBeGreaterThanOrEqual(1);
  });

  it("GET /platform/tenants/:id/detail 返回店主/套餐/分账/品牌", async () => {
    const res = await get(`/api/v1/platform/tenants/${tenantId}/detail`).expect(
      200,
    );
    const data = (res.body as { data: { ownerUsername: string | null; packageName: string | null; storeCutBp: number | null; brandPrimary: string | null } }).data;
    expect(data.ownerUsername).toBe("boss");
    expect(data.packageName).toBe("专业版");
    expect(data.storeCutBp).toBe(2000);
    expect(data.brandPrimary).toBe("#2f54eb");
  });

  it("不存在门店返回 404", async () => {
    await get("/api/v1/platform/tenants/00000000-0000-0000-0000-000000000000/detail").expect(
      404,
    );
  });
});

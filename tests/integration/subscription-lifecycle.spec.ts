import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { PlatformBillingService } from "../../apps/api/src/modules/platform-billing/platform-billing.service.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Subscription-Password-1";
const suffix = Date.now().toString(36);

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

async function onboardTenant(
  app: INestApplication,
  token: string,
  code: string,
  packageCode: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post("/api/v1/platform/onboarding/tenants")
    .set("authorization", `Bearer ${token}`)
    .send({
      code,
      name: `订阅店 ${code}`,
      host: `${code}.example.com`,
      ownerUsername: "boss",
      ownerPassword: "Onboard-123",
      brandPrimary: "#16a34a",
      storeCutBp: 2000,
      packageCode,
    })
    .expect(201);
  return (res.body as { data: { tenantId: string } }).data.tenantId;
}

describe("D3 订阅生命周期（唯一 ACTIVE/换套餐原子化/到期回收/激活完整性）", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let service: PlatformBillingService;
  let platformToken: string;
  const codes: string[] = [];

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    service = new PlatformBillingService(client);
    const hash = await hashPassword(PW);
    const username = `pfsub_${suffix}`;
    await client.platformAccount.create({
      data: { username, passwordHash: hash, role: "PLATFORM_SUPER_ADMIN" },
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ kind: "platform", username, password: PW })
      .expect(201);
    platformToken = (login.body as { data: { accessToken?: string } }).data
      .accessToken as string;
  });

  afterAll(async () => {
    if (client) {
      for (const code of codes) {
        const t = await client.tenant.findUnique({ where: { code } });
        if (!t) continue;
        await client.tenantSubscription.deleteMany({
          where: { tenantId: t.id },
        });
        await client.tenantEntitlement.deleteMany({
          where: { tenantId: t.id },
        });
        await client.tenantConfigVersion.deleteMany({
          where: { tenantId: t.id },
        });
        await client.financeRateRule.deleteMany({ where: { tenantId: t.id } });
        await client.auditLog.deleteMany({ where: { tenantId: t.id } });
        await client.tenantDomain.deleteMany({ where: { tenantId: t.id } });
        await client.tenantAccountRole.deleteMany({
          where: { tenantId: t.id },
        });
        await client.tenantAccount.deleteMany({ where: { tenantId: t.id } });
        await client.tenant.deleteMany({ where: { id: t.id } });
      }
      await client.platformAccount.deleteMany({
        where: { username: `pfsub_${suffix}` },
      });
      await client.$disconnect();
    }
    if (app) await app.close();
  });

  function req(token: string) {
    const h = { authorization: `Bearer ${token}` };
    return {
      get: (u: string) => request(app.getHttpServer()).get(u).set(h),
      post: (u: string, b?: unknown) =>
        request(app.getHttpServer())
          .post(u)
          .set(h)
          .send(b ?? {}),
    };
  }

  it("开通按套餐直接建唯一 ACTIVE；换套餐只保留一条 ACTIVE（旧单 SUPERSEDED）", async () => {
    const code = `d3a_${suffix}`;
    codes.push(code);
    const tenantId = await onboardTenant(app, platformToken, code, "PRO");
    const subs = await client.tenantSubscription.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
    });
    expect(subs).toHaveLength(1);
    expect(subs[0]?.status).toBe("ACTIVE");
    expect(subs[0]?.packageCode).toBe("PRO");
    expect(subs[0]?.endsAt).not.toBeNull();
    const entitlements = await client.tenantEntitlement.findMany({
      where: { tenantId },
    });
    expect(entitlements.map((e) => e.featureKey).sort()).toEqual([
      "addon.customer_self_service",
      "addon.player_order_hall",
    ]);

    await req(platformToken)
      .post(`/api/v1/platform/tenants/${tenantId}/package`, {
        packageCode: "PREMIUM",
      })
      .expect(201);
    const after = await client.tenantSubscription.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
    });
    expect(after).toHaveLength(2);
    expect(after.filter((s) => s.status === "ACTIVE")).toHaveLength(1);
    expect(after.find((s) => s.status === "ACTIVE")?.packageCode).toBe(
      "PREMIUM",
    );
    expect(after.some((s) => s.status === "SUPERSEDED")).toBe(true);
    const entitlementsAfter = await client.tenantEntitlement.findMany({
      where: { tenantId },
    });
    expect(
      entitlementsAfter.find((e) => e.featureKey === "addon.advanced_reports")
        ?.enabled,
    ).toBe(true);
  });

  it("DB 层拒绝第二个 ACTIVE；到期后置 EXPIRED 并回收 addon 权限", async () => {
    const code = `d3b_${suffix}`;
    codes.push(code);
    const tenantId = await onboardTenant(app, platformToken, code, "PRO");
    await expect(
      client.tenantSubscription.create({
        data: { tenantId, packageCode: "BASIC", status: "ACTIVE" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    await client.tenantSubscription.updateMany({
      where: { tenantId, status: "ACTIVE" },
      data: { endsAt: new Date(Date.now() - 1000) },
    });
    const expiredCount = await service.expireDueSubscriptions();
    expect(expiredCount).toBe(1);
    const subs = await client.tenantSubscription.findMany({
      where: { tenantId },
    });
    expect(subs[0]?.status).toBe("EXPIRED");
    const remainingAddons = await client.tenantEntitlement.findMany({
      where: { tenantId },
    });
    expect(remainingAddons).toHaveLength(0);
  });

  it("activate 校验开通完整性：缺配置/费率/店主/订阅任一即拒绝", async () => {
    const code = `d3c_${suffix}`;
    codes.push(code);
    const tenantId = await onboardTenant(app, platformToken, code, "BASIC");
    await client.financeRateRule.deleteMany({ where: { tenantId } });
    await client.tenant.update({
      where: { id: tenantId },
      data: { status: "INACTIVE" },
    });
    const res = await request(app.getHttpServer())
      .post(`/api/v1/platform/tenants/${tenantId}/activate`)
      .set("authorization", `Bearer ${platformToken}`)
      .send({})
      .expect(400);
    expect(JSON.stringify(res.body)).toContain("开通不完整");
    const tenant = await client.tenant.findFirstOrThrow({
      where: { id: tenantId },
    });
    expect(tenant.status).not.toBe("ACTIVE");
  });
});

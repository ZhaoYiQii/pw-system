import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Onboard-Password-1";
const suffix = Date.now().toString(36);
const tenantCode = `ob_${suffix}`;
function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}
interface Data {
  accessToken?: string;
}

describe("Slice 11 onboarding (平台一键开通/套餐/停用不可登录)", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let platformToken: string;
  let tenantId = "";

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);
    await client.platformAccount.create({
      data: {
        username: `pf11_${suffix}`,
        passwordHash: hash,
        role: "PLATFORM_SUPER_ADMIN",
      },
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ kind: "platform", username: `pf11_${suffix}`, password: PW })
      .expect(201);
    platformToken = (login.body as { data: Data }).data.accessToken as string;
  });

  afterAll(async () => {
    if (client) {
      const t = await client.tenant.findUnique({ where: { code: tenantCode } });
      if (t) {
        const tid = t.id;
        await client.tenantSubscription.deleteMany({
          where: { tenantId: tid },
        });
        await client.tenantEntitlement.deleteMany({ where: { tenantId: tid } });
        await client.tenantConfigVersion.deleteMany({
          where: { tenantId: tid },
        });
        await client.financeRateRule.deleteMany({ where: { tenantId: tid } });
        await client.auditLog.deleteMany({ where: { tenantId: tid } });
        await client.tenantDomain.deleteMany({ where: { tenantId: tid } });
        await client.tenantAccountRole.deleteMany({ where: { tenantId: tid } });
        await client.tenantAccount.deleteMany({ where: { tenantId: tid } });
        await client.tenant.deleteMany({ where: { id: tid } });
      }
      await client.platformAccount.deleteMany({
        where: { username: `pf11_${suffix}` },
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

  it("配置不完整不能开通；完整可开通→owner 可登录→套餐指派后 addon 开启", async () => {
    await req(platformToken)
      .post("/api/v1/platform/onboarding/tenants", {
        code: tenantCode,
        name: "开通店",
        host: `${tenantCode}.example.com`,
        ownerUsername: "boss",
        ownerPassword: "x",
      })
      .expect(400);

    const onboard = (
      await req(platformToken)
        .post("/api/v1/platform/onboarding/tenants", {
          code: tenantCode,
          name: "开通店",
          host: `${tenantCode}.example.com`,
          ownerUsername: "boss",
          ownerPassword: "Onboard-123",
          brandPrimary: "#16a34a",
          storeCutBp: 2000,
          packageCode: "BASIC",
        })
        .expect(201)
    ).body.data as { tenantId: string };
    tenantId = onboard.tenantId;

    const ownerLogin = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({
        kind: "tenant",
        tenantCode,
        username: "boss",
        password: "Onboard-123",
      })
      .expect(201);
    const ownerToken = (ownerLogin.body as { data: Data }).data
      .accessToken as string;
    const me = await req(ownerToken).get("/api/v1/tenant/me").expect(200);
    expect((me.body.data as { role: string }).role).toBe("TENANT_OWNER");

    // 指派 PRO → customer_self_service addon 开启
    await req(platformToken)
      .post(`/api/v1/platform/tenants/${tenantId}/package`, {
        packageCode: "PRO",
      })
      .expect(201);
    const feats = (
      await req(ownerToken).get("/api/v1/tenant/features").expect(200)
    ).body.data as Array<{ featureKey: string; enabled: boolean }>;
    expect(
      feats.find((f) => f.featureKey === "addon.customer_self_service")
        ?.enabled,
    ).toBe(true);
  });
});

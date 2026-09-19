import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const PW = "Onboard-Delivery-1";
const suffix = Date.now().toString(36);
const tenantCode = `oa1_${suffix}`;
const tenantHost = `${tenantCode}.shop.17ai.club`;

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

describe("OA-1 onboarding delivery（primaryHost/code 解析/409 冲突）", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let platformToken: string;

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const hash = await hashPassword(PW);
    await client.platformAccount.create({
      data: {
        username: `oa1admin_${suffix}`,
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
      .send({
        kind: "platform",
        username: `oa1admin_${suffix}`,
        password: PW,
      })
      .expect(201);
    platformToken = (login.body as { data: { accessToken?: string } }).data
      .accessToken as string;
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
        where: { username: `oa1admin_${suffix}` },
      });
      await client.$disconnect();
    }
    if (app) await app.close();
  });

  function platformReq() {
    return request(app.getHttpServer())
      .post("/api/v1/platform/onboarding/tenants")
      .set("authorization", `Bearer ${platformToken}`);
  }

  it("完整开通返回 primaryHost，且短码可解析门店与品牌", async () => {
    const onboard = await platformReq()
      .send({
        code: tenantCode,
        name: "OA1 交付店",
        host: tenantHost,
        ownerUsername: "boss",
        ownerPassword: "Onboard-123",
        brandPrimary: "#16a34a",
        storeCutBp: 2000,
        packageCode: "BASIC",
      })
      .expect(201);
    const data = (onboard.body as { data: unknown }).data as {
      tenantId: string;
      tenantCode: string;
      primaryHost: string;
    };
    expect(data.tenantCode).toBe(tenantCode);
    expect(data.primaryHost).toBe(tenantHost);

    const resolved = await request(app.getHttpServer())
      .get(
        `/api/v1/public/tenant-resolve?code=${encodeURIComponent(tenantCode)}`,
      )
      .expect(200);
    expect((resolved.body as { data: { code?: string } }).data.code).toBe(
      tenantCode,
    );

    const storefront = await request(app.getHttpServer())
      .get(
        `/api/v1/public/storefront/config?code=${encodeURIComponent(tenantCode)}`,
      )
      .expect(200);
    const sf = storefront.body as {
      data: {
        state: string;
        config: {
          brand?: { primaryColor?: string };
        } | null;
      };
    };
    expect(sf.data.state).toBe("active");
    expect(sf.data.config?.brand?.primaryColor).toBe("#16a34a");
  });

  it("重复 code / 重复 host 返回友好 409 与 problem code", async () => {
    const dupCode = await platformReq()
      .send({
        code: tenantCode,
        name: "重复 code 店",
        host: `${tenantCode}-dup.shop.17ai.club`,
        ownerUsername: "boss2",
        ownerPassword: "Onboard-123",
        brandPrimary: "#16a34a",
        storeCutBp: 2000,
        packageCode: "BASIC",
      })
      .expect(409);
    expect((dupCode.body as { code?: string }).code).toBe("TENANT_CODE_TAKEN");

    const dupHost = await platformReq()
      .send({
        code: `oa1b_${suffix}`,
        name: "重复 host 店",
        host: tenantHost,
        ownerUsername: "boss3",
        ownerPassword: "Onboard-123",
        brandPrimary: "#16a34a",
        storeCutBp: 2000,
        packageCode: "BASIC",
      })
      .expect(409);
    expect((dupHost.body as { code?: string }).code).toBe("HOST_TAKEN");
  });
});

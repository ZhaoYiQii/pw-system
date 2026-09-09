import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const suffix = Date.now().toString(36);
const tenantCode = `phreg_${suffix}`;
const phone = "13900002222";

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

describe("P-2 phone register/login（自动 CUSTOMER + 客户档案，二次登录同账号）", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId = "";

  async function issueCode(): Promise<string> {
    await client.phoneVerificationCode.deleteMany({ where: { tenantId } });
    const sent = await request(app.getHttpServer())
      .post("/api/v1/auth/phone-verification-code")
      .send({ tenantCode, phone })
      .expect(201);
    return (sent.body as { data: { debugCode?: string } }).data.debugCode ?? "";
  }

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const tenant = await client.tenant.create({
      data: { code: tenantCode, name: "手机注册店" },
    });
    tenantId = tenant.id;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (client) {
      const profiles = await client.customerProfile.findMany({
        where: { tenantId },
        select: { tenantAccountId: true },
      });
      const accountIds = profiles
        .map((p) => p.tenantAccountId)
        .filter((id): id is string => id !== null);
      await client.auditLog.deleteMany({ where: { tenantId } });
      await client.phoneVerificationCode.deleteMany({ where: { tenantId } });
      await client.customerProfile.deleteMany({ where: { tenantId } });
      if (accountIds.length > 0) {
        await client.tenantAccountRole.deleteMany({
          where: { tenantId, tenantAccountId: { in: accountIds } },
        });
        await client.tenantAccount.deleteMany({
          where: { id: { in: accountIds } },
        });
      }
      await client.tenant.deleteMany({ where: { id: tenantId } });
      await client.$disconnect();
    }
    if (app) await app.close();
  });

  it("验证码登录自动注册为 CUSTOMER 并创建客户档案", async () => {
    const code = await issueCode();
    expect(code).toMatch(/^\d{6}$/);
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/phone-login")
      .send({ tenantCode, phone, code })
      .expect(201);
    const data = login.body as {
      data: {
        accessToken: string;
        principal: {
          sub: string;
          role: string;
          tenantId?: string;
        };
      };
    };
    expect(data.data.principal.role).toBe("CUSTOMER");
    expect(data.data.principal.tenantId).toBe(tenantId);
    const accountId = data.data.principal.sub;
    const profile = await client.customerProfile.findFirst({
      where: { tenantId, tenantAccountId: accountId },
    });
    expect(profile).not.toBeNull();
    expect(profile?.name).toBe("用户2222");

    const code2 = await issueCode();
    const second = await request(app.getHttpServer())
      .post("/api/v1/auth/phone-login")
      .send({ tenantCode, phone, code: code2 })
      .expect(201);
    expect(
      (second.body as { data: { principal: { sub: string } } }).data.principal
        .sub,
    ).toBe(accountId);
  });
});

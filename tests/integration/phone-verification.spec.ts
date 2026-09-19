import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";
import { PhoneVerificationService } from "../../apps/api/src/modules/identity-access/application/phone-verification.service.js";

const suffix = Date.now().toString(36);
const tenantCode = `phone_${suffix}`;
const phone = "13800138000";

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

describe("P-1 phone verification (验证码发送/限流/校验/审计)", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let tenantId = "";
  let service: PhoneVerificationService;
  let issuedCode = "";

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const tenant = await client.tenant.create({
      data: { code: tenantCode, name: "验证码店" },
    });
    tenantId = tenant.id;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    service = moduleRef.get(PhoneVerificationService);
  });

  afterAll(async () => {
    if (client) {
      await client.auditLog.deleteMany({ where: { tenantId } });
      await client.phoneVerificationCode.deleteMany({ where: { tenantId } });
      await client.tenant.deleteMany({ where: { id: tenantId } });
      await client.$disconnect();
    }
    if (app) await app.close();
  });

  it("mock 模式返回 6 位调试验证码", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/phone-verification-code")
      .send({ tenantCode, phone })
      .expect(201);
    const code = (res.body as { data: { debugCode?: string } }).data.debugCode;
    expect(code).toMatch(/^\d{6}$/);
    issuedCode = code ?? "";
  });

  it("60 秒内重复发送被限流", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/auth/phone-verification-code")
      .send({ tenantCode, phone })
      .expect(429);
  });

  it("错误码校验失败，正确码可消费且不可重放", async () => {
    expect(issuedCode).toMatch(/^\d{6}$/);
    await expect(
      service.consumeCode(tenantId, phone, "000000"),
    ).rejects.toThrow("验证码不正确");
    await expect(
      service.consumeCode(tenantId, phone, issuedCode),
    ).resolves.toBeUndefined();
    await expect(
      service.consumeCode(tenantId, phone, issuedCode),
    ).rejects.toThrow("验证码不存在或已过期");
  });
});

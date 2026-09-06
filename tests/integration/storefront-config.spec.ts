import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/app.module.js";
import { TenantConfigService } from "../../apps/api/src/modules/tenant-config/application/config.service.js";
import { PrismaConfigRepository } from "../../apps/api/src/modules/tenant-config/infrastructure/prisma-config.repository.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const suffix = Date.now().toString(36);
const host = `store-${suffix}.example.test`;

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

describe("public storefront-config (host→品牌 token / CONFIG_ERROR 门店不可用)", () => {
  let app: INestApplication;
  let client: PrismaClient;
  let config: TenantConfigService;
  let tenantId: string;
  const tenantCode = `sf_${suffix}`;

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const tenant = await client.tenant.create({
      data: { code: tenantCode, name: "前台配置店" },
    });
    tenantId = tenant.id;
    await client.tenantDomain.create({
      data: { tenantId, host, isPrimary: true },
    });
    config = new TenantConfigService(new PrismaConfigRepository(client));

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (client) {
      await client.tenantConfigVersion.deleteMany({ where: { tenantId } });
      await client.tenantDomain.deleteMany({ where: { tenantId } });
      await client.tenant.deleteMany({ where: { id: tenantId } });
      await client.$disconnect();
    }
    if (app) await app.close();
  });

  function storefront() {
    return request(app.getHttpServer())
      .get("/api/v1/public/storefront/config")
      .query({ host });
  }

  it("有效门店未保存配置时返回默认品牌 token（version 0）", async () => {
    const res = await storefront().expect(200);
    expect(res.body.data.state).toBe("active");
    expect(res.body.data.tenant.code).toBe(tenantCode);
    expect(res.body.data.version).toBe(0);
    expect(res.body.data.config.brand.primaryColor).toBe("#2f54eb");
    expect(res.body.data.config.brand.logoText).toBe("PW");
  });

  it("保存品牌覆盖后公开接口返回覆盖值", async () => {
    await config.save(tenantId, {
      schemaVersion: "v1",
      brand: {
        primaryColor: "#111111",
        accentColor: "#fa8c16",
        logoText: "Demo店",
        borderRadius: 12,
      },
      storefront: { allowCustomerSelection: true, showServiceDuration: false },
    });
    const res = await storefront().expect(200);
    expect(res.body.data.state).toBe("active");
    expect(res.body.data.version).toBe(1);
    expect(res.body.data.config.brand.primaryColor).toBe("#111111");
    expect(res.body.data.config.brand.logoText).toBe("Demo店");
    expect(res.body.data.config.storefront.showServiceDuration).toBe(false);
  });

  it("历史配置损坏时门店进入 CONFIG_ERROR，公开接口不猜测默认值", async () => {
    await client.tenantConfigVersion.updateMany({
      where: { tenantId },
      data: { status: "SUPERSEDED" },
    });
    await client.tenantConfigVersion.create({
      data: {
        tenantId,
        version: 2,
        status: "ACTIVE",
        config: { brand: { primaryColor: "red" } },
      },
    });
    const res = await storefront().expect(200);
    expect(res.body.data.state).toBe("config_error");
    expect(res.body.data.version).toBe(2);
    expect(res.body.data.config).toBeNull();
  });

  it("未知 host 返回 404", async () => {
    await request(app.getHttpServer())
      .get("/api/v1/public/storefront/config")
      .query({ host: "nope.example.test" })
      .expect(404);
  });

  it("停用门店返回 inactive", async () => {
    await client.tenant.update({
      where: { id: tenantId },
      data: { status: "INACTIVE" },
    });
    const res = await storefront().expect(200);
    expect(res.body.data.state).toBe("inactive");
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantConfigService } from "../../apps/api/src/modules/tenant-config/application/config.service.js";
import { PrismaConfigRepository } from "../../apps/api/src/modules/tenant-config/infrastructure/prisma-config.repository.js";
import { InvalidTenantConfigError } from "../../apps/api/src/modules/tenant-config/domain/errors.js";
import { EntitlementsService } from "../../apps/api/src/modules/entitlements/application/entitlements.service.js";
import { PrismaEntitlementRepository } from "../../apps/api/src/modules/entitlements/infrastructure/prisma-entitlement.repository.js";
import { FeatureDisabledError, UnknownFeatureError } from "../../apps/api/src/modules/entitlements/domain/errors.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const suffix = Date.now().toString(36);

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

describe("tenant-config + entitlements", () => {
  let client: PrismaClient;
  let config: TenantConfigService;
  let entitlements: EntitlementsService;
  let tenantId: string;
  const tenantCode = `cfg_${suffix}`;

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const tenant = await client.tenant.create({ data: { code: tenantCode, name: "配置测试店" } });
    tenantId = tenant.id;
    config = new TenantConfigService(new PrismaConfigRepository(client));
    entitlements = new EntitlementsService(new PrismaEntitlementRepository(client));
  });

  afterAll(async () => {
    if (client) {
      await client.tenantConfigVersion.deleteMany({ where: { tenantId } });
      await client.tenantEntitlement.deleteMany({ where: { tenantId } });
      await client.tenant.deleteMany({ where: { id: tenantId } });
      await client.$disconnect();
    }
  });

  it("未保存时返回默认配置", async () => {
    const eff = await config.getEffective(tenantId);
    expect(eff.status).toBe("ACTIVE");
    expect(eff.version).toBe(0);
    expect(eff.config?.brand.primaryColor).toBe("#2f54eb");
  });

  it("非法配置（颜色）被拒绝", async () => {
    await expect(config.save(tenantId, { config: { brand: { primaryColor: "red" } } })).rejects.toBeInstanceOf(InvalidTenantConfigError);
  });

  it("保存合法配置并生效（版本+覆盖）", async () => {
    const eff = await config.save(tenantId, {
      schemaVersion: "v1",
      brand: { primaryColor: "#111111", accentColor: "#fa8c16", logoText: "Demo", borderRadius: 8 },
      storefront: { allowCustomerSelection: true, showServiceDuration: false }
    });
    expect(eff.version).toBe(1);
    expect(eff.hasSaved).toBe(true);
    expect(eff.config?.brand.primaryColor).toBe("#111111");
    expect(eff.config?.storefront.showServiceDuration).toBe(false);
    const versions = await config.listVersions(tenantId);
    expect(versions.length).toBe(1);
  });

  it("保存 v2 后可回滚到 v1", async () => {
    await config.save(tenantId, {
      schemaVersion: "v1",
      brand: { primaryColor: "#222222", accentColor: "#fa8c16", logoText: "Demo", borderRadius: 8 },
      storefront: { allowCustomerSelection: true, showServiceDuration: true }
    });
    const eff = await config.rollback(tenantId);
    expect(eff.version).toBe(1);
    expect(eff.config?.brand.primaryColor).toBe("#111111");
  });

  it("entitlements：core 常开，addon 默认关，平台可开并门禁生效", async () => {
    const before = await entitlements.listFeatures(tenantId);
    expect(before.find((f) => f.featureKey === "core.tenancy")?.enabled).toBe(true);
    expect(before.find((f) => f.featureKey === "addon.customer_self_service")?.enabled).toBe(false);

    await expect(entitlements.ensureAddonEnabled(tenantId, "addon.player_order_hall")).rejects.toBeInstanceOf(FeatureDisabledError);
    await expect(entitlements.setFeature(tenantId, "core.tenancy", false)).rejects.toBeInstanceOf(UnknownFeatureError);
    await expect(entitlements.setFeature(tenantId, "no.such.addon", true)).rejects.toBeInstanceOf(UnknownFeatureError);

    await entitlements.setFeature(tenantId, "addon.customer_self_service", true);
    const after = await entitlements.listFeatures(tenantId);
    expect(after.find((f) => f.featureKey === "addon.customer_self_service")?.enabled).toBe(true);
    await expect(entitlements.ensureAddonEnabled(tenantId, "addon.customer_self_service")).resolves.toBe("addon.customer_self_service");
  });
});

import { describe, expect, it } from "vitest";
import {
  DEFAULT_TENANT_CONFIG,
  safeParseTenantConfig,
} from "../../packages/config-schema/src/index.js";
import {
  ADDON_FEATURES,
  CORE_FEATURES,
  FEATURE_KEYS,
  isCoreFeature,
} from "../../apps/api/src/modules/entitlements/domain/features.js";

describe("contract: tenant-config v1 + feature catalog", () => {
  it("默认配置通过契约 schema", () => {
    expect(safeParseTenantConfig(DEFAULT_TENANT_CONFIG).success).toBe(true);
  });

  it("schemaVersion 非 v1 被拒绝", () => {
    const bad = { ...DEFAULT_TENANT_CONFIG, schemaVersion: "v2" } as unknown;
    expect(safeParseTenantConfig(bad).success).toBe(false);
  });

  it("功能目录：10 core + 12 addon，无重复，core 判定正确", () => {
    expect(CORE_FEATURES).toHaveLength(10);
    expect(ADDON_FEATURES).toHaveLength(12);
    expect(new Set(FEATURE_KEYS).size).toBe(FEATURE_KEYS.length);
    expect(isCoreFeature("core.tenancy")).toBe(true);
    expect(isCoreFeature("addon.online_payment")).toBe(false);
  });
});

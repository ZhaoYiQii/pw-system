import { describe, expect, it } from "vitest";
import {
  DEFAULT_TENANT_CONFIG,
  mergeTenantConfig,
  parseTenantConfig,
  safeParseTenantConfig,
} from "./index.js";

describe("tenant-config v1 schema", () => {
  it("默认配置合法", () => {
    expect(safeParseTenantConfig(DEFAULT_TENANT_CONFIG).success).toBe(true);
  });

  it("非法颜色被拒绝", () => {
    const bad = {
      ...DEFAULT_TENANT_CONFIG,
      brand: { ...DEFAULT_TENANT_CONFIG.brand, primaryColor: "red" },
    };
    expect(safeParseTenantConfig(bad).success).toBe(false);
  });

  it("任意 HTML/CSS/JS 类字段与未知字段被拒绝（strict）", () => {
    const withUnknown = {
      ...DEFAULT_TENANT_CONFIG,
      customCssUrl: "https://evil.example/x.css",
    };
    expect(safeParseTenantConfig(withUnknown).success).toBe(false);
    const withScript = {
      schemaVersion: "v1",
      brand: { ...DEFAULT_TENANT_CONFIG.brand },
      storefront: DEFAULT_TENANT_CONFIG.storefront,
      scripts: ["alert(1)"],
    } as unknown;
    expect(safeParseTenantConfig(withScript).success).toBe(false);
  });

  it("borderRadius 越界被拒绝", () => {
    const bad = {
      ...DEFAULT_TENANT_CONFIG,
      brand: { ...DEFAULT_TENANT_CONFIG.brand, borderRadius: 99 },
    };
    expect(safeParseTenantConfig(bad).success).toBe(false);
  });

  it("分层合并以 override 为准并保持合法", () => {
    const override = parseTenantConfig({
      ...DEFAULT_TENANT_CONFIG,
      brand: {
        ...DEFAULT_TENANT_CONFIG.brand,
        primaryColor: "#111111",
        logoText: "Demo",
      },
    });
    const merged = mergeTenantConfig(DEFAULT_TENANT_CONFIG, override);
    expect(merged.brand.primaryColor).toBe("#111111");
    expect(merged.brand.logoText).toBe("Demo");
    expect(merged.storefront).toEqual(DEFAULT_TENANT_CONFIG.storefront);
  });
});

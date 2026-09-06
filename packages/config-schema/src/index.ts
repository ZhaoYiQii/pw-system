// 主规格 8.3/13：配置层级 Platform Default → Product Package Default → Tenant Override → Campaign。
// 本包定义 tenant-config v1 的 Zod schema、默认值与合并；禁止任意 HTML/CSS URL/JS（主规格 16.2）。
import { z } from "zod";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const tenantConfigV1Schema = z
  .object({
    schemaVersion: z.literal("v1"),
    brand: z.object({
      primaryColor: z.string().regex(HEX_COLOR, "invalid hex color"),
      accentColor: z.string().regex(HEX_COLOR, "invalid hex color"),
      logoText: z.string().min(1).max(40),
      borderRadius: z.number().int().min(0).max(24)
    }),
    storefront: z.object({
      allowCustomerSelection: z.boolean(),
      showServiceDuration: z.boolean()
    })
  })
  .strict(); // 未知字段拒绝（Slice 3 红测试）

export type TenantConfigV1 = z.infer<typeof tenantConfigV1Schema>;
export type TenantConfigV1Input = z.input<typeof tenantConfigV1Schema>;

export const DEFAULT_TENANT_CONFIG: TenantConfigV1 = {
  schemaVersion: "v1",
  brand: {
    primaryColor: "#2f54eb",
    accentColor: "#fa8c16",
    logoText: "PW",
    borderRadius: 8
  },
  storefront: {
    allowCustomerSelection: true,
    showServiceDuration: true
  }
};

export function parseTenantConfig(input: unknown): TenantConfigV1 {
  return tenantConfigV1Schema.parse(input);
}

export function safeParseTenantConfig(input: unknown) {
  return tenantConfigV1Schema.safeParse(input);
}

/** 浅层分层合并：brand/storefront 整体覆盖（门店不维护平台未开放字段），随后整体校验。 */
export function mergeTenantConfig(base: TenantConfigV1, override: TenantConfigV1): TenantConfigV1 {
  const merged = {
    schemaVersion: "v1" as const,
    brand: { ...base.brand, ...override.brand },
    storefront: { ...base.storefront, ...override.storefront }
  };
  return parseTenantConfig(merged);
}

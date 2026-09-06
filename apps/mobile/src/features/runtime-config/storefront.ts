import type {
  StorefrontBrand,
  StorefrontFlags,
  StorefrontInfo,
  StorefrontTenant,
} from "../../platform/contracts/runtime-config";

// 客户端侧二次校验（防御性）：与服务端同源规则，禁止把任意值当作 token 渲染。
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const LOGO_TEXT_MAX = 40;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readTenant(value: unknown): StorefrontTenant | null {
  if (!isRecord(value)) return null;
  const { id, code, name } = value;
  if (
    typeof id !== "string" ||
    typeof code !== "string" ||
    typeof name !== "string"
  ) {
    return null;
  }
  return { id, code, name };
}

function readBrand(config: unknown): StorefrontBrand | null {
  if (!isRecord(config) || !isRecord(config.brand)) return null;
  const { primaryColor, accentColor, logoText, borderRadius } = config.brand;
  if (typeof primaryColor !== "string" || !HEX_COLOR.test(primaryColor))
    return null;
  if (typeof accentColor !== "string" || !HEX_COLOR.test(accentColor))
    return null;
  if (
    typeof logoText !== "string" ||
    logoText.trim().length < 1 ||
    logoText.length > LOGO_TEXT_MAX
  ) {
    return null;
  }
  if (
    typeof borderRadius !== "number" ||
    !Number.isInteger(borderRadius) ||
    borderRadius < 0 ||
    borderRadius > 24
  ) {
    return null;
  }
  return { primaryColor, accentColor, logoText: logoText.trim(), borderRadius };
}

function readStorefront(config: unknown): StorefrontFlags | null {
  if (!isRecord(config) || !isRecord(config.storefront)) return null;
  const { allowCustomerSelection, showServiceDuration } = config.storefront;
  if (
    typeof allowCustomerSelection !== "boolean" ||
    typeof showServiceDuration !== "boolean"
  ) {
    return null;
  }
  return { allowCustomerSelection, showServiceDuration };
}

const EMPTY: Pick<
  StorefrontInfo,
  "tenant" | "version" | "brand" | "storefront"
> = {
  tenant: null,
  version: 0,
  brand: null,
  storefront: null,
};

/**
 * 把公开 storefront-config 响应解析为类型化结果。
 * 规则：未知/损坏字段不猜测默认值 → config_error；仅返回受限 brand token。
 */
export function parseStorefrontConfigPayload(payload: unknown): StorefrontInfo {
  if (!isRecord(payload))
    return { state: "error", ...EMPTY, message: "malformed response" };
  const state = payload.state;
  const tenant = readTenant(payload.tenant);
  const version =
    typeof payload.version === "number" && payload.version >= 0
      ? payload.version
      : 0;

  if (state === "active") {
    const brand = readBrand(payload.config);
    const storefront = readStorefront(payload.config);
    if (!brand || !storefront) {
      return {
        state: "config_error",
        tenant,
        version,
        brand: null,
        storefront: null,
      };
    }
    return { state: "ok", tenant, version, brand, storefront };
  }
  if (state === "inactive") {
    return {
      state: "inactive",
      tenant,
      version,
      brand: null,
      storefront: null,
    };
  }
  if (state === "config_error") {
    return {
      state: "config_error",
      tenant,
      version,
      brand: null,
      storefront: null,
    };
  }
  return {
    state: "error",
    tenant,
    version,
    brand: null,
    storefront: null,
    message: "unknown state",
  };
}

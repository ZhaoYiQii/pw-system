import { parseStorefrontConfigPayload } from "../../features/runtime-config/storefront";
import type {
  StorefrontInfo,
  RuntimeConfigAdapter,
} from "../contracts/runtime-config";

function apiBase(): string {
  // H5 运行时无 Node `process`；仅在存在时读取，避免 ReferenceError。
  const configured =
    typeof process !== "undefined" ? process.env?.TARO_APP_API_BASE : undefined;
  if (configured) return configured;
  if (typeof location !== "undefined") return location.origin;
  return "";
}

/** H5：按当前域名（已验证域名）读取公开门店前台配置（主规格 8.1 host 来源）。 */
export const runtimeConfig: RuntimeConfigAdapter = {
  async loadStorefrontConfig(): Promise<StorefrontInfo> {
    try {
      const host = typeof location !== "undefined" ? location.host : "";
      const base = apiBase();
      if (!host || !base) {
        return {
          state: "unconfigured",
          tenant: null,
          version: 0,
          brand: null,
          storefront: null,
        };
      }
      const res = await fetch(
        `${base}/api/v1/public/storefront/config?host=${encodeURIComponent(host)}`,
      );
      if (res.status === 404) {
        return {
          state: "not_found",
          tenant: null,
          version: 0,
          brand: null,
          storefront: null,
        };
      }
      if (!res.ok) {
        return {
          state: "error",
          tenant: null,
          version: 0,
          brand: null,
          storefront: null,
          message: `HTTP ${res.status}`,
        };
      }
      const body = (await res.json()) as { data?: unknown };
      return parseStorefrontConfigPayload(body?.data);
    } catch {
      return {
        state: "error",
        tenant: null,
        version: 0,
        brand: null,
        storefront: null,
      };
    }
  },
};

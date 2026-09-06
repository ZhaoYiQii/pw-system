import type {
  ResolvedTenantInfo,
  TenantLocatorAdapter,
} from "../contracts/tenant-locator";

function apiBase(): string {
  // H5 运行时无 Node `process`；仅在存在时读取，避免 ReferenceError。
  const configured =
    typeof process !== "undefined" ? process.env?.TARO_APP_API_BASE : undefined;
  if (configured) return configured;
  if (typeof location !== "undefined") return location.origin;
  return "";
}

/** H5：按当前域名（已验证域名）调用公开解析接口（主规格 8.1 host 来源）。 */
export const tenantLocator: TenantLocatorAdapter = {
  async resolveTenant(): Promise<ResolvedTenantInfo> {
    try {
      const host = typeof location !== "undefined" ? location.host : "";
      const base = apiBase();
      if (!host || !base) return { state: "unconfigured" };
      const res = await fetch(
        `${base}/api/v1/public/tenant-resolve?host=${encodeURIComponent(host)}`,
      );
      if (res.status === 404) return { state: "not_found" };
      if (!res.ok) return { state: "error" };
      const body = (await res.json()) as {
        data?: { id: string; code: string; name: string; status: string };
      };
      const data = body.data;
      if (!data) return { state: "error" };
      if (data.status === "INACTIVE")
        return { state: "inactive", tenant: data };
      return { state: "ok", tenant: data };
    } catch {
      return { state: "error" };
    }
  },
};

import type {
  ResolvedTenantInfo,
  TenantLocatorAdapter,
} from "../contracts/tenant-locator";
import { resolveLocatorParam } from "../../features/tenant-locator/locator";
import { apiBase } from "./api-base";

/** H5：按当前域名（已验证域名）调用公开解析接口（主规格 8.1 host 来源）。 */
export const tenantLocator: TenantLocatorAdapter = {
  async resolveTenant(): Promise<ResolvedTenantInfo> {
    try {
      const search = typeof location !== "undefined" ? location.search : "";
      const host = typeof location !== "undefined" ? location.host : "";
      const base = apiBase();
      const target = resolveLocatorParam(search, host);
      if (!target || !base) return { state: "unconfigured" };
      const res = await fetch(
        `${base}/api/v1/public/tenant-resolve?${target.name}=${encodeURIComponent(target.value)}`,
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

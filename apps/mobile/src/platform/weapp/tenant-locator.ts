import type {
  ResolvedTenantInfo,
  TenantLocatorAdapter,
} from "../contracts/tenant-locator";

/** 小程序开发暂缓：Slice 1 仅提供 typed unsupported，不伪装成功。 */
export const tenantLocator: TenantLocatorAdapter = {
  async resolveTenant(): Promise<ResolvedTenantInfo> {
    return { state: "unconfigured" };
  },
};

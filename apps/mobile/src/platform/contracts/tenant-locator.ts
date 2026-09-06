export type TenantResolveState = "ok" | "not_found" | "inactive" | "unconfigured" | "error";

export interface ResolvedTenantInfo {
  state: TenantResolveState;
  tenant?: { id: string; code: string; name: string; status: string };
}

/** 主规格 13.1：H5/小程序统一的租户定位接口。业务只依赖本契约，不直接判断平台。 */
export interface TenantLocatorAdapter {
  resolveTenant(): Promise<ResolvedTenantInfo>;
}

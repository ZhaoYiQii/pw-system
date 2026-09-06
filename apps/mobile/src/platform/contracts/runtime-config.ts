export type StorefrontState =
  "ok" | "not_found" | "inactive" | "config_error" | "unconfigured" | "error";

/** 受限品牌 design token（主规格 16.2：禁止任意 HTML/CSS/JS，仅 hex/文本/数值）。 */
export interface StorefrontBrand {
  primaryColor: string;
  accentColor: string;
  logoText: string;
  borderRadius: number;
}

export interface StorefrontFlags {
  allowCustomerSelection: boolean;
  showServiceDuration: boolean;
}

export interface StorefrontTenant {
  id: string;
  code: string;
  name: string;
}

export interface StorefrontInfo {
  state: StorefrontState;
  tenant: StorefrontTenant | null;
  version: number;
  brand: StorefrontBrand | null;
  storefront: StorefrontFlags | null;
  message?: string;
}

/** 主规格 13.1：H5/小程序统一的运行时配置读取接口；业务只依赖契约。 */
export interface RuntimeConfigAdapter {
  loadStorefrontConfig(): Promise<StorefrontInfo>;
}

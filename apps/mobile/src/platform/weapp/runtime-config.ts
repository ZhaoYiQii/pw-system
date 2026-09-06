import type {
  RuntimeConfigAdapter,
  StorefrontInfo,
} from "../contracts/runtime-config";

/** 小程序开发暂缓：Slice 3 仅提供 typed unsupported，不伪装成功。 */
export const runtimeConfig: RuntimeConfigAdapter = {
  async loadStorefrontConfig(): Promise<StorefrontInfo> {
    return {
      state: "unconfigured",
      tenant: null,
      version: 0,
      brand: null,
      storefront: null,
    };
  },
};

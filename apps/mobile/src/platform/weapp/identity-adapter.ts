import type { IdentityAdapter } from "../contracts/identity";

/** 小程序开发暂缓：typed unsupported，不伪装成功。 */
export const identityAdapter: IdentityAdapter = {
  async login() {
    throw new Error("WECHAT_IDENTITY_NOT_CONFIGURED");
  },
  async refresh() {
    throw new Error("WECHAT_IDENTITY_NOT_CONFIGURED");
  },
  async logout() {
    throw new Error("WECHAT_IDENTITY_NOT_CONFIGURED");
  },
};

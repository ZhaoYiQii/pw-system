import type { ApiAdapter } from "../contracts/api-transport";

/** 小程序网络能力待真机 AppID/域名授权后落地；typed unsupported，不伪装成功。 */
export const apiAdapter: ApiAdapter = {
  async request(): Promise<never> {
    throw new Error("WECHAT_API_NOT_CONFIGURED");
  },
  async uploadBytes(): Promise<never> {
    throw new Error("WECHAT_API_NOT_CONFIGURED");
  },
};

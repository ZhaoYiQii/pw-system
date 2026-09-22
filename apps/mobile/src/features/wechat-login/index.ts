import { apiAdapter } from "@platform-api";
import { session } from "@platform-session";
import { apiBase } from "../../platform/h5/api-base";
import { wechatAuthorizeUrl } from "./callback";

export {
  isWechatBrowser,
  readWechatCallback,
  wechatAuthorizeUrl,
  withoutWechatParams,
  type WechatCallback,
} from "./callback";

/** 点「微信登录」：整页跳到授权入口（服务端会 302 到微信授权页）。 */
export function startWechatAuthorize(
  tenantCode: string,
  returnTo: string,
): void {
  const base = apiBase();
  if (!base) throw new Error("TARO_APP_API_BASE not configured");
  if (typeof location === "undefined") return;
  location.href = wechatAuthorizeUrl(base, tenantCode, returnTo);
}

/** 用 `code` + `state` 换会话；成功后把 accessToken / csrf 存进本地会话。 */
export async function completeWechatLogin(
  tenantCode: string,
  code: string,
  state: string,
): Promise<{ accessToken: string; returnTo: string }> {
  const data = await apiAdapter.request<{
    accessToken: string;
    csrfToken?: string;
    expiresInSeconds: number;
    returnTo?: string;
  }>("/api/v1/auth/wechat/login", {
    method: "POST",
    body: { tenantCode, code, state },
  });
  session.setToken(data.accessToken);
  if (data.csrfToken) session.setCsrf(data.csrfToken);
  return { accessToken: data.accessToken, returnTo: data.returnTo ?? "/" };
}

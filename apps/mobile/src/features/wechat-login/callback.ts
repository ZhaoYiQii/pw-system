/**
 * S3d：微信网页授权在 H5 侧的**纯逻辑**（不碰网络与存储，便于单测）。
 *
 * 官方口径（2026-09-23 查 https://developers.weixin.qq.com/doc/service/guide/h5/auth.html）：
 * - `state` 只能 a-zA-Z0-9、≤128 字节 —— 服务端按此生成（apps/api 的 wechat-state.ts）；
 * - `redirect_uri` 必须 urlEncode 且与公众号后台「网页授权域名」一致 —— 由**服务端**拼；
 * - 官方文档**没有**规定「微信内置浏览器」的判定方式，所以这里的 UA 嗅探**只用于按钮显隐**，
 *   不参与任何安全判断（登录结果一律由服务端校验 state + code 决定）。
 */

export interface WechatCallback {
  code: string;
  state: string;
}

export function isWechatBrowser(ua: string | undefined): boolean {
  return typeof ua === "string" && /MicroMessenger/i.test(ua);
}

/** 从 `location.search` 读回跳参数（redirect_uri 落在 H5 首页：`?wechat_login=1&code=..&state=..`）。 */
export function readWechatCallback(search: string): WechatCallback | null {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return null;
  return { code, state };
}

export function wechatAuthorizeUrl(
  apiBaseUrl: string,
  tenantCode: string,
  returnTo: string,
): string {
  const params = new URLSearchParams({ tenantCode, returnTo });
  return `${apiBaseUrl}/api/v1/auth/wechat/authorize?${params.toString()}`;
}

/**
 * 去掉地址栏里的 `code`/`state`/`wechat_login`。
 * 理由：code 只能用一次，留在地址栏里只会在前进/后退或刷新时得到「state 已被使用」的报错。
 */
export function withoutWechatParams(href: string): string {
  const url = new URL(href);
  for (const key of ["code", "state", "wechat_login"]) {
    url.searchParams.delete(key);
  }
  return url.toString();
}

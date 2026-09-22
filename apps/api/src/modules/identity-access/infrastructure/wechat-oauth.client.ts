/**
 * 微信公众平台「网页授权」（公众号内打开 H5 时拿 openid）。
 *
 * 与本仓库其它外部能力同一原则：**不引入微信 SDK**，REST + 内置 fetch，
 * 缺凭证在启动期就报错并点名变量（不静默降级）。
 *
 * 代码管不了、部署前必须人工确认的两件事（否则真实调用必然失败）：
 * 1. 公众号后台 `设置与开发 → 公众号设置 → 功能设置 → 网页授权域名` 必须填 **H5 的域名**，
 *    且与 `WECHAT_OAUTH_REDIRECT_URI` 的域名完全一致；
 * 2. 若公众号后台开了 IP 白名单，服务器公网 IP 必须在名单里（微信会回 40164）。
 *
 * 安全注意：微信要求 `appsecret` 放在**查询串**里（这是它的接口设计），
 * 所以任何错误信息与日志**都不能带上请求 URL**——否则密钥会漏进日志。见 `call()`。
 */

const REQUIRED_ENV = [
  "WECHAT_APP_ID",
  "WECHAT_APP_SECRET",
  "WECHAT_OAUTH_REDIRECT_URI",
] as const;

const AUTHORIZE_ENDPOINT =
  "https://open.weixin.qq.com/connect/oauth2/authorize";
const ACCESS_TOKEN_ENDPOINT =
  "https://api.weixin.qq.com/sns/oauth2/access_token";
/** 静默授权：只拿 openid，不弹用户确认页（拿昵称头像才需要 snsapi_userinfo）。 */
const SCOPE = "snsapi_base";
const REQUEST_TIMEOUT_MS = 5_000;

export interface WechatOauthConfig {
  appId: string;
  appSecret: string;
  /** H5 上的回跳地址，必须落在公众号后台配置的「网页授权域名」下。 */
  redirectUri: string;
}

export function resolveWechatOauthConfig(
  env: NodeJS.ProcessEnv = process.env,
): WechatOauthConfig {
  const missing = REQUIRED_ENV.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(
      `微信网页授权缺少必需环境变量：${missing.join(", ")}（见 docs/runbooks/env-inventory.md）`,
    );
  }
  const redirectUri = env.WECHAT_OAUTH_REDIRECT_URI as string;
  if (!/^https?:\/\//.test(redirectUri)) {
    throw new Error("WECHAT_OAUTH_REDIRECT_URI 必须是绝对地址（含协议）");
  }
  if (env.NODE_ENV === "production" && !redirectUri.startsWith("https://")) {
    throw new Error(
      "WECHAT_OAUTH_REDIRECT_URI 生产环境必须是 https（微信不接受 http 回调）",
    );
  }
  return {
    appId: env.WECHAT_APP_ID as string,
    appSecret: env.WECHAT_APP_SECRET as string,
    redirectUri,
  };
}

/** 拼「跳去微信授权」的地址；`state` 由 `wechat-state.ts` 签名生成。 */
export function buildWechatAuthorizeUrl(
  config: WechatOauthConfig,
  state: string,
): string {
  const params = new URLSearchParams({
    appid: config.appId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: SCOPE,
    state,
  });
  return `${AUTHORIZE_ENDPOINT}?${params.toString()}#wechat_redirect`;
}

export type WechatOauthFailureKind = "rate_limited" | "retryable" | "permanent";

/**
 * 错误码分类。只钉住**有明确语义的几个**，其余按永久处理（原始 errcode 一定进错误信息，
 * 分类错了也能在日志里看出来），不凭记忆枚举整个错误码表。
 * 判据来源：errcode 由微信返回，真实调用时以实际返回为准。
 */
export function classifyWechatErrcode(
  errcode: number | string,
): WechatOauthFailureKind {
  if (
    errcode === "NetworkError" ||
    errcode === "TimeoutError" ||
    errcode === "MalformedResponse"
  )
    return "retryable";
  if (errcode === 45011) return "rate_limited"; // API 分钟级频率限制
  if (errcode === -1) return "retryable"; // 微信侧系统繁忙
  return "permanent";
}

export class WechatOauthError extends Error {
  readonly kind: WechatOauthFailureKind;
  constructor(
    readonly code: number | string,
    message: string,
  ) {
    super(`微信网页授权失败 [${code}] ${message}`);
    this.name = "WechatOauthError";
    this.kind = classifyWechatErrcode(code);
  }
}

export interface WechatIdentity {
  openid: string;
  unionid?: string;
}

export type FetchLike = (
  url: string,
  init: { method: "GET"; signal?: AbortSignal },
) => Promise<{ json(): Promise<unknown> }>;

interface AccessTokenResponse {
  openid?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
}

export class WechatOauthClient {
  constructor(
    private readonly config: WechatOauthConfig,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
  ) {}

  /** `code` 换 `openid`（服务端持 AppSecret；浏览器只拿得到 code）。 */
  async exchangeCode(code: string): Promise<WechatIdentity> {
    if (!code) throw new WechatOauthError(41008, "code 为空");
    const params = new URLSearchParams({
      appid: this.config.appId,
      secret: this.config.appSecret,
      code,
      grant_type: "authorization_code",
    });
    const body = await this.call(
      `${ACCESS_TOKEN_ENDPOINT}?${params.toString()}`,
    );
    if (body.errcode) {
      throw new WechatOauthError(body.errcode, body.errmsg ?? "微信返回错误");
    }
    if (!body.openid) {
      throw new WechatOauthError(0, "微信返回体缺少 openid");
    }
    return {
      openid: body.openid,
      ...(body.unionid ? { unionid: body.unionid } : {}),
    };
  }

  /** 传输失败同样归一成 `WechatOauthError`；**错误信息里绝不带 URL**（URL 含 appsecret）。 */
  private async call(url: string): Promise<AccessTokenResponse> {
    let raw: { json(): Promise<unknown> };
    try {
      raw = await this.fetchImpl(url, {
        method: "GET",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      const code =
        name === "TimeoutError" || name === "AbortError"
          ? "TimeoutError"
          : "NetworkError";
      throw new WechatOauthError(
        code,
        this.redact(error instanceof Error ? error.message : String(error)),
      );
    }
    try {
      return (await raw.json()) as AccessTokenResponse;
    } catch {
      throw new WechatOauthError("MalformedResponse", "返回体不是合法 JSON");
    }
  }

  /**
   * 传输层错误信息来自 fetch/代理，**可能回显请求 URL**——而 URL 里带 appsecret。
   * 所以进错误信息前一律把密钥替换掉；宁可少一点诊断信息，也不能把密钥写进日志。
   */
  private redact(text: string): string {
    return text.split(this.config.appSecret).join("***");
  }
}

/** 日志/审计用：openid 只留首尾各 4 位。 */
export function maskOpenid(openid: string): string {
  if (openid.length <= 8) return "****";
  return `${openid.slice(0, 4)}****${openid.slice(-4)}`;
}

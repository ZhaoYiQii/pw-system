import { randomBytes } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";

/**
 * 微信授权跳转的 `state`（防伪造 / 防换租户 / 防开放重定向）。
 *
 * 用与访问令牌**同一套密钥但不同 audience** 签名的短期 JWT：
 * 拿 state 当访问令牌用（或反之）都会验签失败，不需要额外配置密钥。
 */

const ISSUER = "pw-saas-api";
const AUD = "pw-wechat-oauth-state";
export const WECHAT_STATE_TTL_SECONDS = 10 * 60;

export interface WechatStatePayload {
  tenantCode: string;
  /** H5 站内目标路径（已 sanitize）；登录成功后由前端跳转。 */
  returnTo: string;
}

export class WechatStateError extends Error {}

/**
 * `returnTo` 只接受**站内相对路径**，其余一律回退 `/`：
 * `//evil.com`（协议相对地址）、`https://evil.com`、含反斜杠或控制字符的都拒绝。
 * 这样即使前端传了脏值，也构不成开放重定向。
 */
export function sanitizeReturnTo(returnTo: unknown): string {
  if (typeof returnTo !== "string") return "/";
  const value = returnTo.trim();
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  if (value.includes("\\") || value.includes("://")) return "/";
  // 控制字符（含 \0）会让日志与跳转行为不可预测，直接拒；
  // 用逐字符判断而不是 /[\x00-\x1f]/ 正则（eslint no-control-regex 不允许在正则里写控制字符）。
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint < 0x20 || codePoint === 0x7f) return "/";
  }
  return value;
}

export class WechatStateService {
  private readonly key: Uint8Array;

  constructor(secret: string) {
    if (secret.length < 32) {
      throw new Error("SESSION_SECRET must be at least 32 characters");
    }
    this.key = new TextEncoder().encode(secret);
  }

  async sign(
    payload: { tenantCode: string; returnTo?: unknown },
    nowSeconds: number = Math.floor(Date.now() / 1000),
  ): Promise<string> {
    return new SignJWT({
      tenantCode: payload.tenantCode,
      returnTo: sanitizeReturnTo(payload.returnTo),
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(ISSUER)
      .setAudience(AUD)
      .setJti(randomBytes(12).toString("hex"))
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + WECHAT_STATE_TTL_SECONDS)
      .sign(this.key);
  }

  async verify(token: string): Promise<WechatStatePayload> {
    let raw: unknown;
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUD,
      });
      raw = payload;
    } catch (error) {
      throw new WechatStateError(
        `state 无效或已过期：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const claims = raw as { tenantCode?: unknown; returnTo?: unknown };
    if (typeof claims.tenantCode !== "string" || claims.tenantCode === "") {
      throw new WechatStateError("state 缺少 tenantCode");
    }
    return {
      tenantCode: claims.tenantCode,
      returnTo: sanitizeReturnTo(claims.returnTo),
    };
  }
}

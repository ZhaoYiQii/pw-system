import { createHash, randomBytes } from "node:crypto";

/**
 * 微信授权 `state` 的生成与校验。
 *
 * **为什么不是「签名 JWT 装 payload」**（2026-09-23 按官方文档修正）：
 * 微信《网页授权》参数表对 state 的要求是「填写 a-zA-Z0-9 的参数值，**最多 128 字节**」；
 * HS256 JWT 长度约 250+ 字符且含 `-`/`_`，不满足。改成业界常见的
 * 「**不透明随机 state + 服务端短期记录**」：state 只是 32 位十六进制随机串，
 * tenantCode / returnTo 存在 `wechat_login_states`（单次消费、10 分钟过期）。
 *
 * 来源：https://developers.weixin.qq.com/doc/service/guide/h5/auth.html（参数说明表）
 */

export const WECHAT_STATE_TTL_SECONDS = 10 * 60;
/** 16 字节 → 32 位十六进制，远低于 128 字节上限。 */
const STATE_BYTES = 16;

export class WechatStateError extends Error {}

export function createStateToken(): string {
  return randomBytes(STATE_BYTES).toString("hex");
}

/** 表里只存哈希：即使库被读走，也不能拿旧行重放登录。 */
export function hashStateToken(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

/** 微信要求 [a-zA-Z0-9] 且 ≤128 字节；脏值在**查库之前**就拒掉。 */
export function isValidStateToken(state: string): boolean {
  return /^[a-zA-Z0-9]{16,128}$/.test(state);
}

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

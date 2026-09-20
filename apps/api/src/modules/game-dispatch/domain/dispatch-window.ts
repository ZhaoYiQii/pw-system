/**
 * P3 / D4：报名窗口与「无人报名自动关单」窗口的单一配置源。
 *
 * 冲突背景：`publish` 与 `releaseSlot` 原先各自硬编码 10 分钟报名窗口，而关单窗口默认
 * 5 分钟——订单会在报名窗口还剩 5 分钟时被系统取消。这里把两者收敛成同一份配置：
 * 关单窗口默认跟随报名窗口（显式 `0` 仍表示关闭该规则）。
 */

/** 默认报名窗口：10 分钟（设计规格 §7）。 */
export const DEFAULT_ROUND_WINDOW_MS = 10 * 60 * 1000;
/** 允许范围：1–120 分钟；越界一律回退默认，并在启动日志告警。 */
export const MIN_ROUND_WINDOW_MS = 60 * 1000;
export const MAX_ROUND_WINDOW_MS = 120 * 60 * 1000;

type EnvLike = Record<string, string | undefined>;

/** 解析毫秒配置：空/非数字/NaN 一律视为「未配置」。 */
function parseMs(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return Math.trunc(value);
}

/** 报名窗口（毫秒）：缺省 10 分钟；非法或越界回退默认。 */
export function resolveRoundWindowMs(env: EnvLike = process.env): number {
  const parsed = parseMs(env.DISPATCH_ROUND_WINDOW_MS);
  if (
    parsed === null ||
    parsed < MIN_ROUND_WINDOW_MS ||
    parsed > MAX_ROUND_WINDOW_MS
  ) {
    return DEFAULT_ROUND_WINDOW_MS;
  }
  return parsed;
}

/**
 * 无人报名自动关单窗口（毫秒）：
 * - 未配置（或缺省、非法、负数）→ 跟随报名窗口（保证两个窗口口径一致）；
 * - 显式 `0` → 关闭该规则（沿用既有语义）；
 * - 显式正整数 → 覆盖。
 */
export function resolveNoApplicationTimeoutMs(
  env: EnvLike = process.env,
): number {
  const parsed = parseMs(env.DISPATCH_NO_APPLICATION_TIMEOUT_MS);
  if (parsed === 0) return 0;
  if (parsed === null || parsed < 0) return resolveRoundWindowMs(env);
  return parsed;
}

/** 启动日志用：原始配置存在但被回退时返回提示文本，否则返回 null。 */
export function roundWindowFallbackNotice(env: EnvLike = process.env): {
  variable: string;
  raw: string;
  effective: number;
} | null {
  const raw = env.DISPATCH_ROUND_WINDOW_MS;
  const parsed = parseMs(raw);
  const effective = resolveRoundWindowMs(env);
  if (raw === undefined || raw.trim() === "") return null;
  if (parsed !== null && parsed === effective) return null;
  return { variable: "DISPATCH_ROUND_WINDOW_MS", raw: raw ?? "", effective };
}

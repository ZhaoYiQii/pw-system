/**
 * P3 / D2：报单审批「申报时长 vs 证据计时」对照判定（设计规格 §5）。
 *
 * 纯展示逻辑：只决定是否提示客服重点核对，不参与结算、不写库、不发通知。
 * 阈值取「绝对 10 分钟」与「申报时长的 15%」中的较大者，避免长单被比例误判、
 * 短单被绝对阈值放过。
 */

/** 绝对阈值（分钟）：差值超过它才提示。 */
export const GAP_ABS_MINUTES = 10;
/** 比例阈值：差值超过申报时长的这个比例才提示。 */
export const GAP_RATIO = 0.15;

export interface DurationGap {
  /** 证据计时换算成分钟（保留小数，未舍入）。 */
  evidenceMinutes: number | null;
  /** 申报 - 证据（分钟，正数表示申报更长；保留小数）。 */
  deltaMinutes: number | null;
  /** `unknown` = 缺少申报或证据计时，界面只显示「证据计时缺失」。 */
  tone: "ok" | "warn" | "unknown";
}

/**
 * @param declaredMinutes 申报时长（分钟）；服务端校验范围 15–1440，非正数视为异常输入
 * @param durationSeconds 证据计时（秒）；未结束/无证据时为 null
 */
export function durationGap(
  declaredMinutes: number | null,
  durationSeconds: number | null,
): DurationGap {
  if (
    declaredMinutes === null ||
    !Number.isFinite(declaredMinutes) ||
    declaredMinutes <= 0 ||
    durationSeconds === null ||
    !Number.isFinite(durationSeconds)
  ) {
    return { evidenceMinutes: null, deltaMinutes: null, tone: "unknown" };
  }
  const evidenceMinutes = durationSeconds / 60;
  const deltaMinutes = declaredMinutes - evidenceMinutes;
  const threshold = Math.max(GAP_ABS_MINUTES, GAP_RATIO * declaredMinutes);
  return {
    evidenceMinutes,
    deltaMinutes,
    tone: Math.abs(deltaMinutes) > threshold ? "warn" : "ok",
  };
}

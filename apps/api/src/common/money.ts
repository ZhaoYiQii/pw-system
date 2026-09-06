/** MoneyFen：整数分。API/领域接口一律使用十进制字符串，避免 JS number 精度丢失（主规格 10.5/12.1、ADR-008）。 */
export type MoneyFen = string;

const NON_NEGATIVE_FEN = /^(?:0|[1-9][0-9]*)$/;

/**
 * 校验金额是否为规范十进制字符串分：
 * - 仅接受 string；number（含浮点）、负数、前导零与空串均拒绝；
 * - allowZero=false 用于售价类（>0）；allowZero=true 用于成本/预算类（>=0）。
 * 返回 null 表示非法；成功返回原串（无空白）。
 */
export function parseFenString(
  value: unknown,
  allowZero: boolean,
): string | null {
  if (typeof value !== "string") return null;
  if (value.trim() !== value || !NON_NEGATIVE_FEN.test(value)) return null;
  if (!allowZero && value === "0") return null;
  return value;
}

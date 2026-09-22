/**
 * S4-4：金额入参解析的**唯一口径**（下单与人工退款登记共用，避免两处规则漂移）。
 *
 * 仓库约定：金额一律整数分（MoneyFen）。所以这里：
 * - 接受十进制整数字符串或安全整数 number；
 * - **拒绝**小数（`"12.5"` / `12.5`）、负数、0、科学计数法（`"1e3"`）与超范围；
 * - 返回 `bigint`（> 0）或 `null`（非法，由调用方决定报什么错）。
 */
export function parseAmountFen(value: unknown): bigint | null {
  if (typeof value === "bigint") return value > 0n ? value : null;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? BigInt(value) : null;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value.trim())) {
    const parsed = BigInt(value.trim());
    return parsed > 0n ? parsed : null;
  }
  return null;
}

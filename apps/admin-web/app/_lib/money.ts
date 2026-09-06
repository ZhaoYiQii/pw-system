/** 分（十进制字符串）→ ¥元展示文本；仅用于展示，不做业务计算。 */
export function formatFenYuan(fen: string): string {
  if (!/^\d+$/.test(fen)) return "¥0.00";
  const padded = fen.padStart(3, "0");
  const whole = padded.slice(0, -2).replace(/^0+/, "") || "0";
  return `¥${whole}.${padded.slice(-2)}`;
}

/** 分（十进制字符串）求和 → 十进制字符串；仅用于展示合计。 */
export function sumFen(values: readonly string[]): string {
  return values.reduce(
    (acc, value) => (BigInt(acc) + BigInt(value)).toString(),
    "0",
  );
}

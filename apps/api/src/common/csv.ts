/**
 * DS-008：共享 CSV 编码（纯函数，无依赖、无 IO）。
 *
 * 支付台账与资金台账导出都必须经过这里，避免两套实现漂移：
 * 表格软件打开 CSV 时会**跳过前导空白与控制符**，再把 `=`/`+`/`-`/`@` 开头的单元格
 * 当公式执行（公式注入）。因此危险单元格在**整个原值**前加一个 ASCII 单引号 `'`，
 * 使表格软件按文本处理；之后再按 RFC 风格做引号转义。
 *
 * 除此之外不改动原值：不 trim、不删除字符、不转换大小写。
 */

/** 表格软件会当成公式起始的 ASCII 字符。 */
const FORMULA_PREFIXES = ["=", "+", "-", "@"];

/** Excel/LibreOffice 解析前会跳过的前导字符：ASCII 空白、C0 控制符与 DEL。 */
function isSkippableLeadingChar(code: number): boolean {
  return code <= 0x20 || code === 0x7f;
}

/** 是否存在「表格软件会执行成公式」的风险：危险前缀可能在若干前导空白/控制符之后。 */
function hasFormulaRisk(value: string): boolean {
  const first = value.charAt(0);
  if (first === "\t" || first === "\r" || first === "\n") return true;
  let index = 0;
  while (
    index < value.length &&
    isSkippableLeadingChar(value.charCodeAt(index))
  ) {
    index += 1;
  }
  return FORMULA_PREFIXES.includes(value.charAt(index));
}

/**
 * 单元格编码：先公式注入防护（危险时整体前置 `'`），再做 CSV 引号转义
 * （含逗号、双引号、回车或换行时用双引号包裹，内部双引号翻倍）。
 */
export function escapeCsvCell(value: string): string {
  const guarded = hasFormulaRisk(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded)
    ? `"${guarded.replaceAll('"', '""')}"`
    : guarded;
}

/**
 * 整表编码：UTF-8 BOM + 每格 `escapeCsvCell` + 逗号分隔 + CRLF 行尾，末行后保留一个 CRLF。
 * BOM 让 Excel 按 UTF-8 打开（否则中文表头乱码）。
 */
export function toUtf8BomCsv(rows: readonly (readonly string[])[]): string {
  const lines = rows.map((cells) => cells.map(escapeCsvCell).join(","));
  // BOM 用 `\uFEFF` 转义写出：字面量控制字符会让源文件在 diff/grep 中失真。
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

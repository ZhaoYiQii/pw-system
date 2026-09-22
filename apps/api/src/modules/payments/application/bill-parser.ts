/**
 * S4-3a：微信支付**交易账单**解析（纯函数，便于单测）。
 *
 * 官方格式（`/doc/v3/partner/4013080599.md`）：
 * - 文件内每个字段用**英文逗号**分隔，且**每个字段前有一个反引号 ``` ` ```**；
 * - 先"明细数据"（含表头行），再"汇总数据"（表头 + 一行数值）；
 * - 金额字段单位是**元、保留两位小数**（如 `8.88`）→ 必须用字符串运算换算成分，不能用浮点乘 100；
 * - 与本地对账直接相关的列：`微信订单号`、`商户订单号`、`交易状态`、`订单金额`、`应结订单金额`、`退款金额`、`手续费`；
 * - 官方提示「少部分商户账单停留在早期版本：没有"应结订单金额"（早期叫"总金额"）、没有"代金券金额"（早期叫"企业红包金额"）」，
 *   所以这里**按表头名取列**并兼容旧名，而不是写死列序号。
 */

export interface BillRow {
  tradeTime: string;
  appId: string;
  mchid: string;
  subMchid: string;
  transactionId: string;
  outTradeNo: string;
  tradeType: string;
  tradeState: string;
  /** 订单金额（元 → 分）；退款行官方填 0.00。 */
  totalAmountFen: bigint;
  /** 应结订单金额（元 → 分）；旧版账单里对应"总金额"。 */
  settleAmountFen: bigint;
  /** 退款金额（元 → 分）；订单行为 0.00。 */
  refundAmountFen: bigint;
  feeFen: bigint;
  refundId: string;
}

export interface BillSummary {
  totalCount: number;
  settleTotalFen: bigint;
  refundTotalFen: bigint;
  feeTotalFen: bigint;
  orderTotalFen: bigint;
}

export interface ParsedTradeBill {
  rows: BillRow[];
  summary: BillSummary;
}

/** 「元」字符串 → 「分」。整数分：`8.88` → 888n；拒绝非法/超过两位小数。 */
export function yuanToFen(value: string): bigint {
  const trimmed = value.trim().replace(/^`/, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new Error(`账单金额格式非法：${value}`);
  }
  const negative = trimmed.startsWith("-");
  const digits = negative ? trimmed.slice(1) : trimmed;
  const parts = digits.split(".");
  const whole = parts[0] ?? "0";
  const fraction = parts[1] ?? "";
  const fen = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return negative ? -fen : fen;
}

/** 一行 → 字段数组：先去掉 UTF-8 BOM，再按 `,` 拆、去掉每个字段前的反引号。 */
function splitBillLine(line: string): string[] {
  const normalized = line.replace(/^\uFEFF/, "");
  return normalized.split(",").map((field) => field.replace(/^`/, "").trim());
}

/** 表头名 → 列序号；兼容官方提到的旧版字段名。 */
function indexOfColumn(
  header: string[],
  names: string[],
  required = true,
): number {
  for (const name of names) {
    const index = header.indexOf(name);
    if (index >= 0) return index;
  }
  if (required) {
    throw new Error(
      `账单表头缺少列：${names.join(" / ")}（实际表头：${header.join(",")}）`,
    );
  }
  return -1;
}

function cell(fields: string[], index: number): string {
  if (index < 0) return "";
  return fields[index] ?? "";
}

export function parseTradeBill(text: string): ParsedTradeBill {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) throw new Error("账单文件为空");

  const headerLine = lines[0]!.replace(/^\uFEFF/, "");
  const header = splitBillLine(headerLine);
  if (!header.includes("商户订单号")) {
    throw new Error(
      `账单表头不符合预期（缺少"商户订单号"）：${headerLine.slice(0, 80)}`,
    );
  }
  const columns = {
    tradeTime: indexOfColumn(header, ["交易时间"]),
    appId: indexOfColumn(header, ["公众账号ID"], false),
    mchid: indexOfColumn(header, ["商户号"], false),
    subMchid: indexOfColumn(header, ["特约商户号"], false),
    transactionId: indexOfColumn(header, ["微信订单号"], false),
    outTradeNo: indexOfColumn(header, ["商户订单号"]),
    tradeType: indexOfColumn(header, ["交易类型"], false),
    tradeState: indexOfColumn(header, ["交易状态"]),
    totalAmount: indexOfColumn(header, ["订单金额"], false),
    // 官方：新版叫「应结订单金额」，早期叫「总金额」
    settleAmount: indexOfColumn(header, ["应结订单金额", "总金额"]),
    refundAmount: indexOfColumn(header, ["退款金额"], false),
    fee: indexOfColumn(header, ["手续费"], false),
    refundId: indexOfColumn(header, ["微信退款单号"], false),
  };

  const rows: BillRow[] = [];
  let summary: BillSummary | null = null;
  for (let i = 1; i < lines.length; i += 1) {
    const fields = splitBillLine(lines[i]!);
    if (fields[0] === "总交易单数") {
      const values = splitBillLine(lines[i + 1] ?? "");
      if (values.length < 3) {
        throw new Error(`账单汇总行缺失（第 ${i + 2} 行）`);
      }
      const summaryHeader = fields;
      const pick = (names: string[], fallbackIndex: number): string => {
        const index = summaryHeader.indexOf(names[0]!);
        const at = index >= 0 ? index : fallbackIndex;
        return values[at] ?? "0";
      };
      summary = {
        totalCount: Number(pick(["总交易单数"], 0)),
        settleTotalFen: yuanToFen(pick(["应结订单总金额"], 1)),
        refundTotalFen: yuanToFen(pick(["退款总金额"], 2)),
        feeTotalFen: yuanToFen(pick(["手续费总金额"], 4)),
        orderTotalFen: yuanToFen(pick(["订单总金额"], 5)),
      };
      break;
    }
    if (fields[0] === "交易时间") {
      // 少数账单会在类型切换处重复表头，跳过
      continue;
    }
    const outTradeNo = cell(fields, columns.outTradeNo);
    if (!outTradeNo) {
      throw new Error(`账单第 ${i + 1} 行缺少商户订单号`);
    }
    rows.push({
      tradeTime: cell(fields, columns.tradeTime),
      appId: cell(fields, columns.appId),
      mchid: cell(fields, columns.mchid),
      subMchid: cell(fields, columns.subMchid),
      transactionId: cell(fields, columns.transactionId),
      outTradeNo,
      tradeType: cell(fields, columns.tradeType),
      tradeState: cell(fields, columns.tradeState),
      totalAmountFen: yuanToFen(cell(fields, columns.totalAmount) || "0"),
      settleAmountFen: yuanToFen(cell(fields, columns.settleAmount) || "0"),
      refundAmountFen: yuanToFen(cell(fields, columns.refundAmount) || "0"),
      feeFen: yuanToFen(cell(fields, columns.fee) || "0"),
      refundId: cell(fields, columns.refundId),
    });
  }
  if (!summary) throw new Error("账单缺少汇总行（总交易单数）");
  return { rows, summary };
}

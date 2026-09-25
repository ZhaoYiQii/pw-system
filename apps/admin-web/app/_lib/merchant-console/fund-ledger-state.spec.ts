import { describe, expect, it } from "vitest";
import {
  balancedLabel,
  commitFundLedgerFilters,
  DEFAULT_FUND_LEDGER_FILTERS,
  eventTypeLabel,
  formatLedgerFen,
  fundFlowLabel,
  ledgerDifferenceFen,
  pickActiveLedgerRow,
  reconciliationStatusLabel,
  toFundLedgerExportQuery,
  toFundLedgerListQuery,
  transactionStatusLabel,
  visibleLedgerRows,
  type FundLedgerCommittedFilters,
  type FundLedgerDraftFilters,
  type FundLedgerFilterErrors,
} from "./fund-ledger-state";

const localMidnightIso = (year: number, month: number, day: number): string =>
  new Date(year, month - 1, day).toISOString();

const draft = (
  patch: Partial<FundLedgerDraftFilters>,
): FundLedgerDraftFilters => ({ ...DEFAULT_FUND_LEDGER_FILTERS, ...patch });

function committed(
  patch: Partial<FundLedgerDraftFilters>,
): FundLedgerCommittedFilters {
  const result = commitFundLedgerFilters(draft(patch));
  if (!result.ok) {
    throw new Error(
      `期望通过校验，实际字段错误：${JSON.stringify(result.errors)}`,
    );
  }
  return result.filters;
}

function errorsOf(
  patch: Partial<FundLedgerDraftFilters>,
): FundLedgerFilterErrors {
  const result = commitFundLedgerFilters(draft(patch));
  if (result.ok) throw new Error("期望校验失败，实际全部通过");
  return result.errors;
}

function errorOf(
  patch: Partial<FundLedgerDraftFilters>,
  field: keyof FundLedgerDraftFilters,
): string {
  const errors = errorsOf(patch);
  const message = errors[field];
  if (!message) {
    throw new Error(`期望字段 ${field} 报错，实际：${JSON.stringify(errors)}`);
  }
  return message;
}

/** 行选择规则只依赖这两个字段；与视图传入的完整 `FundLedgerRow` 结构兼容。 */
interface SelectableRow {
  transactionId: string;
  balanced: boolean;
}

describe("fund-ledger 展示映射", () => {
  it("固定七种事件类型的中文映射", () => {
    expect(eventTypeLabel("ORDER_ACCOUNTING")).toBe("订单核算");
    expect(eventTypeLabel("PAYMENT_CONFIRMED")).toBe("支付确认");
    expect(eventTypeLabel("WALLET_CONSUMED")).toBe("钱包消费");
    expect(eventTypeLabel("REFUND_CONFIRMED")).toBe("退款确认");
    expect(eventTypeLabel("PLAYER_PAYOUT_CONFIRMED")).toBe("陪玩实付确认");
    expect(eventTypeLabel("RECONCILIATION_ADJUSTMENT")).toBe("对账调整");
    expect(eventTypeLabel("REVERSAL")).toBe("冲销");
  });

  it("固定四种交易状态与两种对账状态的中文映射", () => {
    expect(transactionStatusLabel("DRAFT")).toBe("草稿");
    expect(transactionStatusLabel("CONFIRMED")).toBe("已确认");
    expect(transactionStatusLabel("RECONCILED")).toBe("已对账");
    expect(transactionStatusLabel("REVERSED")).toBe("已冲销");
    expect(reconciliationStatusLabel("RECONCILED")).toBe("已对账");
    expect(reconciliationStatusLabel("UNRECONCILED")).toBe("未对账");
  });

  it("固定四种资金流向，null 显示 —", () => {
    expect(fundFlowLabel("DEBIT")).toBe("流入");
    expect(fundFlowLabel("CREDIT")).toBe("流出");
    expect(fundFlowLabel("MIXED")).toBe("混合");
    expect(fundFlowLabel(null)).toBe("—");
    expect(fundFlowLabel(undefined)).toBe("—");
  });

  it("借贷平衡状态独立于交易状态", () => {
    expect(balancedLabel(true)).toBe("平衡");
    expect(balancedLabel(false)).toBe("借贷不平");
  });

  it("未知枚举回退原始值，绝不伪装成已知中文状态", () => {
    expect(eventTypeLabel("LEDGER_EVENT_UNKNOWN")).toBe("LEDGER_EVENT_UNKNOWN");
    expect(transactionStatusLabel("PENDING")).toBe("PENDING");
    expect(reconciliationStatusLabel("PARTIAL")).toBe("PARTIAL");
    expect(fundFlowLabel("BOTH_WAYS")).toBe("BOTH_WAYS");
    expect(eventTypeLabel(null)).toBe("—");
  });
});

describe("fund-ledger 金额口径", () => {
  it("元转分使用 BigInt，精确到分", () => {
    const filters = committed({ minAmountYuan: "12.34", maxAmountYuan: "100" });
    expect(filters.minAmountFen).toBe("1234");
    expect(filters.maxAmountFen).toBe("10000");
  });

  it("元转分支持超过 Number.MAX_SAFE_INTEGER 的分金额", () => {
    const filters = committed({ minAmountYuan: "90071992547409.92" });
    expect(filters.minAmountFen).toBe("9007199254740992");
    expect(BigInt(filters.minAmountFen ?? "0")).toBe(9007199254740992n);

    const huge = committed({ maxAmountYuan: "900719925474099199.99" });
    const fen = huge.maxAmountFen ?? "";
    expect(fen).toBe("90071992547409919999");
    // 证明该用例确实越过 IEEE754 安全整数：任何 Number 路径都会在这里走样。
    expect(String(Number(fen))).not.toBe(fen);
  });

  it("负数、三位小数、非数字金额被拒绝", () => {
    expect(errorOf({ minAmountYuan: "-1" }, "minAmountYuan")).toMatch(/金额/);
    expect(errorOf({ minAmountYuan: "1.234" }, "minAmountYuan")).toMatch(
      /金额/,
    );
    expect(errorOf({ maxAmountYuan: "abc" }, "maxAmountYuan")).toMatch(/金额/);
    expect(errorOf({ maxAmountYuan: "1.2.3" }, "maxAmountYuan")).toMatch(
      /金额/,
    );
  });

  it("最高金额小于最低金额时拒绝", () => {
    expect(
      errorOf(
        { minAmountYuan: "100", maxAmountYuan: "99.99" },
        "maxAmountYuan",
      ),
    ).toMatch(/金额/);
  });

  it("金额留空不产生筛选条件", () => {
    const filters = committed({ minAmountYuan: "  ", maxAmountYuan: "" });
    expect(filters.minAmountFen).toBeUndefined();
    expect(filters.maxAmountFen).toBeUndefined();
  });
});

describe("fund-ledger 自然日范围", () => {
  it("开始日转本地 00:00 下界，结束日转次日 00:00 不含上界", () => {
    const filters = committed({
      occurredFrom: "2026-09-01",
      occurredTo: "2026-09-25",
    });
    expect(filters.occurredFrom).toBe(localMidnightIso(2026, 9, 1));
    expect(filters.occurredTo).toBe(localMidnightIso(2026, 9, 26));
  });

  it("同一天的范围覆盖到次日 00:00", () => {
    const filters = committed({
      occurredFrom: "2026-09-25",
      occurredTo: "2026-09-25",
    });
    expect(filters.occurredFrom).toBe(localMidnightIso(2026, 9, 25));
    expect(filters.occurredTo).toBe(localMidnightIso(2026, 9, 26));
  });

  it("跨月与跨年的结束日按次日推进", () => {
    expect(committed({ occurredTo: "2026-12-31" }).occurredTo).toBe(
      localMidnightIso(2027, 1, 1),
    );
    const monthEnd = committed({
      occurredFrom: "2026-02-28",
      occurredTo: "2026-02-28",
    });
    expect(monthEnd.occurredTo).toBe(localMidnightIso(2026, 3, 1));
  });

  it("结束日早于开始日被拒绝", () => {
    expect(
      errorOf(
        { occurredFrom: "2026-09-25", occurredTo: "2026-09-24" },
        "occurredTo",
      ),
    ).toMatch(/结束/);
  });

  it("非法日期被拒绝", () => {
    expect(errorOf({ occurredFrom: "2026-02-30" }, "occurredFrom")).toMatch(
      /日期/,
    );
    expect(errorOf({ occurredTo: "09/25/2026" }, "occurredTo")).toMatch(/日期/);
  });

  it("只填一侧日期时另一侧不发送", () => {
    const filters = committed({ occurredFrom: "2026-09-01" });
    expect(filters.occurredFrom).toBe(localMidnightIso(2026, 9, 1));
    expect(filters.occurredTo).toBeUndefined();
  });
});

describe("fund-ledger 文本与 UUID 校验", () => {
  it("sourceType trim 后 1–64 字符，空值不发送", () => {
    expect(committed({ sourceType: "  order  " }).sourceType).toBe("order");
    expect(committed({ sourceType: "   " }).sourceType).toBeUndefined();
    expect(committed({ sourceType: "x".repeat(64) }).sourceType).toHaveLength(
      64,
    );
    expect(errorOf({ sourceType: "x".repeat(65) }, "sourceType")).toMatch(/64/);
  });

  it("关键词 trim 后最多 50 字符，空值不发送", () => {
    expect(committed({ q: "  TX-2026  " }).q).toBe("TX-2026");
    expect(committed({ q: "" }).q).toBeUndefined();
    expect(committed({ q: "x".repeat(50) }).q).toHaveLength(50);
    expect(errorOf({ q: "x".repeat(51) }, "q")).toMatch(/50/);
  });

  it("fundAccountId 非空时必须是 UUID", () => {
    const uuid = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    expect(committed({ fundAccountId: `  ${uuid}  ` }).fundAccountId).toBe(
      uuid,
    );
    expect(committed({ fundAccountId: "" }).fundAccountId).toBeUndefined();
    expect(errorOf({ fundAccountId: "not-a-uuid" }, "fundAccountId")).toMatch(
      /UUID/,
    );
    expect(
      errorOf(
        { fundAccountId: "3f2504e0-4f89-41d3-9a0c-0305e82c330" },
        "fundAccountId",
      ),
    ).toMatch(/UUID/);
  });
});

describe("fund-ledger 请求参数构造", () => {
  it("事件、状态、排序只接受契约枚举", () => {
    expect(errorOf({ eventType: "NOT_AN_EVENT" }, "eventType")).toMatch(/事件/);
    expect(errorOf({ status: "PAID" }, "status")).toMatch(/交易状态/);
    expect(errorOf({ sortBy: "id" }, "sortBy")).toMatch(/排序/);
    expect(errorOf({ sortDir: "up" }, "sortDir")).toMatch(/排序/);

    const filters = committed({
      eventType: "REVERSAL",
      status: "REVERSED",
      sortBy: "amountFen",
      sortDir: "asc",
    });
    expect(filters.eventType).toBe("REVERSAL");
    expect(filters.status).toBe("REVERSED");
    expect(filters.sortBy).toBe("amountFen");
    expect(filters.sortDir).toBe("asc");
  });

  it("空筛选不发送空字符串，只带排序与分页", () => {
    const query = toFundLedgerListQuery(committed({}), 1, 50);
    expect(query).toEqual({
      sortBy: "occurredAt",
      sortDir: "desc",
      page: 1,
      pageSize: 50,
    });
    expect(Object.values(query).every((value) => value !== "")).toBe(true);
  });

  it("列表 query 携带分页，导出 query 不携带分页", () => {
    const filters = committed({
      eventType: "REFUND_CONFIRMED",
      occurredFrom: "2026-09-01",
      occurredTo: "2026-09-25",
      q: "TX-2026",
      sourceType: "order",
    });

    const listQuery = toFundLedgerListQuery(filters, 3, 50);
    expect(listQuery.page).toBe(3);
    expect(listQuery.pageSize).toBe(50);
    expect(listQuery.eventType).toBe("REFUND_CONFIRMED");
    expect(listQuery.occurredFrom).toBe(localMidnightIso(2026, 9, 1));
    expect(listQuery.occurredTo).toBe(localMidnightIso(2026, 9, 26));

    const exportQuery = toFundLedgerExportQuery(filters);
    expect(Object.keys(exportQuery)).not.toContain("page");
    expect(Object.keys(exportQuery)).not.toContain("pageSize");
    expect(Object.keys(exportQuery).sort()).toEqual([
      "eventType",
      "occurredFrom",
      "occurredTo",
      "q",
      "sortBy",
      "sortDir",
      "sourceType",
    ]);
    expect(exportQuery).toEqual({
      eventType: listQuery.eventType,
      occurredFrom: listQuery.occurredFrom,
      occurredTo: listQuery.occurredTo,
      q: listQuery.q,
      sourceType: listQuery.sourceType,
      sortBy: listQuery.sortBy,
      sortDir: listQuery.sortDir,
    });
  });

  it("金额分以十进制字符串进入 query", () => {
    const filters = committed({
      minAmountYuan: "0.05",
      maxAmountYuan: "900719925474099199.99",
    });
    const exportQuery = toFundLedgerExportQuery(filters);
    expect(exportQuery.minAmountFen).toBe("5");
    expect(exportQuery.maxAmountFen).toBe("90071992547409919999");
  });
});

describe("fund-ledger 借贷差额", () => {
  it("取绝对差额，平衡时为 0", () => {
    expect(ledgerDifferenceFen("36800", "36800")).toBe("0");
    expect(ledgerDifferenceFen("500", "300")).toBe("200");
    expect(ledgerDifferenceFen("300", "500")).toBe("200");
    expect(ledgerDifferenceFen("0", "0")).toBe("0");
  });

  it("超过 Number.MAX_SAFE_INTEGER 的分金额不丢精度", () => {
    const debit = "90071992547409919999";
    const credit = "90071992547409919000";
    expect(String(Number(debit))).not.toBe(debit);
    expect(ledgerDifferenceFen(debit, credit)).toBe("999");
    expect(ledgerDifferenceFen(debit, "0")).toBe(debit);
  });

  it("非法分字符串按 0 处理，不抛出也不返回 NaN", () => {
    expect(ledgerDifferenceFen("abc", "100")).toBe("100");
    expect(ledgerDifferenceFen("", "")).toBe("0");
  });
});

describe("fund-ledger 金额格式化", () => {
  it("分转元，固定两位小数", () => {
    expect(formatLedgerFen("36800")).toBe("¥368.00");
    expect(formatLedgerFen("0")).toBe("¥0.00");
    expect(formatLedgerFen("5")).toBe("¥0.05");
    expect(formatLedgerFen("90071992547409919999")).toBe(
      "¥900719925474099199.99",
    );
  });
});

describe("fund-ledger 行选择规则（仅当前页异常）", () => {
  const balancedRow: SelectableRow = {
    transactionId: "tx-balanced",
    balanced: true,
  };
  const abnormalFirst: SelectableRow = {
    transactionId: "tx-abnormal-1",
    balanced: false,
  };
  const abnormalSecond: SelectableRow = {
    transactionId: "tx-abnormal-2",
    balanced: false,
  };
  /** 第一行是平衡交易，后两行借贷不平，模拟"选中行被筛选隐藏"的当前页。 */
  const page: readonly SelectableRow[] = [
    balancedRow,
    abnormalFirst,
    abnormalSecond,
  ];
  /** 与视图同一条链路：先算可见行，再选活动行。 */
  const activeRowOf = (
    rows: readonly SelectableRow[],
    onlyAbnormal: boolean,
    selectedId: string | null,
  ): SelectableRow | null =>
    pickActiveLedgerRow(visibleLedgerRows(rows, onlyAbnormal), selectedId);

  it("已选中的平衡行被异常筛选隐藏后，改选第一条异常行", () => {
    const visible = visibleLedgerRows(page, true);
    expect(visible.map((row) => row.transactionId)).toEqual([
      "tx-abnormal-1",
      "tx-abnormal-2",
    ]);
    expect(
      activeRowOf(page, true, balancedRow.transactionId)?.transactionId,
    ).toBe("tx-abnormal-1");
  });

  it("已选中的异常行仍在可见集合内时保持不变", () => {
    expect(
      activeRowOf(page, true, abnormalSecond.transactionId)?.transactionId,
    ).toBe("tx-abnormal-2");
  });

  it("没有选中行时自动选择第一条异常行", () => {
    expect(activeRowOf(page, true, null)?.transactionId).toBe("tx-abnormal-1");
    expect(activeRowOf(page, true, "tx-not-on-this-page")?.balanced).toBe(
      false,
    );
  });

  it("当前页没有异常行时返回 null，证据链不指向被隐藏的平衡交易", () => {
    const allBalanced: readonly SelectableRow[] = [
      balancedRow,
      { transactionId: "tx-balanced-2", balanced: true },
    ];
    const visible = visibleLedgerRows(allBalanced, true);
    expect(visible).toHaveLength(0);
    expect(pickActiveLedgerRow(visible, balancedRow.transactionId)).toBeNull();
    expect(pickActiveLedgerRow(visible, null)).toBeNull();
    expect(
      activeRowOf(allBalanced, true, balancedRow.transactionId),
    ).toBeNull();
  });

  it("关闭异常筛选后使用完整 rows，并恢复原选中行", () => {
    const visible = visibleLedgerRows(page, false);
    expect(visible).toEqual(page);
    expect(visible).toHaveLength(3);
    // 不筛选时返回独立数组，调用方无法通过它改到入参。
    expect(visible).not.toBe(page);
    expect(
      activeRowOf(page, false, balancedRow.transactionId)?.transactionId,
    ).toBe("tx-balanced");
    expect(activeRowOf(page, false, balancedRow.transactionId)?.balanced).toBe(
      true,
    );
  });
});

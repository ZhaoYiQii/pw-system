/**
 * DS-009：统一资金台账的筛选口径、展示映射与请求参数纯函数（供组件与单测共用）。
 *
 * 约定：
 * - 类型只从生成客户端 `@pw/api-client` 派生，不手写会与 OpenAPI 漂移的重复 DTO；
 * - 日期 UI 是自然日：开始日 → 本地 00:00 的 ISO 下界；结束日 → **次日**本地 00:00
 *   的 ISO 不含上界（与后端 `occurredTo` 不含边界契约一致）；
 * - 金额一律十进制字符串分：元转分复用 `yuanToFenString`，格式化复用 `formatFenYuan`，
 *   差额直接走 BigInt，任何路径都不经过 JavaScript `number`；
 * - `eventType` / `status` / `sortBy` / `sortDir` 只接受契约枚举；展示层未知值回退原始值，
 *   绝不伪装成某个已知中文状态。
 */
import type {
  TenantFundLedgerExportCsvData,
  TenantFundLedgerListData,
  TenantFundLedgerListResponse,
} from "@pw/api-client";
import { formatFenYuan, yuanToFenString } from "../money";

/** 列表 query（生成契约）。 */
export type FundLedgerListQuery = NonNullable<
  TenantFundLedgerListData["query"]
>;
/** 导出 query（生成契约；类型上不含 `page` / `pageSize`）。 */
export type FundLedgerExportQuery = NonNullable<
  TenantFundLedgerExportCsvData["query"]
>;
/** 列表响应中的单行交易。 */
export type FundLedgerRow =
  TenantFundLedgerListResponse["data"]["rows"][number];

export type FundLedgerEventType = NonNullable<FundLedgerListQuery["eventType"]>;
export type FundLedgerTransactionStatus = NonNullable<
  FundLedgerListQuery["status"]
>;
export type FundLedgerSortField = NonNullable<FundLedgerListQuery["sortBy"]>;
export type FundLedgerSortDir = NonNullable<FundLedgerListQuery["sortDir"]>;
export type FundLedgerReconciliationStatus =
  FundLedgerRow["reconciliationStatus"];
export type FundLedgerFundFlowDirection = FundLedgerRow["fundFlowDirection"];

/** 契约枚举值列表（渲染筛选下拉与校验用；`satisfies` 保证与生成类型不漂移）。 */
export const FUND_LEDGER_EVENT_TYPES = [
  "ORDER_ACCOUNTING",
  "PAYMENT_CONFIRMED",
  "WALLET_CONSUMED",
  "REFUND_CONFIRMED",
  "PLAYER_PAYOUT_CONFIRMED",
  "RECONCILIATION_ADJUSTMENT",
  "REVERSAL",
] as const satisfies readonly FundLedgerEventType[];

export const FUND_LEDGER_TRANSACTION_STATUSES = [
  "DRAFT",
  "CONFIRMED",
  "RECONCILED",
  "REVERSED",
] as const satisfies readonly FundLedgerTransactionStatus[];

export const FUND_LEDGER_SORT_FIELDS = [
  "occurredAt",
  "confirmedAt",
  "createdAt",
  "amountFen",
  "txNo",
] as const satisfies readonly FundLedgerSortField[];

export const FUND_LEDGER_SORT_DIRECTIONS = [
  "desc",
  "asc",
] as const satisfies readonly FundLedgerSortDir[];

/** 空值统一展示字符；不隐藏字段后伪装成完整信息。 */
export const FUND_LEDGER_EMPTY_TEXT = "—";

/** 列表默认页大小（契约 1–200，默认 50）。 */
export const FUND_LEDGER_PAGE_SIZE = 50;

/** 来源类型 trim 后长度上限（契约 1–64）。 */
const MAX_SOURCE_TYPE_LENGTH = 64;
/** 关键词 trim 后长度上限（契约 ≤50）。 */
const MAX_KEYWORD_LENGTH = 50;

const DAY_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FEN_ONLY = /^\d+$/;

const EVENT_TYPE_LABELS: Record<FundLedgerEventType, string> = {
  ORDER_ACCOUNTING: "订单核算",
  PAYMENT_CONFIRMED: "支付确认",
  WALLET_CONSUMED: "钱包消费",
  REFUND_CONFIRMED: "退款确认",
  PLAYER_PAYOUT_CONFIRMED: "陪玩实付确认",
  RECONCILIATION_ADJUSTMENT: "对账调整",
  REVERSAL: "冲销",
};

const TRANSACTION_STATUS_LABELS: Record<FundLedgerTransactionStatus, string> = {
  DRAFT: "草稿",
  CONFIRMED: "已确认",
  RECONCILED: "已对账",
  REVERSED: "已冲销",
};

const RECONCILIATION_STATUS_LABELS: Record<
  FundLedgerReconciliationStatus,
  string
> = {
  RECONCILED: "已对账",
  UNRECONCILED: "未对账",
};

const FUND_FLOW_LABELS: Record<FundLedgerFundFlowDirection, string> = {
  DEBIT: "流入",
  CREDIT: "流出",
  MIXED: "混合",
};

/** 草稿筛选：全部是表单字符串，空串表示不筛选。 */
export interface FundLedgerDraftFilters {
  /** YYYY-MM-DD（自然日）。 */
  occurredFrom: string;
  /** YYYY-MM-DD（自然日，按次日 00:00 不含上界提交）。 */
  occurredTo: string;
  /** 契约枚举或空串。 */
  eventType: string;
  /** 契约枚举或空串。 */
  status: string;
  /** 关键词，trim 后 ≤50。 */
  q: string;
  /** 元；空串表示不筛选。 */
  minAmountYuan: string;
  /** 元；空串表示不筛选。 */
  maxAmountYuan: string;
  /** 来源类型，trim 后 1–64。 */
  sourceType: string;
  /** 资金账户 UUID，可空。 */
  fundAccountId: string;
  /** 契约枚举。 */
  sortBy: string;
  /** 契约枚举。 */
  sortDir: string;
}

/** 已提交筛选：已校验、已转成 API 口径；缺席即“不发送该条件”。 */
export interface FundLedgerCommittedFilters {
  occurredFrom?: string;
  occurredTo?: string;
  eventType?: FundLedgerEventType;
  status?: FundLedgerTransactionStatus;
  q?: string;
  minAmountFen?: string;
  maxAmountFen?: string;
  sourceType?: string;
  fundAccountId?: string;
  sortBy: FundLedgerSortField;
  sortDir: FundLedgerSortDir;
}

/** 字段级错误：键为草稿字段名，值为可直接展示的中文消息。 */
export type FundLedgerFilterErrors = Partial<
  Record<keyof FundLedgerDraftFilters, string>
>;

export type CommitFundLedgerFiltersResult =
  | { ok: true; filters: FundLedgerCommittedFilters }
  | { ok: false; errors: FundLedgerFilterErrors };

export const DEFAULT_FUND_LEDGER_FILTERS: FundLedgerDraftFilters = {
  occurredFrom: "",
  occurredTo: "",
  eventType: "",
  status: "",
  q: "",
  minAmountYuan: "",
  maxAmountYuan: "",
  sourceType: "",
  fundAccountId: "",
  sortBy: "occurredAt",
  sortDir: "desc",
};

function isOneOf<T extends string>(
  values: readonly T[],
  value: string,
): value is T {
  return (values as readonly string[]).includes(value);
}

/**
 * 取契约枚举值；不在枚举内时返回 `fallback`。
 * 调用方用“原值 !== 结果”判定非法，因此非法值不会被静默接受。
 */
function commitEnum<T extends string>(
  values: readonly T[],
  value: string,
  fallback: T,
): T {
  return isOneOf(values, value) ? value : fallback;
}

/** 十进制字符串分 → BigInt；非法输入按 0 处理（与 `formatFenYuan` 的容错一致）。 */
function toFenBigInt(fen: string): bigint {
  return FEN_ONLY.test(fen) ? BigInt(fen) : 0n;
}

/** 自然日 → 本地 00:00 的 Date；非法格式或不存在的日期（如 2026-02-30）返回 null。 */
function dayStart(value: string): Date | null {
  const matched = DAY_ONLY.exec(value.trim());
  if (!matched) return null;
  const [, yearText, monthText, dayText] = matched;
  if (!yearText || !monthText || !dayText) return null;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

/** 次日本地 00:00 → ISO（不含上界；跨月跨年由 Date 自行进位）。 */
function nextDayStartIso(date: Date): string {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + 1,
  ).toISOString();
}

/**
 * 校验草稿筛选并生成已提交条件；任一步失败返回字段错误且不产生条件。
 * 金额与日期在客户端就拒绝，避免把必然 400 的请求发给服务端。
 */
export function commitFundLedgerFilters(
  draft: FundLedgerDraftFilters,
): CommitFundLedgerFiltersResult {
  const errors: FundLedgerFilterErrors = {};

  const fromText = draft.occurredFrom.trim();
  const toText = draft.occurredTo.trim();
  const fromDay = fromText === "" ? null : dayStart(fromText);
  const toDay = toText === "" ? null : dayStart(toText);
  if (fromText !== "" && fromDay === null) {
    errors.occurredFrom = "开始日期需为 YYYY-MM-DD 的真实日期";
  }
  if (toText !== "" && toDay === null) {
    errors.occurredTo = "结束日期需为 YYYY-MM-DD 的真实日期";
  }
  if (fromDay && toDay && toDay.getTime() < fromDay.getTime()) {
    errors.occurredTo = "结束日期不得早于开始日期";
  }

  const minText = draft.minAmountYuan.trim();
  const maxText = draft.maxAmountYuan.trim();
  const minFen = minText === "" ? null : yuanToFenString(minText);
  const maxFen = maxText === "" ? null : yuanToFenString(maxText);
  if (minText !== "" && minFen === null) {
    errors.minAmountYuan = "最低金额需为非负数字，最多两位小数";
  }
  if (maxText !== "" && maxFen === null) {
    errors.maxAmountYuan = "最高金额需为非负数字，最多两位小数";
  }
  if (
    minFen !== null &&
    maxFen !== null &&
    toFenBigInt(maxFen) < toFenBigInt(minFen)
  ) {
    errors.maxAmountYuan = "最高金额不得小于最低金额";
  }

  const sourceType = draft.sourceType.trim();
  if (sourceType.length > MAX_SOURCE_TYPE_LENGTH) {
    errors.sourceType = `来源类型最多 ${MAX_SOURCE_TYPE_LENGTH} 个字符`;
  }

  const q = draft.q.trim();
  if (q.length > MAX_KEYWORD_LENGTH) {
    errors.q = `关键词最多 ${MAX_KEYWORD_LENGTH} 个字符`;
  }

  const fundAccountId = draft.fundAccountId.trim();
  if (fundAccountId !== "" && !UUID.test(fundAccountId)) {
    errors.fundAccountId = "资金账户需为合法 UUID";
  }

  const eventTypeText = draft.eventType.trim();
  const eventType =
    eventTypeText === ""
      ? null
      : commitEnum(FUND_LEDGER_EVENT_TYPES, eventTypeText, "REVERSAL");
  if (eventTypeText !== "" && eventType !== eventTypeText) {
    errors.eventType = "事件类型必须是契约枚举值";
  }

  const statusText = draft.status.trim();
  const status =
    statusText === ""
      ? null
      : commitEnum(FUND_LEDGER_TRANSACTION_STATUSES, statusText, "DRAFT");
  if (statusText !== "" && status !== statusText) {
    errors.status = "交易状态必须是契约枚举值";
  }

  const sortByText = draft.sortBy.trim();
  const sortBy = commitEnum(FUND_LEDGER_SORT_FIELDS, sortByText, "occurredAt");
  if (sortBy !== sortByText) {
    errors.sortBy = `排序字段只能是 ${FUND_LEDGER_SORT_FIELDS.join(" / ")}`;
  }

  const sortDirText = draft.sortDir.trim();
  const sortDir = commitEnum(FUND_LEDGER_SORT_DIRECTIONS, sortDirText, "desc");
  if (sortDir !== sortDirText) {
    errors.sortDir = `排序方向只能是 ${FUND_LEDGER_SORT_DIRECTIONS.join(" / ")}`;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    filters: {
      ...(fromDay === null ? {} : { occurredFrom: fromDay.toISOString() }),
      ...(toDay === null ? {} : { occurredTo: nextDayStartIso(toDay) }),
      ...(eventType === null ? {} : { eventType }),
      ...(status === null ? {} : { status }),
      ...(q === "" ? {} : { q }),
      ...(minFen === null ? {} : { minAmountFen: minFen }),
      ...(maxFen === null ? {} : { maxAmountFen: maxFen }),
      ...(sourceType === "" ? {} : { sourceType }),
      ...(fundAccountId === "" ? {} : { fundAccountId }),
      sortBy,
      sortDir,
    },
  };
}

/** 已提交筛选 → 导出 query；空条件与分页都不出现在结果里。 */
export function toFundLedgerExportQuery(
  filters: FundLedgerCommittedFilters,
): FundLedgerExportQuery {
  return {
    ...(filters.occurredFrom === undefined
      ? {}
      : { occurredFrom: filters.occurredFrom }),
    ...(filters.occurredTo === undefined
      ? {}
      : { occurredTo: filters.occurredTo }),
    ...(filters.eventType === undefined
      ? {}
      : { eventType: filters.eventType }),
    ...(filters.status === undefined ? {} : { status: filters.status }),
    ...(filters.q === undefined ? {} : { q: filters.q }),
    ...(filters.minAmountFen === undefined
      ? {}
      : { minAmountFen: filters.minAmountFen }),
    ...(filters.maxAmountFen === undefined
      ? {}
      : { maxAmountFen: filters.maxAmountFen }),
    ...(filters.sourceType === undefined
      ? {}
      : { sourceType: filters.sourceType }),
    ...(filters.fundAccountId === undefined
      ? {}
      : { fundAccountId: filters.fundAccountId }),
    sortBy: filters.sortBy,
    sortDir: filters.sortDir,
  };
}

/** 已提交筛选 → 列表 query：与导出口径完全一致，只额外补上分页。 */
export function toFundLedgerListQuery(
  filters: FundLedgerCommittedFilters,
  page: number,
  pageSize: number,
): FundLedgerListQuery {
  return { ...toFundLedgerExportQuery(filters), page, pageSize };
}

function displayLabel(
  labels: Record<string, string>,
  value: string | null | undefined,
): string {
  if (value === null || value === undefined || value === "") {
    return FUND_LEDGER_EMPTY_TEXT;
  }
  return labels[value] ?? value;
}

/** 事件类型中文；未知值回退原始值，空值显示 `—`。 */
export function eventTypeLabel(value: string | null | undefined): string {
  return displayLabel(EVENT_TYPE_LABELS, value);
}

/** 交易状态中文；未知值回退原始值，空值显示 `—`。 */
export function transactionStatusLabel(
  value: string | null | undefined,
): string {
  return displayLabel(TRANSACTION_STATUS_LABELS, value);
}

/** 对账状态中文；未知值回退原始值，空值显示 `—`。 */
export function reconciliationStatusLabel(
  value: string | null | undefined,
): string {
  return displayLabel(RECONCILIATION_STATUS_LABELS, value);
}

/** 资金流向中文；`null` 显示 `—`，未知值回退原始值。 */
export function fundFlowLabel(value: string | null | undefined): string {
  return displayLabel(FUND_FLOW_LABELS, value);
}

/** 借贷平衡状态；独立于交易 `status`，不由交易状态推断。 */
export function balancedLabel(value: boolean): string {
  return value ? "平衡" : "借贷不平";
}

/**
 * 行选择规则只依赖这两个字段：交易号用于匹配选中项，`balanced` 用于判定异常。
 * 用结构化类型而非完整 `FundLedgerRow`，供单测直接复用；完整行天然满足该约束。
 */
export interface FundLedgerSelectableRow {
  transactionId: string;
  balanced: boolean;
}

/**
 * 可见行：开启「仅当前页异常」时只保留借贷不平的行，否则返回完整列表。
 * 不筛选时也返回新数组，调用方无法通过返回值改到入参。
 */
export function visibleLedgerRows<T extends FundLedgerSelectableRow>(
  rows: readonly T[],
  onlyAbnormal: boolean,
): T[] {
  return onlyAbnormal ? rows.filter((row) => !row.balanced) : [...rows];
}

/**
 * 选中行：`selectedId` 仍在可见集合内时保留，否则回退到可见首行；可见为空时返回
 * `null`，保证证据链与「打开交易追溯」入口都不会指向被异常筛选隐藏的平衡交易。
 */
export function pickActiveLedgerRow<T extends FundLedgerSelectableRow>(
  visibleRows: readonly T[],
  selectedId: string | null,
): T | null {
  if (selectedId !== null) {
    const selected = visibleRows.find(
      (row) => row.transactionId === selectedId,
    );
    if (selected) return selected;
  }
  return visibleRows[0] ?? null;
}

/** 分转元（复用 `formatFenYuan` 的 BigInt 实现，不经过 `number`）。 */
export function formatLedgerFen(fen: string): string {
  return formatFenYuan(fen);
}

/** 借贷差额绝对值（十进制字符串分）：BigInt 相减，禁止转 `number`。 */
export function ledgerDifferenceFen(
  debitFen: string,
  creditFen: string,
): string {
  const debit = toFenBigInt(debitFen);
  const credit = toFenBigInt(creditFen);
  const difference = debit > credit ? debit - credit : credit - debit;
  return difference.toString();
}

/**
 * DS-007：统一资金台账查询的端口与视图契约（**只读**）。
 *
 * 口径：一条 `LedgerTransaction` 一行；金额一律整数分，接口输出十进制字符串；
 * 借贷聚合、资金流方向、辅助核算与对账展示映射都由应用层按固定规则派生，
 * 仓储只负责取数与数据库层过滤/排序/分页。本文件不依赖 NestJS、HTTP、环境变量或 Prisma。
 */

import type {
  FundAccountKind,
  FundAccountStatus,
} from "../domain/fund-account.js";

/**
 * 事件类型白名单：与 Prisma `LedgerEventType` 逐一对应。
 *
 * 查询不得只为某一种事件写特例，也不得新增或重解释事件；本片不新增枚举值。
 */
export const FUND_LEDGER_EVENT_TYPES = [
  "ORDER_ACCOUNTING",
  "PAYMENT_CONFIRMED",
  "WALLET_CONSUMED",
  "REFUND_CONFIRMED",
  "PLAYER_PAYOUT_CONFIRMED",
  "RECONCILIATION_ADJUSTMENT",
  "REVERSAL",
] as const;

export type FundLedgerEventType = (typeof FUND_LEDGER_EVENT_TYPES)[number];

/** 交易状态白名单：与 Prisma `LedgerTransactionStatus` 逐一对应。 */
export const FUND_LEDGER_TRANSACTION_STATUSES = [
  "DRAFT",
  "CONFIRMED",
  "RECONCILED",
  "REVERSED",
] as const;

export type FundLedgerTransactionStatus =
  (typeof FUND_LEDGER_TRANSACTION_STATUSES)[number];

/**
 * 允许排序的字段白名单：只放台账真实列。`amountFen` 不是表列，
 * 它按「该交易借方分录之和」聚合后在数据库层排序（与金额过滤同一口径）。
 */
export const FUND_LEDGER_SORT_FIELDS = [
  "occurredAt",
  "confirmedAt",
  "createdAt",
  "amountFen",
  "txNo",
] as const;

export type FundLedgerSortField = (typeof FUND_LEDGER_SORT_FIELDS)[number];

export type FundLedgerSortDir = "asc" | "desc";

/** 分页默认与上限；上限防止一次把全租户台账拉进内存。 */
export const FUND_LEDGER_DEFAULT_PAGE_SIZE = 50;
export const FUND_LEDGER_MAX_PAGE_SIZE = 200;
/** 关键词长度上限。 */
export const FUND_LEDGER_SEARCH_MAX_LENGTH = 50;
/** 来源类型长度上限（trim 后）。 */
export const FUND_LEDGER_SOURCE_TYPE_MAX_LENGTH = 64;
/**
 * 导出上限：一次 CSV 导出的最大行数（与支付台账导出一致）。
 * 超过就整体失败，绝不返回被静默截断的 CSV——缺行的台账比报错更危险。
 */
export const FUND_LEDGER_EXPORT_MAX_ROWS = 5000;

/** 资金流方向：没有挂接交易头资金账户的分录为 `null`；两种方向都有为 `MIXED`。 */
export type FundFlowDirection = "DEBIT" | "CREDIT" | "MIXED";

/** 对账状态展示映射：只有 `RECONCILED` 交易算已对账；原始 `status` 必须同时返回。 */
export type FundLedgerReconciliationStatus = "RECONCILED" | "UNRECONCILED";

/**
 * 输入不合法（控制器映射 HTTP 400）。
 *
 * 与支付台账把同类错误放在 `payments/domain/payments.errors.ts` 不同：本切片允许新建的文件里
 * 没有领域错误文件，而端口层是服务与控制器都依赖、且不引入 NestJS 的最近位置，故放在这里。
 */
export class FundLedgerInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FundLedgerInputError";
  }
}

/**
 * 匹配结果超过导出上限（控制器映射 HTTP 422）。
 *
 * 与 `FundLedgerInputError` 分开：参数本身完全合法，只是这次筛选命中的行数太多，
 * 客户端应缩小筛选范围后重试；也不能退回 400 让调用方以为是参数写错了。
 */
export class FundLedgerExportLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FundLedgerExportLimitError";
  }
}

/**
 * 校验通过、可直接交给仓储的查询。
 *
 * 每个可选字段缺席即「不过滤」，绝不用空串或默认值代替未提供；
 * 除 `q` 外，可选字段一旦提供就不能是空白串——空白串按输入错误拒绝（HTTP 400），
 * 不会退化成「不过滤」或默认值。
 * 时间范围是 `[occurredFrom, occurredTo)`：含下界、不含上界。
 */
export interface FundLedgerQuery {
  tenantId: string;
  eventType?: FundLedgerEventType;
  status?: FundLedgerTransactionStatus;
  /** 按**交易头**资金账户过滤（不是分录上的资金账户）。 */
  fundAccountId?: string;
  /** 精确匹配的来源类型（trim 后 1–64 字符）。 */
  sourceType?: string;
  /**
   * 关键词（trim 后 1–50 字符）：单号、描述、来源、资金账户 code/name 的包含匹配。
   * 全切片唯一允许「提供空白串」的参数：trim 后为空按「未提供」处理。
   */
  q?: string;
  occurredFrom?: Date;
  occurredTo?: Date;
  /** 按交易借方合计（分）过滤，含下界。 */
  minAmountFen?: bigint;
  /** 按交易借方合计（分）过滤，含上界。 */
  maxAmountFen?: bigint;
  sortBy: FundLedgerSortField;
  sortDir: FundLedgerSortDir;
  /** 1 起算。 */
  page: number;
  pageSize: number;
}

/** 仓储返回的一条分录（最小字段；不含科目 id、账户余额或任何敏感字段）。 */
export interface FundLedgerEntryRow {
  transactionId: string;
  direction: "DEBIT" | "CREDIT";
  amountFen: bigint;
  fundAccountId: string | null;
  auxiliaryType: string | null;
  auxiliaryId: string | null;
}

/** 交易头资金账户解析结果；交易头无资金账户或记录不存在时为 `null`（不丢行、不跨租户补查）。 */
export interface FundLedgerFundAccountRef {
  id: string;
  code: string;
  name: string;
  kind: FundAccountKind;
  status: FundAccountStatus;
}

/** 仓储返回的一条交易（含全部分录与解析出的资金账户）。 */
export interface FundLedgerTransactionRow {
  id: string;
  txNo: string;
  description: string | null;
  sourceType: string | null;
  sourceId: string | null;
  eventType: FundLedgerEventType | null;
  status: FundLedgerTransactionStatus;
  /** 交易头资金账户 id；分录方向与资金账户解析都以它为准。 */
  fundAccountId: string | null;
  createdBy: string | null;
  confirmedBy: string | null;
  occurredAt: Date;
  confirmedAt: Date | null;
  createdAt: Date;
  entries: FundLedgerEntryRow[];
  fundAccount: FundLedgerFundAccountRef | null;
}

/** 列表与计数同一口径：同一组过滤条件下的一次读取。 */
export interface FundLedgerPage {
  rows: FundLedgerTransactionRow[];
  /** 同一筛选条件下的交易总数（不受 pageSize 影响）。 */
  total: number;
}

export interface FundLedgerRepository {
  /** 全部读取在同一次租户上下文里完成；仓储不自行开启第二层事务。 */
  listTransactions(query: FundLedgerQuery): Promise<FundLedgerPage>;
}

/** 辅助核算引用（去重后的最小追溯维度；本切片不解析客户名、陪玩名或批次明细）。 */
export interface FundLedgerAuxiliaryRef {
  type: string;
  id: string;
}

/** API 视图行：金额为十进制字符串，时间为 ISO 字符串，可空字段显式为 `null`。 */
export interface FundLedgerRowView {
  transactionId: string;
  txNo: string;
  eventType: FundLedgerEventType | null;
  status: FundLedgerTransactionStatus;
  reconciliationStatus: FundLedgerReconciliationStatus;
  sourceType: string | null;
  sourceId: string | null;
  description: string | null;
  amountFen: string;
  debitFen: string;
  creditFen: string;
  balanced: boolean;
  fundFlowDirection: FundFlowDirection | null;
  fundAccount: FundLedgerFundAccountRef | null;
  auxiliaries: FundLedgerAuxiliaryRef[];
  createdBy: string | null;
  confirmedBy: string | null;
  occurredAt: string;
  confirmedAt: string | null;
  createdAt: string;
}

/** API 视图：与任务包固定的成功响应字段一一对应。 */
export interface FundLedgerView {
  rows: FundLedgerRowView[];
  total: number;
  page: number;
  pageSize: number;
  sortBy: FundLedgerSortField;
  sortDir: FundLedgerSortDir;
}

/**
 * 控制器传入的原始查询值：HTTP 层不保证类型（重复查询参数会变成数组），
 * 每个字段都按 `unknown` 接收并在服务层逐字段校验，仓储只接收 `FundLedgerQuery`。
 */
export interface FundLedgerQueryInput {
  tenantId: string;
  eventType?: unknown;
  status?: unknown;
  fundAccountId?: unknown;
  sourceType?: unknown;
  q?: unknown;
  occurredFrom?: unknown;
  occurredTo?: unknown;
  minAmountFen?: unknown;
  maxAmountFen?: unknown;
  sortBy?: unknown;
  sortDir?: unknown;
  page?: unknown;
  pageSize?: unknown;
}

/**
 * 控制器传入的原始**导出**查询值：筛选/排序参数与列表完全同源，
 * 但**不含** `page`/`pageSize`——导出的是当前筛选与排序下的全部匹配交易，不是列表当前页。
 * 解析入口仍复用 `parseFundLedgerQuery`（先校验，再由服务把内部分页固定为导出值）。
 */
export interface FundLedgerExportQueryInput {
  tenantId: string;
  eventType?: unknown;
  status?: unknown;
  fundAccountId?: unknown;
  sourceType?: unknown;
  q?: unknown;
  occurredFrom?: unknown;
  occurredTo?: unknown;
  minAmountFen?: unknown;
  maxAmountFen?: unknown;
  sortBy?: unknown;
  sortDir?: unknown;
}

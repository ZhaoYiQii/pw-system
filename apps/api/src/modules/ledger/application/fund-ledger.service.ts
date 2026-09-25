/**
 * DS-007：统一资金台账查询的应用服务（**只读**）。
 *
 * 职责边界：把控制器传入的原始查询值逐字段校验、规范化为强类型 `FundLedgerQuery`；
 * 再把仓储返回的交易行按任务包固定的 8 条规则派生成 API 视图。金额只以十进制字符串
 * 出网（`BigInt` 绝不经过 `number`），时间只以 ISO 字符串出网，可空字段显式 `null`。
 *
 * 纯应用层：不依赖 NestJS、HTTP、环境变量、Prisma client 或数据库。
 */

import { toUtf8BomCsv } from "../../../common/csv.js";
import { fenToYuanText, parseFenString } from "../../../common/money.js";
import {
  FUND_LEDGER_DEFAULT_PAGE_SIZE,
  FUND_LEDGER_EVENT_TYPES,
  FUND_LEDGER_EXPORT_MAX_ROWS,
  FUND_LEDGER_MAX_PAGE_SIZE,
  FUND_LEDGER_SEARCH_MAX_LENGTH,
  FUND_LEDGER_SORT_FIELDS,
  FUND_LEDGER_SOURCE_TYPE_MAX_LENGTH,
  FUND_LEDGER_TRANSACTION_STATUSES,
  FundLedgerExportLimitError,
  FundLedgerInputError,
} from "./fund-ledger-ports.js";
import type {
  FundFlowDirection,
  FundLedgerAuxiliaryRef,
  FundLedgerEntryRow,
  FundLedgerEventType,
  FundLedgerExportQueryInput,
  FundLedgerQuery,
  FundLedgerQueryInput,
  FundLedgerReconciliationStatus,
  FundLedgerRepository,
  FundLedgerRowView,
  FundLedgerSortDir,
  FundLedgerSortField,
  FundLedgerTransactionRow,
  FundLedgerTransactionStatus,
  FundLedgerView,
} from "./fund-ledger-ports.js";

/**
 * uuid 形状（交易头资金账户过滤条件）。格式不对必须在服务层拦成 400：
 * 放行到 Prisma 会抛 uuid 解析错误，把客户端输入错误伪装成服务端 500。
 */
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * ISO 8601 带时区时间串：与 `player-payout-confirmed-ledger-posting.ts` 同一形状。
 * 该模块的解析器是私有的、且本切片不允许修改它所在的文件，故在此**有意重复**一份；
 * 两份的接受集必须一致（小时 00–23、分秒 00–59、允许 `+0800` 与 1–9 位小数秒）。
 */
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/;

/** 正整数（页码、页大小）：不接受 `0`、前导零、正负号或小数。 */
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;

/** 非字符串（如重复查询参数变成数组）直接拒绝；去空白后为空串时返回 `null`，由调用方决定算不算错误。 */
function trimmedText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new FundLedgerInputError(`${field} 必须是字符串`);
  }
  const text = value.trim();
  return text ? text : null;
}

/**
 * 可选文本参数：缺席（`undefined`/`null`）算「未提供」，返回 `null`；
 * 提供了但 trim 后为空一律拒绝——空白串若被当成未提供，等于静默取消过滤。
 */
function optionalText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  const text = trimmedText(value, field);
  if (text === null) {
    throw new FundLedgerInputError(
      `${field} 不能为空白字符串（不提供时请省略该参数）`,
    );
  }
  return text;
}

/** `q` 是本切片唯一允许空白按「未提供」处理的参数：空关键词等于不过滤。 */
function optionalSearchText(value: unknown): string | null {
  return trimmedText(value, "q");
}

function parseEventType(value: unknown): FundLedgerEventType | null {
  const text = optionalText(value, "eventType");
  if (text === null) return null;
  const found = FUND_LEDGER_EVENT_TYPES.find((candidate) => candidate === text);
  if (!found) {
    throw new FundLedgerInputError(
      `eventType 只能是 ${FUND_LEDGER_EVENT_TYPES.join(" / ")}，实际收到 ${text}`,
    );
  }
  return found;
}

function parseStatus(value: unknown): FundLedgerTransactionStatus | null {
  const text = optionalText(value, "status");
  if (text === null) return null;
  const found = FUND_LEDGER_TRANSACTION_STATUSES.find(
    (candidate) => candidate === text,
  );
  if (!found) {
    throw new FundLedgerInputError(
      `status 只能是 ${FUND_LEDGER_TRANSACTION_STATUSES.join(" / ")}，实际收到 ${text}`,
    );
  }
  return found;
}

function parseFundAccountId(value: unknown): string | null {
  const text = optionalText(value, "fundAccountId");
  if (text === null) return null;
  if (!UUID_PATTERN.test(text)) {
    throw new FundLedgerInputError("fundAccountId 必须是 uuid");
  }
  return text;
}

function parseSourceType(value: unknown): string | null {
  const text = optionalText(value, "sourceType");
  if (text === null) return null;
  if (text.length > FUND_LEDGER_SOURCE_TYPE_MAX_LENGTH) {
    throw new FundLedgerInputError(
      `sourceType 去空白后不能超过 ${FUND_LEDGER_SOURCE_TYPE_MAX_LENGTH} 个字符`,
    );
  }
  return text;
}

function parseSearch(value: unknown): string | null {
  const text = optionalSearchText(value);
  if (text === null) return null;
  if (text.length > FUND_LEDGER_SEARCH_MAX_LENGTH) {
    throw new FundLedgerInputError(
      `q 去空白后不能超过 ${FUND_LEDGER_SEARCH_MAX_LENGTH} 个字符`,
    );
  }
  return text;
}

/**
 * 日历日复核：`2026-02-31T00:00:00.000Z` 会被 JS 悄悄滚到 3 月 3 日，
 * 查询区间被静默改动比直接报错更糟。
 */
function assertRealCalendarDate(text: string, field: string): void {
  const [yearText, monthText, dayText] = text.slice(0, 10).split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const utc = new Date(Date.UTC(year, month - 1, day));
  const rollsOver =
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day;
  if (rollsOver) {
    throw new FundLedgerInputError(
      `${field} 不是有效日期（${text.slice(0, 10)}）`,
    );
  }
}

function parseIsoTime(
  value: unknown,
  field: "occurredFrom" | "occurredTo",
): Date | null {
  const text = optionalText(value, field);
  if (text === null) return null;
  if (!ISO_TIMESTAMP_PATTERN.test(text)) {
    throw new FundLedgerInputError(
      `${field} 必须是带时区的 ISO 8601 时间（如 2026-09-24T12:00:00.000Z）`,
    );
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    throw new FundLedgerInputError(`${field} 不是有效时间`);
  }
  assertRealCalendarDate(text, field);
  return parsed;
}

/**
 * 金额边界：非负十进制整数字符串（分），复用既有 `parseFenString` 口径（拒绝前导零、小数、负数）。
 * 缺席 = 不过滤；提供了但 trim 后为空一律拒绝，不静默取消金额过滤。
 */
function parseAmountFen(
  value: unknown,
  field: "minAmountFen" | "maxAmountFen",
): bigint | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new FundLedgerInputError(`${field} 需为非负十进制整数字符串（分）`);
  }
  const text = value.trim();
  if (!text) {
    throw new FundLedgerInputError(
      `${field} 不能为空白字符串（不提供时请省略该参数）`,
    );
  }
  const canonical = parseFenString(text, true);
  if (canonical === null) {
    throw new FundLedgerInputError(
      `${field} 需为非负十进制整数字符串（分），实际收到 ${text}`,
    );
  }
  return BigInt(canonical);
}

function parseSortBy(value: unknown): FundLedgerSortField {
  const text = optionalText(value, "sortBy");
  if (text === null) return "occurredAt";
  const found = FUND_LEDGER_SORT_FIELDS.find((candidate) => candidate === text);
  if (!found) {
    throw new FundLedgerInputError(
      `sortBy 只能是 ${FUND_LEDGER_SORT_FIELDS.join(" / ")}，实际收到 ${text}`,
    );
  }
  return found;
}

function parseSortDir(value: unknown): FundLedgerSortDir {
  const text = optionalText(value, "sortDir");
  if (text === null) return "desc";
  if (text !== "asc" && text !== "desc") {
    throw new FundLedgerInputError(
      `sortDir 只能是 asc / desc，实际收到 ${text}`,
    );
  }
  return text;
}

function parsePositiveInt(
  value: unknown,
  field: "page" | "pageSize",
  fallback: number,
): number {
  const text = optionalText(value, field);
  if (text === null) return fallback;
  if (!POSITIVE_INTEGER_PATTERN.test(text)) {
    throw new FundLedgerInputError(`${field} 必须是正整数，实际收到 ${text}`);
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) {
    throw new FundLedgerInputError(`${field} 超出可处理范围，实际收到 ${text}`);
  }
  return parsed;
}

/**
 * 解析并校验原始查询值。
 *
 * 任何一项非法都抛 `FundLedgerInputError`（HTTP 400），**不做静默回退**：
 * 认不出的枚举不会被当成「全部」，非法页码不会被当成第 1 页，
 * 空白参数不会被当成「未提供」（只有 `q` 的空白按未提供处理）。
 * 返回值只含已规范化的强类型字段，仓储存不到 `unknown`。
 */
export function parseFundLedgerQuery(
  input: FundLedgerQueryInput,
): FundLedgerQuery {
  if (typeof input.tenantId !== "string" || !input.tenantId.trim()) {
    // 正常情况下控制器已从登录态取到租户并在此之前以 401 拦下，这里是纵深防御。
    throw new FundLedgerInputError("缺少租户上下文，拒绝查询");
  }

  const eventType = parseEventType(input.eventType);
  const status = parseStatus(input.status);
  const fundAccountId = parseFundAccountId(input.fundAccountId);
  const sourceType = parseSourceType(input.sourceType);
  const q = parseSearch(input.q);
  const occurredFrom = parseIsoTime(input.occurredFrom, "occurredFrom");
  const occurredTo = parseIsoTime(input.occurredTo, "occurredTo");
  if (
    occurredFrom !== null &&
    occurredTo !== null &&
    occurredTo.getTime() <= occurredFrom.getTime()
  ) {
    // 上界不包含：区间为空（相等）或反向都必须报错，不能悄悄返回空列表。
    throw new FundLedgerInputError("occurredTo 必须晚于 occurredFrom");
  }
  const minAmountFen = parseAmountFen(input.minAmountFen, "minAmountFen");
  const maxAmountFen = parseAmountFen(input.maxAmountFen, "maxAmountFen");
  if (
    minAmountFen !== null &&
    maxAmountFen !== null &&
    maxAmountFen < minAmountFen
  ) {
    throw new FundLedgerInputError("maxAmountFen 不得小于 minAmountFen");
  }
  const page = parsePositiveInt(input.page, "page", 1);
  const pageSize = parsePositiveInt(
    input.pageSize,
    "pageSize",
    FUND_LEDGER_DEFAULT_PAGE_SIZE,
  );
  if (pageSize > FUND_LEDGER_MAX_PAGE_SIZE) {
    throw new FundLedgerInputError(
      `pageSize 最大为 ${FUND_LEDGER_MAX_PAGE_SIZE}，实际收到 ${pageSize}`,
    );
  }

  return {
    tenantId: input.tenantId.trim(),
    ...(eventType === null ? {} : { eventType }),
    ...(status === null ? {} : { status }),
    ...(fundAccountId === null ? {} : { fundAccountId }),
    ...(sourceType === null ? {} : { sourceType }),
    ...(q === null ? {} : { q }),
    ...(occurredFrom === null ? {} : { occurredFrom }),
    ...(occurredTo === null ? {} : { occurredTo }),
    ...(minAmountFen === null ? {} : { minAmountFen }),
    ...(maxAmountFen === null ? {} : { maxAmountFen }),
    sortBy: parseSortBy(input.sortBy),
    sortDir: parseSortDir(input.sortDir),
    page,
    pageSize,
  };
}

/** 某一方向的金额合计；只累加同一方向，绝不把借贷两边相加（否则金额翻倍）。 */
function sumByDirection(
  entries: readonly FundLedgerEntryRow[],
  direction: "DEBIT" | "CREDIT",
): bigint {
  let total = 0n;
  for (const entry of entries) {
    if (entry.direction === direction) total += entry.amountFen;
  }
  return total;
}

/** 对账展示映射：只有 `RECONCILED` 算已对账，其余一律未对账（原始 `status` 照常返回）。 */
function toReconciliationStatus(
  status: FundLedgerTransactionStatus,
): FundLedgerReconciliationStatus {
  return status === "RECONCILED" ? "RECONCILED" : "UNRECONCILED";
}

/**
 * 资金流方向：只看**挂接交易头资金账户**的分录。
 * 没有匹配分录 → `null`；方向一致 → `DEBIT`/`CREDIT`；两种都有 → `MIXED`。
 */
function deriveFundFlowDirection(
  row: FundLedgerTransactionRow,
): FundFlowDirection | null {
  const headerAccountId = row.fundAccountId;
  if (!headerAccountId) return null;
  let hasDebit = false;
  let hasCredit = false;
  for (const entry of row.entries) {
    if (entry.fundAccountId !== headerAccountId) continue;
    if (entry.direction === "DEBIT") hasDebit = true;
    else hasCredit = true;
  }
  if (!hasDebit && !hasCredit) return null;
  if (hasDebit && hasCredit) return "MIXED";
  return hasDebit ? "DEBIT" : "CREDIT";
}

/**
 * 辅助核算去重键的分隔符：NUL 不可能出现在 `auxiliaryType`/`auxiliaryId` 中，
 * 避免「type=`a b` + id=`c`」与「type=`a` + id=`b c`」撞成同一个键。
 * 用 `String.fromCharCode(0)` 生成而不是写字面量：字面量 NUL 会把源文件变成二进制，
 * diff、grep 与工具链都会失灵（本文件第一次写入就踩过这个坑）。
 */
const AUXILIARY_KEY_SEPARATOR = String.fromCharCode(0);

/** 码位比较：不依赖 ICU 区域设置，跨运行环境稳定（`localeCompare` 会随环境变化）。 */
function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * 辅助核算引用：从分录的 `auxiliaryType + auxiliaryId` 提取，去重后按 (type, id) 稳定排序；
 * 任一字段为空的分录不生成引用（本切片不解析客户名、陪玩名或批次明细）。
 */
function collectAuxiliaries(
  entries: readonly FundLedgerEntryRow[],
): FundLedgerAuxiliaryRef[] {
  const unique = new Map<string, FundLedgerAuxiliaryRef>();
  for (const entry of entries) {
    const type = entry.auxiliaryType;
    const id = entry.auxiliaryId;
    if (!type || !id) continue;
    unique.set(`${type}${AUXILIARY_KEY_SEPARATOR}${id}`, { type, id });
  }
  return [...unique.values()].sort(
    (left, right) =>
      compareText(left.type, right.type) || compareText(left.id, right.id),
  );
}

/**
 * 交易行 → API 视图行：金额转为十进制字符串、时间转为 ISO 字符串。
 * `amountFen` 与 `debitFen` 同为借方合计（与金额过滤/排序同一口径），
 * 不平衡的历史行照常返回并标记 `balanced=false`，不会让整页查询失败。
 */
export function toFundLedgerRowView(
  row: FundLedgerTransactionRow,
): FundLedgerRowView {
  const debitFen = sumByDirection(row.entries, "DEBIT");
  const creditFen = sumByDirection(row.entries, "CREDIT");
  return {
    transactionId: row.id,
    txNo: row.txNo,
    eventType: row.eventType,
    status: row.status,
    reconciliationStatus: toReconciliationStatus(row.status),
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    description: row.description,
    amountFen: debitFen.toString(),
    debitFen: debitFen.toString(),
    creditFen: creditFen.toString(),
    balanced: debitFen === creditFen && debitFen > 0n,
    fundFlowDirection: deriveFundFlowDirection(row),
    fundAccount: row.fundAccount,
    auxiliaries: collectAuxiliaries(row.entries),
    createdBy: row.createdBy,
    confirmedBy: row.confirmedBy,
    occurredAt: row.occurredAt.toISOString(),
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 资金台账 CSV 表头与列序：本切片固定的对外契约，不得随实现漂移。 */
const FUND_LEDGER_CSV_HEADER = [
  "交易号",
  "事件类型",
  "交易状态",
  "对账状态",
  "资金流方向",
  "金额(元)",
  "借方(元)",
  "贷方(元)",
  "是否平衡",
  "资金账户编码",
  "资金账户名称",
  "资金账户类型",
  "资金账户状态",
  "来源类型",
  "来源ID",
  "摘要",
  "辅助核算",
  "创建人ID",
  "确认人ID",
  "发生时间",
  "确认时间",
  "创建时间",
] as const;

/** 辅助核算单元格：单项 `type:id`，多项用 `;` 连接（顺序沿用已去重稳定排序的结果）。 */
function formatAuxiliaries(
  auxiliaries: readonly FundLedgerAuxiliaryRef[],
): string {
  return auxiliaries
    .map((auxiliary) => `${auxiliary.type}:${auxiliary.id}`)
    .join(";");
}

/**
 * 交易行视图 → CSV 文本。
 *
 * `null` 一律输出空单元格（绝不写 `null`/`undefined` 文本，也不伪造默认值）；
 * 金额经共享 `fenToYuanText` 以 BigInt 转成元文本；不平衡行照常导出并标记 `否`，
 * 不因数据异常丢行或报 500。转义与公式注入防护全部交给共享 `toUtf8BomCsv`。
 */
export function toFundLedgerCsv(rows: readonly FundLedgerRowView[]): string {
  const body = rows.map((row) => [
    row.txNo,
    row.eventType ?? "",
    row.status,
    row.reconciliationStatus,
    row.fundFlowDirection ?? "",
    fenToYuanText(row.amountFen),
    fenToYuanText(row.debitFen),
    fenToYuanText(row.creditFen),
    row.balanced ? "是" : "否",
    row.fundAccount?.code ?? "",
    row.fundAccount?.name ?? "",
    row.fundAccount?.kind ?? "",
    row.fundAccount?.status ?? "",
    row.sourceType ?? "",
    row.sourceId ?? "",
    row.description ?? "",
    formatAuxiliaries(row.auxiliaries),
    row.createdBy ?? "",
    row.confirmedBy ?? "",
    row.occurredAt,
    row.confirmedAt ?? "",
    row.createdAt,
  ]);
  return toUtf8BomCsv([FUND_LEDGER_CSV_HEADER, ...body]);
}

export class FundLedgerService {
  constructor(private readonly repository: FundLedgerRepository) {}

  /**
   * 一次查询：校验 → 单次仓储调用（列表与计数同一口径）→ 派生视图。
   * `total/page/pageSize/sortBy/sortDir` 原样来自查询与仓储，不在应用层二次加工。
   */
  async list(input: FundLedgerQueryInput): Promise<FundLedgerView> {
    const query = parseFundLedgerQuery(input);
    const page = await this.repository.listTransactions(query);
    return {
      rows: page.rows.map(toFundLedgerRowView),
      total: page.total,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    };
  }

  /**
   * 导出当前筛选与排序下的**全部**匹配交易（上限 `FUND_LEDGER_EXPORT_MAX_ROWS`）。
   *
   * 先复用 DS-007 的同一解析入口 `parseFundLedgerQuery`（筛选与排序口径不可能与列表漂移），
   * 再把内部 `page`/`pageSize` 固定为导出值：只调用一次仓储、不跨页拼接，
   * 行序由仓储的 `sortBy + sortDir + id` 稳定排序保证。
   * `total` 超过上限时抛 `FundLedgerExportLimitError`（控制器映射 422），
   * 绝不返回被静默截断的前 5000 行。
   */
  async exportCsv(input: FundLedgerExportQueryInput): Promise<string> {
    const query: FundLedgerQuery = {
      ...parseFundLedgerQuery(input),
      page: 1,
      pageSize: FUND_LEDGER_EXPORT_MAX_ROWS,
    };
    const page = await this.repository.listTransactions(query);
    if (page.total > FUND_LEDGER_EXPORT_MAX_ROWS) {
      throw new FundLedgerExportLimitError(
        `导出结果超过 ${FUND_LEDGER_EXPORT_MAX_ROWS} 行，请缩小筛选范围`,
      );
    }
    return toFundLedgerCsv(page.rows.map(toFundLedgerRowView));
  }
}

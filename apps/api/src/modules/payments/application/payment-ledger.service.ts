import type {
  PaymentLedgerQuery,
  PaymentLedgerRepository,
  PaymentLedgerRow,
  PaymentLedgerSortField,
} from "./payment-ledger-ports.js";
import { PAYMENT_LEDGER_SORT_FIELDS } from "./payment-ledger-ports.js";
import { PaymentLedgerInputError } from "../domain/payments.errors.js";
import { toUtf8BomCsv } from "../../../common/csv.js";
import { fenToYuanText } from "../../../common/money.js";

/**
 * S5-1：门店支付台账（客户充值/支付的支付单列表），服务端分页 + 排序 + 筛选 + CSV 导出。
 *
 * 口径由后端一处定死，前端（Tabulator 表格壳）只翻译用户操作：
 * - 过滤状态只认 `payment_orders.status` 的 CHECK 约束里的三个值（别的值直接 400，不静默忽略）；
 * - 排序字段走白名单（`PAYMENT_LEDGER_SORT_FIELDS`），方向只认 asc/desc；
 * - `page` / `pageSize` 越界或非整数 → 400（不静默夹取，否则前端分页器会与后端不一致）；
 * - **可退判据与人工退款登记同一口径**（已支付 + 还有没退完的钱）。
 */

/** 与 `payment_orders` 的 `CHECK (status IN ...)` 完全一致。 */
export const PAYMENT_LEDGER_STATUSES = [
  "PENDING",
  "SUCCESS",
  "FAILED",
] as const;

export const PAYMENT_LEDGER_DEFAULT_LIMIT = 50;
export const PAYMENT_LEDGER_MAX_LIMIT = 200;
/** 导出上限：一屏表格导出到 Excel 够用；再大应走对账/账单链路，不在本片范围。 */
export const PAYMENT_LEDGER_EXPORT_MAX_ROWS = 5000;
export const PAYMENT_LEDGER_SEARCH_MAX_LENGTH = 50;

export interface PaymentLedgerRowView {
  id: string;
  outNo: string;
  amountFen: string;
  refundedFen: string;
  /** 还能退多少（分）；已全额退为 `"0"`。 */
  refundableFen: string;
  canRefund: boolean;
  status: string;
  customerProfileId: string;
  customerName: string | null;
  createdAt: string;
  paidAt: string | null;
}

export interface PaymentLedgerView {
  rows: PaymentLedgerRowView[];
  /** 同一筛选条件下的总行数（分页器用）。 */
  total: number;
  page: number;
  pageSize: number;
  status: string | null;
  q: string | null;
  sortBy: PaymentLedgerSortField;
  sortDir: "asc" | "desc";
}

export interface PaymentLedgerQueryInput {
  tenantId: string;
  status?: string;
  q?: string;
  sortBy?: string;
  sortDir?: string;
  page?: string;
  pageSize?: string;
  /** S4-7 的旧参数名，等价于 `pageSize`（保留以免旧调用 400）。 */
  limit?: string;
}

export class TenantPaymentLedgerService {
  constructor(private readonly repository: PaymentLedgerRepository) {}

  async list(input: PaymentLedgerQueryInput): Promise<PaymentLedgerView> {
    const query = parseLedgerQuery(input);
    const [rows, total] = await Promise.all([
      this.repository.listOrders(query),
      this.repository.countOrders({
        tenantId: query.tenantId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.q ? { q: query.q } : {}),
      }),
    ]);
    return {
      rows: rows.map(toLedgerRowView),
      total,
      page: query.page,
      pageSize: query.pageSize,
      status: query.status ?? null,
      q: query.q ?? null,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    };
  }

  /** 导出当前筛选条件下的**全部**行（上限见 `PAYMENT_LEDGER_EXPORT_MAX_ROWS`），返回 CSV 文本。 */
  async exportCsv(input: {
    tenantId: string;
    status?: string;
    q?: string;
  }): Promise<string> {
    const status = parseLedgerStatus(input.status);
    const q = parseLedgerSearch(input.q);
    const rows = await this.repository.listOrders({
      tenantId: input.tenantId,
      ...(status ? { status } : {}),
      ...(q ? { q } : {}),
      sortBy: "createdAt",
      sortDir: "desc",
      page: 1,
      pageSize: PAYMENT_LEDGER_EXPORT_MAX_ROWS,
    });
    return toLedgerCsv(rows.map(toLedgerRowView));
  }
}

/**
 * 一组查询参数 → 仓储查询：逐个校验，任一不合法直接 400。
 * 为什么不在控制器里做：探针/导出/未来的列表页都要同一套口径，散在控制器里必然漂移。
 */
export function parseLedgerQuery(
  input: PaymentLedgerQueryInput,
): PaymentLedgerQuery {
  const status = parseLedgerStatus(input.status);
  const q = parseLedgerSearch(input.q);
  const { sortBy, sortDir } = parseLedgerSort(input.sortBy, input.sortDir);
  const page = parseLedgerPage(input.page);
  const pageSize = parseLedgerLimit(input.pageSize ?? input.limit);
  return {
    tenantId: input.tenantId,
    ...(status ? { status } : {}),
    ...(q ? { q } : {}),
    sortBy,
    sortDir,
    page,
    pageSize,
  };
}

/** 空串/未传 = 不过滤；认不出的状态**报错**而不是当"全部"处理（否则筛选会静默失效）。 */
export function parseLedgerStatus(raw: string | undefined): string | null {
  const value = raw?.trim() ?? "";
  if (!value) return null;
  if (!(PAYMENT_LEDGER_STATUSES as readonly string[]).includes(value)) {
    throw new PaymentLedgerInputError(
      `status 只能是 ${PAYMENT_LEDGER_STATUSES.join(" / ")}`,
    );
  }
  return value;
}

export function parseLedgerLimit(raw: string | undefined): number {
  const value = raw?.trim() ?? "";
  if (!value) return PAYMENT_LEDGER_DEFAULT_LIMIT;
  if (!/^\d+$/.test(value)) {
    throw new PaymentLedgerInputError(
      `limit 需为 1-${PAYMENT_LEDGER_MAX_LIMIT} 的整数`,
    );
  }
  const limit = Number(value);
  if (limit < 1 || limit > PAYMENT_LEDGER_MAX_LIMIT) {
    throw new PaymentLedgerInputError(
      `limit 需为 1-${PAYMENT_LEDGER_MAX_LIMIT} 的整数`,
    );
  }
  return limit;
}

export function parseLedgerPage(raw: string | undefined): number {
  const value = raw?.trim() ?? "";
  if (!value) return 1;
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new PaymentLedgerInputError("page 需为 ≥1 的整数");
  }
  return Number(value);
}

/** 排序默认「创建时间倒序」——台账最先要看最近发生的。 */
export function parseLedgerSort(
  rawField: string | undefined,
  rawDir: string | undefined,
): { sortBy: PaymentLedgerSortField; sortDir: "asc" | "desc" } {
  const field = (rawField?.trim() ?? "") || "createdAt";
  if (!(PAYMENT_LEDGER_SORT_FIELDS as readonly string[]).includes(field)) {
    throw new PaymentLedgerInputError(
      `sortBy 只能是 ${PAYMENT_LEDGER_SORT_FIELDS.join(" / ")}`,
    );
  }
  const dir = (rawDir?.trim() ?? "") || "desc";
  if (dir !== "asc" && dir !== "desc") {
    throw new PaymentLedgerInputError("sortDir 只能是 asc / desc");
  }
  return { sortBy: field as PaymentLedgerSortField, sortDir: dir };
}

/** 关键词搜索（单号或客户名）：只做长度保护，具体匹配交给仓储的 contains。 */
export function parseLedgerSearch(raw: string | undefined): string | null {
  const value = raw?.trim() ?? "";
  if (!value) return null;
  if (value.length > PAYMENT_LEDGER_SEARCH_MAX_LENGTH) {
    throw new PaymentLedgerInputError(
      `关键词最多 ${PAYMENT_LEDGER_SEARCH_MAX_LENGTH} 个字符`,
    );
  }
  return value;
}

/** 金额一律输出**十进制字符串分**（仓库约定：禁止把分变成 number）。 */
export function toLedgerRowView(row: PaymentLedgerRow): PaymentLedgerRowView {
  const refundableFen =
    row.amountFen > row.refundedFen ? row.amountFen - row.refundedFen : 0n;
  return {
    id: row.id,
    outNo: row.outNo,
    amountFen: row.amountFen.toString(),
    refundedFen: row.refundedFen.toString(),
    refundableFen: refundableFen.toString(),
    canRefund: row.status === "SUCCESS" && refundableFen > 0n,
    status: row.status,
    customerProfileId: row.customerProfileId,
    customerName: row.customerName,
    createdAt: row.createdAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
  };
}

/**
 * 台账 CSV（Excel 直接可开）：带 UTF-8 BOM，金额列输出**元**（两位小数，整数运算）。
 * 字段一律交给共享 `toUtf8BomCsv` 转义：RFC 引号规则（逗号/引号/换行加引号并翻倍引号）
 * 加上公式注入防护（`=`/`+`/`-`/`@` 开头的客户名或单号不能变成公式）——两套台账共用同一口径。
 */
export function toLedgerCsv(rows: readonly PaymentLedgerRowView[]): string {
  const header = [
    "支付单号",
    "客户",
    "状态",
    "支付金额(元)",
    "已退(元)",
    "可退(元)",
    "创建时间",
    "支付时间",
  ];
  const body = rows.map((row) => [
    row.outNo,
    row.customerName ?? "",
    row.status,
    fenToYuanText(row.amountFen),
    fenToYuanText(row.refundedFen),
    fenToYuanText(row.refundableFen),
    row.createdAt,
    row.paidAt ?? "",
  ]);
  return toUtf8BomCsv([header, ...body]);
}

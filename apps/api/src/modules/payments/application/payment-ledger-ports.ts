/**
 * S5-1：门店支付台账的仓储端口（ADR-0008 的数据表格壳要求**服务端**分页/排序/筛选）。
 *
 * 为什么搬到服务端：表格壳支持几万行、列排序、按列筛选，前端一次拉全再排会随数据量线性变慢，
 * 而且导出必须走服务端（大表不能在浏览器里拼）。所以口径是：**排序/筛选/分页参数由服务端解释**，
 * 前端只负责把用户操作翻译成参数。
 */

/** 允许排序的字段（白名单）：只放真实列，且都是 `payment_orders` 自己的列（关系列排序要 join，本片不做）。 */
export const PAYMENT_LEDGER_SORT_FIELDS = [
  "createdAt",
  "paidAt",
  "amountFen",
  "status",
  "outNo",
] as const;

export type PaymentLedgerSortField =
  (typeof PAYMENT_LEDGER_SORT_FIELDS)[number];

export interface PaymentLedgerRow {
  id: string;
  outNo: string;
  amountFen: bigint;
  /** 该支付单累计**已登记成功**的退款（分）。 */
  refundedFen: bigint;
  status: string;
  customerProfileId: string;
  customerName: string | null;
  createdAt: Date;
  paidAt: Date | null;
}

export interface PaymentLedgerQuery {
  tenantId: string;
  /** 仅 `PENDING` / `SUCCESS` / `FAILED` 允许过滤；`undefined` = 不过滤。 */
  status?: string;
  /** 关键词：支付单号**或**客户名，包含匹配（大小写不敏感）。 */
  q?: string;
  sortBy: PaymentLedgerSortField;
  sortDir: "asc" | "desc";
  /** 1 起算。 */
  page: number;
  pageSize: number;
}

export interface PaymentLedgerRepository {
  /** 最近创建的支付单在前；调用方已把 `pageSize` 收在服务端上限内。 */
  listOrders(query: PaymentLedgerQuery): Promise<PaymentLedgerRow[]>;
  /** 同一套筛选条件下的总行数（分页器要用，且不能被 pageSize 影响）。 */
  countOrders(
    query: Pick<PaymentLedgerQuery, "tenantId" | "status" | "q">,
  ): Promise<number>;
}

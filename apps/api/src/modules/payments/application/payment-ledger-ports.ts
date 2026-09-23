/**
 * S4-7：门店支付台账的仓储端口（接口隔离，便于单测注入假实现，与 refund-ports 同范式）。
 *
 * 为什么要有它：客户在 H5 充完值，门店只看得到"钱包余额涨了"，**看不到支付单本身**——
 * 单号、支付金额、已退多少、微信侧状态全在平台库里。而人工退款登记的第一步就是
 * "找到那张支付单"（`out_refund_no` 之外的 `outNo` 必须由门店提供），所以台账是退款的前置能力。
 */

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
  limit: number;
}

export interface PaymentLedgerRepository {
  /** 最近创建的支付单在前；调用方已把 `limit` 收在服务端上限内。 */
  listOrders(query: PaymentLedgerQuery): Promise<PaymentLedgerRow[]>;
}

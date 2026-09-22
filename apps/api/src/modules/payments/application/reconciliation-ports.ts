/** S4-3b：对账所需仓储端口（接口隔离，避免牵动回调/下单两处的既有假实现）。 */

export interface ReconcileTarget {
  tenantId: string;
  subMchid: string;
}

export interface LocalPaymentOrder {
  id: string;
  outNo: string;
  amountFen: bigint;
  status: string;
  transactionId: string | null;
}

export interface ReconciliationRepository {
  /** 需要daily对账的门店（子商户 ACTIVE）。 */
  listReconcileTargets(): Promise<ReconcileTarget[]>;
  /** 本地支付单：按支付成功时间落在该自然日内（北京时间）。 */
  findLocalOrders(
    tenantId: string,
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<LocalPaymentOrder[]>;
  /**
   * 落账单记录。`(tenant, billType, billDate, subMchid)` 唯一：
   * inserted=false 表示这份账单已经对过（幂等，避免重复记差异）。
   */
  saveStatement(input: {
    tenantId: string;
    subMchid: string;
    billType: string;
    billDate: string;
    fileSha256: string;
    totalCount: number;
    totalFen: bigint;
  }): Promise<{ id: string; inserted: boolean }>;
  recordDifferences(
    inputs: Array<{
      tenantId: string;
      kind: string;
      paymentOrderId?: string;
      amountFen?: bigint;
      detail: string;
    }>,
  ): Promise<void>;
}

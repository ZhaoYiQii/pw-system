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
  /**
   * 落对账差异。每条差异在**同一个租户事务内**用嵌套写入同时创建一张 `OPEN` 处理单：
   * 差异与处理单要么一起成功、要么一起回滚，不会留下「有差异却没有处理单」的新数据。
   *
   * 处理单状态取数据库默认值（`OPEN`）；系统自动建单不写审计行、不改差异的比较口径与幂等语义，
   * 也**不做历史补齐**——列表接口只读，不会顺手补单。
   */
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

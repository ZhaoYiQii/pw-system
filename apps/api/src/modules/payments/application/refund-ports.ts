/** S4-4：人工退款登记的仓储端口（接口隔离，避免牵动其它服务的假实现）。 */

export interface RefundOrderRecord {
  id: string;
  outNo: string;
  amountFen: bigint;
  status: string;
  customerProfileId: string;
  /** 已登记成功的退款合计（分）。 */
  refundedFen: bigint;
}

export interface ManualRefundResult {
  refundId: string;
  outRefundNo: string;
  amountFen: bigint;
  /** 该支付单累计已退（含本次）。 */
  refundedFen: bigint;
  /** 扣款后的钱包余额（分）。 */
  walletBalanceFen: bigint;
  /** 累计退款已达支付金额（支付单状态保持 SUCCESS；退款事实以 payment_refunds 为准）。 */
  fullyRefunded: boolean;
}

export interface ManualRefundRepository {
  findOrderForRefund(
    tenantId: string,
    input: { outNo?: string; orderId?: string },
  ): Promise<RefundOrderRecord | null>;
  /**
   * 登记退款：写 `payment_refunds` + 扣减钱包余额 + 钱包流水 + 审计，**同一事务内完成**；
   * `(tenant_id, out_refund_no)` 唯一约束保证重复提交不会重复扣钱。
   *
   * 失败语义（由实现抛出，服务层负责翻译成对用户可读的错误）：
   * - 退款单已存在 → `DuplicateRefundError`（携带已存在的那笔）；
   * - 钱包余额不足 → `InsufficientWalletBalanceError`（携带余额与本次金额）。
   */
  applyManualRefund(input: {
    tenantId: string;
    orderId: string;
    customerProfileId: string;
    orderAmountFen: bigint;
    amountFen: bigint;
    reason: string;
    operatorAccountId: string;
    outRefundNo: string;
  }): Promise<ManualRefundResult>;
}

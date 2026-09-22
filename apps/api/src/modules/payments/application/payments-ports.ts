/** S4-2：支付回调管线用到的仓储端口（便于单测注入假实现，与 identity-access 的 AuthRepository 同范式）。 */

export interface NewInboxEvent {
  provider: string;
  eventId: string;
  eventType: string | null;
  headers: Record<string, string>;
  rawBody: string;
  signatureVerified: boolean;
}

export interface InboxEventRecord {
  id: string;
  provider: string;
  eventId: string;
  eventType: string | null;
  rawBody: string;
}

export interface PaymentOrderRecord {
  id: string;
  tenantId: string;
  customerProfileId: string;
  amountFen: bigint;
  status: string;
  transactionId: string | null;
  providerRef: string | null;
}

export interface SettleResult {
  /** true=本次真的入账了；false=幂等跳过（已支付过或状态守卫未命中）。 */
  credited: boolean;
  /** credited=true 时的入账后余额（分），用于日志与断言。 */
  balanceAfterFen?: bigint;
}

export interface PaymentsRepository {
  /** 落回调收件箱；**重复事件**（provider+event_id 已存在）返回 null，由调用方当作幂等成功。 */
  saveInboxEvent(input: NewInboxEvent): Promise<{ id: string } | null>;
  listUnprocessedInbox(limit: number): Promise<InboxEventRecord[]>;
  markInboxProcessed(id: string, processedAt: Date): Promise<void>;
  /** 全局按商户单号找支付单（回调里没有租户信息，用平台连接查）。 */
  findPaymentOrderByOutNo(outNo: string): Promise<PaymentOrderRecord | null>;
  /** 租户上下文内入账：锁钱包 → 加余额 → 写流水 → 更新支付单 → 审计。 */
  settlePaymentOrder(input: {
    tenantId: string;
    orderId: string;
    transactionId: string;
    paidAt: Date;
    reason: string;
  }): Promise<SettleResult>;
  recordDifference(input: {
    tenantId: string;
    kind: string;
    paymentOrderId?: string;
    amountFen?: bigint;
    detail: string;
  }): Promise<void>;
}

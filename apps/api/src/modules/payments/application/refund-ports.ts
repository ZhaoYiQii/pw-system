import type { RefundStatus } from "../domain/refund-confirmation-state.js";

/**
 * DS-005：人工退款的仓储端口。
 *
 * 两步事实流（不是微信退款 API）：**登记申请 ≠ 已退款**。
 * - `createPendingManualRefund()`：只登记申请，**不动任何资金**；
 * - `confirmManualRefund()`：财务确认门店已实际退款后，才扣钱包、写总账冲销。
 *
 * 端口方法名刻意区分这两步，避免再出现「调用一个方法就完成登记+扣款」的语义含混入口。
 */

export interface RefundOrderRecord {
  id: string;
  outNo: string;
  amountFen: bigint;
  status: string;
  customerProfileId: string;
  /**
   * 已**占用**的退款额度（分）= `PENDING_CONFIRMATION` + `SUCCEEDED` 的累计金额。
   *
   * 待确认也要占用：否则同一张支付单可以开出多张待确认申请、合计超过原支付金额，
   * 等逐一确认时才发现超退，那时钱已经退出去了。被拒/撤销的申请不占用，额度自动释放。
   */
  occupiedFen: bigint;
}

/**
 * 登记结果：这笔退款**只是申请**，钱还没退。
 * 金额一律 bigint（整数分），由控制器转成十进制字符串。
 */
export interface ManualRefundRequestResult {
  refundId: string;
  outRefundNo: string;
  /** 登记后可取值；新建恒为 `PENDING_CONFIRMATION`；幂等重放返回该单当前真实状态。 */
  status: RefundStatus;
  amountFen: bigint;
  /** 该支付单累计**已确认**（SUCCEEDED）的退款；本笔待确认申请不计入。 */
  refundedFen: bigint;
  /** 当前**真实**钱包余额：登记不动钱，所以这是未扣减的余额，不得伪造成「已扣后余额」。 */
  walletBalanceFen: bigint;
  /** 累计已确认退款是否已达原支付金额。 */
  fullyRefunded: boolean;
}

/** 确认结果：钱已实际退回客户，钱包与总账同事务冲销完毕。 */
export interface ManualRefundConfirmationResult {
  refundId: string;
  outRefundNo: string;
  /** 确认后恒为 `SUCCEEDED`。 */
  status: RefundStatus;
  amountFen: bigint;
  /** 该支付单累计**已确认**的退款（含本笔）。 */
  refundedFen: bigint;
  /** 本次扣减后的钱包余额（分）。 */
  walletBalanceFen: bigint;
  /** 累计已确认退款是否已达原支付金额。 */
  fullyRefunded: boolean;
}

export interface ManualRefundRepository {
  findOrderForRefund(
    tenantId: string,
    input: { outNo?: string; orderId?: string },
  ): Promise<RefundOrderRecord | null>;

  /**
   * 登记退款申请：写 `payment_refunds`（`PENDING_CONFIRMATION`）+ 审计，**同一事务内完成**；
   * `(tenant_id, out_refund_no)` 唯一约束保证重复提交不会产生第二张申请。
   *
   * 实现**必须**在同一事务内锁住支付单行，且**先识别幂等重试、再复核额度**：
   * 1. 先按 `(tenant_id, out_refund_no)` 查重，命中即 `DuplicateRefundError`——重试的那张
   *    申请自身正占用额度，若先复核额度会把合法重试误判成超退（支付 12800、首次登记 8000
   *    后同键重试 8000，可退只剩 4800）；
   * 2. 仅在确认是新申请后才复核可退额度（支付金额 − `PENDING_CONFIRMATION + SUCCEEDED`
   *    的累计占用）：服务层的额度校验发生在另一个事务里，只挡顺序提交；并发登记会各自
   *    读到「占用 0」而都通过，合计超过原支付金额。
   * 3. 插入仍应依赖 `(tenant_id, out_refund_no)` 唯一约束兜底并发抢跑。
   * 支付金额以锁住的那一行为准，**不得**信任调用方传来的金额。
   *
   * 明确**不写**钱包、钱包流水、总账交易或总账分录——登记不是退款事实。
   *
   * 失败语义（由实现抛出，服务层负责翻译成对用户可读的错误）：
   * - 退款单已存在 → `DuplicateRefundError`（携带已存在的那笔）；
   * - 支付单不存在 → `RefundInputError`（HTTP 400）；
   * - 事务内复核发现超过可退余额 → `RefundNotAllowedError`（HTTP 409）。
   */
  createPendingManualRefund(input: {
    tenantId: string;
    orderId: string;
    customerProfileId: string;
    amountFen: bigint;
    reason: string;
    operatorAccountId: string;
    outRefundNo: string;
  }): Promise<ManualRefundRequestResult>;

  /**
   * 确认实际退款：单一租户事务内
   * ① 状态守卫把退款单从 `PENDING_CONFIRMATION` 原子转 `SUCCEEDED`；
   * ② 锁客户钱包、扣减余额、写 `wallet_entries`；
   * ③ 写唯一退款确认总账（借客户预收款、贷原支付资金账户）与两条分录；
   * ④ 写审计。任何一步失败，状态、钱包、分录、审计**全部回滚**。
   *
   * 失败语义（由实现抛出，服务层负责翻译成对用户可读的错误）：
   * - 退款单不存在 → `RefundInputError`（HTTP 400）；
   * - 状态不是 `PENDING_CONFIRMATION`（含重复确认）→ `RefundStatusTransitionError`（HTTP 409）；
   * - 钱包余额不足 → `InsufficientWalletBalanceError`（HTTP 409）；
   * - 找不到原支付成功总账交易 → `OriginalPaymentPostingMissingError`（需人工核对入账）。
   *
   * 该方法**永不**把重复确认当幂等成功：已确认的单必须报冲突，绝不二次扣款。
   */
  confirmManualRefund(input: {
    tenantId: string;
    refundId: string;
    evidenceRef: string;
    operatorAccountId: string;
    confirmedAt: Date;
  }): Promise<ManualRefundConfirmationResult>;
}

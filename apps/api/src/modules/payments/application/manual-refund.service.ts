import { createHash, randomBytes } from "node:crypto";
import type {
  ManualRefundRepository,
  ManualRefundResult,
} from "./refund-ports.js";
import {
  RefundInputError,
  RefundInsufficientBalanceError,
  RefundNotAllowedError,
} from "../domain/payments.errors.js";

/**
 * S4-4：**人工退款登记**（不是微信退款 API）。
 *
 * 口径（用户已批准的最小方案）：首版不调微信退款接口——钱由门店在自己的商户号/收款渠道退回客户，
 * 平台只负责**把"这笔退了"记进系统**，否则客户钱包余额与事实不符，对账也发现不了。
 *
 * 三条硬规则：
 * 1. 只有 `SUCCESS`（已支付）的支付单能登记退款，且**累计退款不得超过支付金额**
 *    （全额退过的单"可退 0 分"，会被同一条规则挡住——支付单状态不因退款改变）；
 * 2. 退款必须能从客户钱包余额里扣出来，**不允许把余额扣成负数**（不够就报错要求人工核对）；
 * 3. 重复提交用幂等键挡住：同一个 `idempotencyKey`（同一张支付单）生成同一个 `out_refund_no`，
 *    唯一约束保证只扣一次钱，重复提交返回已存在的那笔（`duplicate=true`）。
 */
export class ManualRefundService {
  constructor(private readonly repository: ManualRefundRepository) {}

  async register(input: {
    tenantId: string;
    operatorAccountId: string;
    outNo?: string;
    orderId?: string;
    amountFen: bigint;
    reason: string;
    idempotencyKey?: string;
  }): Promise<{ refund: ManualRefundResult; duplicate: boolean }> {
    if (input.amountFen <= 0n) throw new RefundInputError("退款金额需大于 0");
    if (!input.outNo && !input.orderId) {
      throw new RefundInputError("需要提供 outNo 或 orderId");
    }
    const reason = input.reason.trim();
    if (!reason) throw new RefundInputError("必须填写退款原因");

    const order = await this.repository.findOrderForRefund(input.tenantId, {
      ...(input.outNo ? { outNo: input.outNo } : {}),
      ...(input.orderId ? { orderId: input.orderId } : {}),
    });
    if (!order) throw new RefundInputError("支付单不存在");
    if (order.status !== "SUCCESS") {
      throw new RefundNotAllowedError(
        `只有已支付的支付单可以登记退款（当前状态 ${order.status}）`,
      );
    }
    const remainingFen = order.amountFen - order.refundedFen;
    if (input.amountFen > remainingFen) {
      throw new RefundNotAllowedError(
        `退款金额超过可退余额（可退 ${remainingFen} 分，本次 ${input.amountFen} 分）`,
      );
    }

    const outRefundNo = buildOutRefundNo(input.idempotencyKey, order.id);
    try {
      const refund = await this.repository.applyManualRefund({
        tenantId: input.tenantId,
        orderId: order.id,
        customerProfileId: order.customerProfileId,
        orderAmountFen: order.amountFen,
        amountFen: input.amountFen,
        reason,
        operatorAccountId: input.operatorAccountId,
        outRefundNo,
      });
      return { refund, duplicate: false };
    } catch (error) {
      if (error instanceof DuplicateRefundError) {
        // 幂等键重复：返回已经登记好的那笔，不再扣钱
        return { refund: error.existing, duplicate: true };
      }
      if (error instanceof InsufficientWalletBalanceError) {
        throw new RefundInsufficientBalanceError(
          `客户钱包余额不足（余额 ${error.balanceFen} 分，本次退款 ${error.requiredFen} 分），请先人工核对账目`,
        );
      }
      throw error;
    }
  }
}

/** 仓储在唯一冲突时抛出（携带已存在的那笔）。 */
export class DuplicateRefundError extends Error {
  constructor(readonly existing: ManualRefundResult) {
    super("refund already registered");
    this.name = "DuplicateRefundError";
  }
}

/** 仓储在余额不足时抛出（带上两个数字，便于拼出可读错误）。 */
export class InsufficientWalletBalanceError extends Error {
  constructor(
    readonly balanceFen: bigint,
    readonly requiredFen: bigint,
  ) {
    super("insufficient wallet balance");
    this.name = "InsufficientWalletBalanceError";
  }
}

/**
 * 商户退款单号（`out_refund_no`）：微信要求"同一子商户号下唯一、字母数字、1-64 字符"。
 *
 * - 有幂等键：用 `paymentOrderId + idempotencyKey` 的 SHA-256 前缀，**确定性**——重复提交得到同一个单号，
 *   撞唯一约束即证明"这笔已经登记过"。把支付单号一起入哈希，避免同一个键被复用到别的订单时
 *   静默返回别人的退款单。
 * - 无幂等键：时间戳+随机（每次都是一笔新退款；超退由"累计不超过支付金额"那条规则拦住）。
 */
export function buildOutRefundNo(
  idempotencyKey: string | undefined,
  paymentOrderId: string,
): string {
  const key = idempotencyKey?.trim();
  if (key) {
    const digest = createHash("sha256")
      .update(`${paymentOrderId}:${key}`, "utf8")
      .digest("hex")
      .slice(0, 24)
      .toUpperCase();
    return `MR${digest}`;
  }
  return `MR${Date.now().toString(36).toUpperCase()}${randomBytes(4)
    .toString("hex")
    .toUpperCase()}`;
}

import { createHash, randomBytes } from "node:crypto";
import type {
  ManualRefundConfirmationResult,
  ManualRefundRepository,
  ManualRefundRequestResult,
} from "./refund-ports.js";
import {
  RefundInputError,
  RefundInsufficientBalanceError,
  RefundNotAllowedError,
} from "../domain/payments.errors.js";

/**
 * 门店实际退款凭据号的安全字符集：只允许字母、数字、下划线与连字符，长度 1–64。
 * 它会被写进 `payment_refunds.refund_id` 并出现在查询/日志里，所以**不接受**自由文本：
 * 空格、斜杠、点号、中文与控制字符一律拒绝，避免把卡号、客户信息或路径片段塞进来。
 */
const EVIDENCE_REF_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * 数据库 uuid 主键的形状（退款单号 `payment_refunds.id`、支付单号 `payment_orders.id`）。
 * 格式不对必须在服务层拦成 400：放行到 Prisma 会抛 uuid 解析错误
 * （「Inconsistent column data」），把客户端的输入错误伪装成服务端 500，
 * 同时让客户端原始字符串落进服务端错误日志（多行内容可伪造日志行）。
 */
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * DS-005：**人工退款的两步事实流**（不是微信退款 API）。
 *
 * 口径（用户已批准）：首版不调微信退款接口——钱由门店在自己的商户号/收款渠道退回客户，
 * 平台只在**财务确认门店确实已退款之后**记录资金事实。因此拆成两步：
 *
 * 1. `register()` 只登记**申请**：写退款单（`PENDING_CONFIRMATION`）与审计，
 *    **不扣钱包、不写钱包流水、不写总账**。退款申请不是退款事实。
 * 2. `confirm()` 才登记**事实**：校验门店退款凭据号后，由仓储在同一事务内
 *    把状态转成 `SUCCEEDED` + 扣钱包 + 写钱包流水 + 总账冲销 + 审计。
 *
 * 三条硬规则（登记路径）：
 * 1. 只有 `SUCCESS`（已支付）的支付单能登记退款，且**累计占用（待确认 + 已确认）不得超过支付金额**；
 *    待确认也占额度，否则同一张单可以开出多张申请、合计超过原支付金额。
 * 2. 幂等键挡住重复提交：同一个 `idempotencyKey`（同一张支付单）生成同一个 `out_refund_no`，
 *    唯一约束保证只产生一张申请，重复提交返回已存在的那张（`duplicate=true`）。
 *    **识别重试必须早于额度校验**：重试的那张申请自己就占着额度，先校验会把合法重试误判成超退。
 * 3. 确认路径**永不**幂等：已确认的单再次确认必须报冲突，绝不二次扣款。
 */
export class ManualRefundService {
  constructor(private readonly repository: ManualRefundRepository) {}

  /** 登记退款申请：只写申请与审计，不动任何资金。 */
  async register(input: {
    tenantId: string;
    operatorAccountId: string;
    outNo?: string;
    orderId?: string;
    amountFen: bigint;
    reason: string;
    idempotencyKey?: string;
  }): Promise<{ refund: ManualRefundRequestResult; duplicate: boolean }> {
    if (input.amountFen <= 0n) throw new RefundInputError("退款金额需大于 0");
    if (!input.outNo && !input.orderId) {
      throw new RefundInputError("需要提供 outNo 或 orderId");
    }
    const reason = input.reason.trim();
    if (!reason) throw new RefundInputError("必须填写退款原因");
    // orderId 会直接进 uuid 列（`id = ${...}::uuid`），形状与退款单号同一口径校验；
    // outNo 是 TEXT 列，不做形状限制。
    const orderId = input.orderId?.trim();
    if (orderId && !UUID_PATTERN.test(orderId)) {
      throw new RefundInputError("支付单号格式不正确");
    }

    const order = await this.repository.findOrderForRefund(input.tenantId, {
      ...(input.outNo ? { outNo: input.outNo } : {}),
      ...(orderId ? { orderId } : {}),
    });
    if (!order) throw new RefundInputError("支付单不存在");
    if (order.status !== "SUCCESS") {
      throw new RefundNotAllowedError(
        `只有已支付的支付单可以登记退款（当前状态 ${order.status}）`,
      );
    }
    // 幂等键决定 out_refund_no 是否确定性，也决定这里能不能做额度快速校验：
    // - 有键：同一个键重试的是**同一张**申请，那张申请本身正占着额度。此时拿
    //   「支付金额 − 已占用」去比它，必然把合法重试判成超退（支付 12800、首次登记 8000 →
    //   可退只剩 4800，重试仍是 8000）。所以有键时**不预判**，交给
    //   createPendingManualRefund：它在事务里先识别重试、只对真正的新申请复核额度。
    // - 无键：每次都是新申请，可以放心快速失败并给出可读文案。
    // 两边都不是权威判定：真正权威的复核在仓储事务内（锁支付单行后重新核算），
    // 因为它和写库在同一个事务里，并发登记也拦得住。
    const idempotencyKey = input.idempotencyKey?.trim() ?? "";
    const outRefundNo = buildOutRefundNo(idempotencyKey, order.id);
    if (!idempotencyKey) {
      const remainingFen = order.amountFen - order.occupiedFen;
      if (input.amountFen > remainingFen) {
        throw new RefundNotAllowedError(
          `退款金额超过可退余额（可退 ${remainingFen} 分，本次 ${input.amountFen} 分）`,
        );
      }
    }

    try {
      const refund = await this.repository.createPendingManualRefund({
        tenantId: input.tenantId,
        orderId: order.id,
        customerProfileId: order.customerProfileId,
        amountFen: input.amountFen,
        reason,
        operatorAccountId: input.operatorAccountId,
        outRefundNo,
      });
      return { refund, duplicate: false };
    } catch (error) {
      if (error instanceof DuplicateRefundError) {
        // 幂等键重复：返回已经登记好的那张申请，不产生第二张
        return { refund: error.existing, duplicate: true };
      }
      throw error;
    }
  }

  /**
   * 确认门店已实际退款：凭据号合法后交给仓储，在同一事务内完成
   * 状态流转 + 扣钱包 + 钱包流水 + 总账冲销 + 审计。
   *
   * 幂等语义与登记**相反**：登记重复提交返回同一张申请；确认重复提交必须报冲突。
   * 因此这里没有 `duplicate` 成功分支，重复确认会以状态机错误上抛（HTTP 409）。
   */
  async confirm(input: {
    tenantId: string;
    operatorAccountId: string;
    refundId: string;
    evidenceRef: string;
  }): Promise<{ refund: ManualRefundConfirmationResult; duplicate: false }> {
    const refundId = input.refundId.trim();
    if (!refundId) throw new RefundInputError("缺少退款单号");
    if (!UUID_PATTERN.test(refundId)) {
      throw new RefundInputError("退款单号格式不正确");
    }

    // 先裁空白再校验：门店填的凭据号常带空格，但**不做**其它宽松化处理
    const evidenceRef = input.evidenceRef.trim();
    if (!EVIDENCE_REF_PATTERN.test(evidenceRef)) {
      throw new RefundInputError(
        "退款凭据号必填，且只能是 1–64 位字母、数字、下划线或连字符",
      );
    }

    try {
      const refund = await this.repository.confirmManualRefund({
        tenantId: input.tenantId,
        refundId,
        evidenceRef,
        operatorAccountId: input.operatorAccountId,
        confirmedAt: new Date(),
      });
      return { refund, duplicate: false };
    } catch (error) {
      if (error instanceof InsufficientWalletBalanceError) {
        throw new RefundInsufficientBalanceError(
          `客户钱包余额不足（余额 ${error.balanceFen} 分，本次退款 ${error.requiredFen} 分），请先人工核对账目`,
        );
      }
      // 状态冲突（已确认/已撤销）、找不到原支付总账等一律如实上抛，不吞、不改写
      throw error;
    }
  }
}

/** 仓储在唯一冲突时抛出（携带已存在的那张申请）。 */
export class DuplicateRefundError extends Error {
  constructor(readonly existing: ManualRefundRequestResult) {
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
 *   撞唯一约束即证明"这张申请已经登记过"。把支付单号一起入哈希，避免同一个键被复用到别的订单时
 *   静默返回别人的退款单。
 * - 无幂等键：时间戳+随机（每次都是一张新申请；超退由"累计占用不超过支付金额"那条规则拦住）。
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

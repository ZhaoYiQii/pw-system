import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { parseAmountFen } from "../domain/amount.js";
import {
  RefundInputError,
  RefundInsufficientBalanceError,
  RefundNotAllowedError,
} from "../domain/payments.errors.js";
import { RefundStatusTransitionError } from "../domain/refund-confirmation-state.js";
import { ManualRefundService } from "../application/manual-refund.service.js";

/**
 * DS-005：**人工退款两步事实流**端点（老板/财务在后台记账用）。不是微信退款 API：
 * 钱由门店在自己的商户号退回客户，平台只在财务确认「钱确实退了」之后记录资金事实。
 *
 * 1. `POST manual`：登记退款申请（`PENDING_CONFIRMATION`），**不动任何资金**；
 * 2. `POST manual/:refundId/confirm`：财务凭门店退款凭据号确认，才扣钱包 + 冲销总账。
 *
 * 两个端点都是财务操作，要求 `finance.manage`（老板 / 财务角色持有）。
 * 租户与操作人一律取自登录态（`req.principal`），**从不**接受客户端传来的 tenantId。
 */
@Controller("api/v1/payments/refunds")
export class WechatPayRefundController {
  constructor(
    @Inject(ManualRefundService)
    private readonly refunds: ManualRefundService,
  ) {}

  @TenantScope()
  @Permissions("finance.manage")
  @Post("manual")
  async registerManual(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      outNo?: unknown;
      orderId?: unknown;
      amountFen?: unknown;
      reason?: unknown;
      idempotencyKey?: unknown;
    },
  ) {
    const tenantId = req.principal?.tenantId;
    const operatorAccountId = req.principal?.sub;
    if (!tenantId || !operatorAccountId) {
      throw new HttpException(
        "tenant context missing",
        HttpStatus.UNAUTHORIZED,
      );
    }
    const amountFen = parseAmountFen(body.amountFen);
    if (amountFen === null) {
      throw new HttpException(
        "amountFen 必填且为正整数字符串/数字",
        HttpStatus.BAD_REQUEST,
      );
    }
    const outNo = typeof body.outNo === "string" ? body.outNo.trim() : "";
    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason : "";
    const idempotencyKey =
      typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined;

    try {
      const { refund, duplicate } = await this.refunds.register({
        tenantId,
        operatorAccountId,
        ...(outNo ? { outNo } : {}),
        ...(orderId ? { orderId } : {}),
        amountFen,
        reason,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });
      return {
        data: {
          refundId: refund.refundId,
          outRefundNo: refund.outRefundNo,
          // 登记结果恒为 PENDING_CONFIRMATION；幂等重放时是那张单的**当前真实状态**
          status: refund.status,
          amountFen: refund.amountFen.toString(),
          // 登记不动钱：这是该单累计**已确认**的退款（本笔待确认不计入），
          // 以及**真实**未扣减的钱包余额，不得伪造成「已扣后余额」
          refundedFen: refund.refundedFen.toString(),
          walletBalanceFen: refund.walletBalanceFen.toString(),
          fullyRefunded: refund.fullyRefunded,
          // 幂等命中：这次没有产生第二张申请，返回的是之前登记好的那笔
          duplicate,
        },
      };
    } catch (error) {
      if (error instanceof RefundInputError) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      if (error instanceof RefundNotAllowedError) {
        // 409：状态或可退余额不允许（未支付 / 超过可退额度）
        throw new HttpException(error.message, HttpStatus.CONFLICT);
      }
      if (error instanceof RefundInsufficientBalanceError) {
        // 409：钱包扣不动，需要人工核对账目，绝不把余额扣成负数
        throw new HttpException(error.message, HttpStatus.CONFLICT);
      }
      throw error;
    }
  }

  @TenantScope()
  @Permissions("finance.manage")
  @Post("manual/:refundId/confirm")
  async confirmManual(
    @Req() req: AuthenticatedRequest,
    @Param("refundId") refundId: string,
    @Body() body: { evidenceRef?: unknown },
  ) {
    const tenantId = req.principal?.tenantId;
    const operatorAccountId = req.principal?.sub;
    if (!tenantId || !operatorAccountId) {
      throw new HttpException(
        "tenant context missing",
        HttpStatus.UNAUTHORIZED,
      );
    }
    // 只接受字符串：数组/对象/数字一律 400。凭据号的字符集与长度由服务层统一校验，
    // 这里**不**做类型断言式放行（断言在运行时会被绕过，等于没校验）。
    if (typeof body?.evidenceRef !== "string") {
      throw new HttpException(
        "evidenceRef 必填，且只能是 1–64 位字母、数字、下划线或连字符",
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const { refund } = await this.refunds.confirm({
        tenantId,
        operatorAccountId,
        refundId,
        evidenceRef: body.evidenceRef,
      });
      return {
        data: {
          refundId: refund.refundId,
          outRefundNo: refund.outRefundNo,
          status: refund.status,
          amountFen: refund.amountFen.toString(),
          refundedFen: refund.refundedFen.toString(),
          walletBalanceFen: refund.walletBalanceFen.toString(),
          fullyRefunded: refund.fullyRefunded,
          // 确认路径**永不**幂等：重复确认会走到下面的 409，不会返回 duplicate=true
          duplicate: false,
        },
      };
    } catch (error) {
      if (error instanceof RefundInputError) {
        // 400：退款单不存在、退款单号格式不对、凭据号非法
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      if (error instanceof RefundStatusTransitionError) {
        // 409：当前状态不可确认（含重复确认）。绝不降级成幂等成功，绝不二次扣款
        throw new HttpException(error.message, HttpStatus.CONFLICT);
      }
      if (error instanceof RefundNotAllowedError) {
        throw new HttpException(error.message, HttpStatus.CONFLICT);
      }
      if (error instanceof RefundInsufficientBalanceError) {
        // 409：钱包扣不动，需要人工核对账目
        throw new HttpException(error.message, HttpStatus.CONFLICT);
      }
      // OriginalPaymentPostingMissingError 等数据一致性问题不在此翻译：如实 500，
      // 由人工按消息核对该支付单是否已入账，不伪装成「客户端错误」让人以为改参数就能过。
      throw error;
    }
  }
}

import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Inject,
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
import { ManualRefundService } from "../application/manual-refund.service.js";

/**
 * S4-4：**人工退款登记**端点（老板/财务在后台记账用）。
 *
 * 为什么不是"/refund 调微信退款"：首版不调微信退款接口——钱由门店在自己的商户号退回客户，
 * 平台把这次退款记进系统（扣钱包 + 流水 + 审计），保证余额与账目一致。
 * 语义上属于财务操作，所以要求 `finance.manage`（老板 / 财务角色持有）。
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
          amountFen: refund.amountFen.toString(),
          refundedFen: refund.refundedFen.toString(),
          walletBalanceFen: refund.walletBalanceFen.toString(),
          fullyRefunded: refund.fullyRefunded,
          // 幂等命中：这次没有再扣钱，返回的是之前登记好的那笔
          duplicate,
        },
      };
    } catch (error) {
      if (error instanceof RefundInputError) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      if (error instanceof RefundNotAllowedError) {
        // 409：状态或可退金额不允许（未支付 / 已全额退 / 超过可退余额）
        throw new HttpException(error.message, HttpStatus.CONFLICT);
      }
      if (error instanceof RefundInsufficientBalanceError) {
        // 409：钱包扣不动，需要人工核对账目，绝不把余额扣成负数
        throw new HttpException(error.message, HttpStatus.CONFLICT);
      }
      throw error;
    }
  }
}

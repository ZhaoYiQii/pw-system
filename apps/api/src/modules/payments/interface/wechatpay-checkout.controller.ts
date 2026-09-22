import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
} from "@nestjs/common";
import { TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { WechatPayCheckoutService } from "../application/wechatpay-checkout.service.js";
import {
  PrepayInputError,
  TenantPaymentNotReadyError,
  WechatPayDisabledError,
  WechatPayerNotBoundError,
} from "../domain/payments.errors.js";

/** S4-2c：客户在 H5 里发起充值 → 服务端用**门店的子商户号**下单 → 返回前端调起参数。 */
@Controller("api/v1/payments/wechatpay")
export class WechatPayCheckoutController {
  constructor(
    @Inject(WechatPayCheckoutService)
    private readonly checkout: WechatPayCheckoutService,
  ) {}

  @TenantScope()
  @Post("prepay")
  async prepay(
    @Req() req: AuthenticatedRequest,
    @Body() body: { amountFen?: unknown; description?: unknown },
  ) {
    const tenantId = req.principal?.tenantId;
    const accountId = req.principal?.sub;
    if (!tenantId || !accountId) {
      throw new HttpException(
        "tenant context missing",
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (req.principal?.role !== "CUSTOMER") {
      throw new HttpException("需要老板身份", HttpStatus.FORBIDDEN);
    }
    const amountFen = parseAmountFen(body.amountFen);
    if (amountFen === null) {
      throw new HttpException(
        "amountFen 必填且为正整数字符串/数字",
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      const result = await this.checkout.prepay({
        tenantId,
        customerAccountId: accountId,
        amountFen,
        ...(typeof body.description === "string" && body.description.trim()
          ? { description: body.description.trim() }
          : {}),
      });
      return {
        data: {
          outTradeNo: result.outTradeNo,
          prepayId: result.prepayId,
          payParams: result.payParams,
        },
      };
    } catch (error) {
      if (error instanceof WechatPayDisabledError) {
        throw new HttpException(error.message, HttpStatus.SERVICE_UNAVAILABLE);
      }
      if (error instanceof TenantPaymentNotReadyError) {
        // 409：门店侧状态未就绪（未进件 / 未完成开户意愿确认）
        throw new HttpException(error.message, HttpStatus.CONFLICT);
      }
      if (error instanceof WechatPayerNotBoundError) {
        // 409：需要先在微信内授权（拿到 sp_openid）
        throw new HttpException(error.message, HttpStatus.CONFLICT);
      }
      if (error instanceof PrepayInputError) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw error;
    }
  }
}

/** 金额一律整数分；接受字符串或数字，拒绝小数、负数与超范围。 */
function parseAmountFen(value: unknown): bigint | null {
  if (typeof value === "bigint") return value > 0n ? value : null;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? BigInt(value) : null;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value.trim())) {
    const parsed = BigInt(value.trim());
    return parsed > 0n ? parsed : null;
  }
  return null;
}

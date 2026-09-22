import { randomBytes } from "node:crypto";
import type { CheckoutRepository } from "./checkout-ports.js";
import type {
  JsapiPayParams,
  WechatPayPartnerClient,
} from "../infrastructure/wechatpay-partner.client.js";
import {
  PrepayInputError,
  TenantPaymentNotReadyError,
  WechatPayDisabledError,
  WechatPayerNotBoundError,
} from "../domain/payments.errors.js";

/**
 * S4-2c：服务商模式下的 JSAPI 下单。
 *
 * 两条门禁是刻意的（都是"钱收不到"的前置条件）：
 *  1. **门店子商户必须 ACTIVE**：官方《商户开户意愿确认》写明它是"商户正常使用支付、结算等功能的必要前提"，
 *     进件成功 ≠ 能收款；
 *  2. **客户必须有 sp_openid**：JSAPI 下单要 `payer.sp_openid`，它只能来自服务商公众号的网页授权
 *     （S3 已实现），所以没走过微信授权的客户必须先授权再支付。
 */

export interface PrepayResult {
  outTradeNo: string;
  prepayId: string;
  payParams: JsapiPayParams;
}

export class WechatPayCheckoutService {
  constructor(
    private readonly repository: CheckoutRepository,
    private readonly client: WechatPayPartnerClient | null,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async prepay(input: {
    tenantId: string;
    customerAccountId: string;
    amountFen: bigint;
    description?: string;
  }): Promise<PrepayResult> {
    if (!this.client) throw new WechatPayDisabledError();
    const client = this.client;

    if (input.amountFen <= 0n) throw new PrepayInputError("充值金额需大于 0");
    const amount = Number(input.amountFen);
    if (!Number.isSafeInteger(amount)) {
      throw new PrepayInputError("金额超出可安全传输的整数范围");
    }

    const payment = await this.repository.findTenantPaymentAccount(
      input.tenantId,
    );
    if (!payment?.subMchid) {
      throw new TenantPaymentNotReadyError("门店尚未完成微信支付进件");
    }
    if (payment.status !== "ACTIVE") {
      throw new TenantPaymentNotReadyError(
        `门店微信支付未就绪（当前状态 ${payment.status}）`,
      );
    }

    const payer = await this.repository.findCustomerPayerIdentity(
      input.tenantId,
      input.customerAccountId,
    );
    if (!payer) throw new PrepayInputError("客户档案不存在");
    if (!payer.spOpenid) throw new WechatPayerNotBoundError();

    const order = await this.repository.createPrepayOrder({
      tenantId: input.tenantId,
      customerProfileId: payer.customerProfileId,
      outNo: generateOutTradeNo(this.now()),
      amountFen: input.amountFen,
      spMchid: client.spMchid,
      subMchid: payment.subMchid,
    });
    const { prepayId } = await client.jsapiPrepay({
      subMchid: payment.subMchid,
      spOpenid: payer.spOpenid,
      outTradeNo: order.outNo,
      description: input.description ?? "门店充值",
      amountFen: amount,
    });
    await this.repository.attachPrepayId(input.tenantId, order.id, prepayId);
    return {
      outTradeNo: order.outNo,
      prepayId,
      payParams: client.buildJsapiPayParams({ prepayId }),
    };
  }
}

/** 商户单号：字母数字混合；微信只要求同商户号下唯一，这里靠时间戳+随机保证。 */
export function generateOutTradeNo(epochMs: number): string {
  return `WX${epochMs.toString(36).toUpperCase()}${randomBytes(4)
    .toString("hex")
    .toUpperCase()}`;
}

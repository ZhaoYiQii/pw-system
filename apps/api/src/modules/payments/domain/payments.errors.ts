/** S4-2：支付回调相关错误（控制器据此映射 HTTP 状态码）。 */

export class WechatPayDisabledError extends Error {
  constructor() {
    super("微信支付未启用");
    this.name = "WechatPayDisabledError";
  }
}

/** 回调验签失败：按官方口径，应答非 2xx 微信会重试（最多 15 次）。 */
export class WechatPaySignatureError extends Error {
  constructor(detail = "回调签名校验失败") {
    super(detail);
    this.name = "WechatPaySignatureError";
  }
}

export class WechatPayPayloadError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "WechatPayPayloadError";
  }
}

/** 下单入参问题（金额非法等）→ 400。 */
export class PrepayInputError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "PrepayInputError";
  }
}

/** 门店侧支付未就绪（未进件 / 未完成开户意愿确认 / 已停用）→ 409。 */
export class TenantPaymentNotReadyError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "TenantPaymentNotReadyError";
  }
}

/** 客户没有 sp_openid：需要先在微信内授权登录 → 409。 */
export class WechatPayerNotBoundError extends Error {
  constructor() {
    super("请先在微信内打开并授权登录后再支付");
    this.name = "WechatPayerNotBoundError";
  }
}

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

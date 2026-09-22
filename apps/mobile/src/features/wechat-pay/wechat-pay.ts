// S4-6a：微信支付（H5/JSAPI）纯逻辑：参数校验、能不能付、调起结果判定、结果页轮询策略。
//
// 为什么单独拎出来：这几件事全是"错一步客户就付不了钱"的判断，必须可单测；
// 真正的 WeixinJSBridge 调用放在 src/platform/weixin-jsbridge.ts（页面不许直接碰 window）。
//
// 官方口径（partner「JSAPI调起支付」）：调起参数必须与下单 appid 一致，signType 固定 RSA，
// timeStamp 是秒级字符串，package 形如 prepay_id=xxx。

export interface JsapiPayParams {
  appId: string;
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: string;
  paySign: string;
}

export class PayParamError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "PayParamError";
  }
}

// 校验后端返回的调起参数；缺一个字段都会让客户白点一次支付按钮，所以本地先挡。
export function parseJsapiPayParams(value: unknown): JsapiPayParams {
  const row = (value ?? {}) as Record<string, unknown>;
  const text = (key: string): string =>
    typeof row[key] === "string" ? (row[key] as string).trim() : "";
  const params: JsapiPayParams = {
    appId: text("appId"),
    timeStamp: text("timeStamp"),
    nonceStr: text("nonceStr"),
    package: text("package"),
    signType: text("signType"),
    paySign: text("paySign"),
  };
  for (const [key, val] of Object.entries(params)) {
    if (!val) throw new PayParamError(`支付参数缺少 ${key}`);
  }
  if (params.signType !== "RSA") {
    throw new PayParamError(`支付签名类型应为 RSA（实际 ${params.signType}）`);
  }
  if (!params.package.startsWith("prepay_id=")) {
    throw new PayParamError("支付参数 package 应为 prepay_id=... 形式");
  }
  if (!/^\d+$/.test(params.timeStamp)) {
    throw new PayParamError("支付参数 timeStamp 应为秒级数字字符串");
  }
  return params;
}

export type PayBlockedReason =
  "NOT_IN_WECHAT" | "PAY_DISABLED" | "PAYER_NOT_BOUND";

export type PayReadiness =
  { ready: true } | { ready: false; reason: PayBlockedReason; message: string };

// 能不能付款。判定顺序：先看环境（不在微信里连 bridge 都没有，讲别的没意义），
// 再看平台是否启用支付，最后看这个客户是否已微信授权（缺 sp_openid）。
export function payReadiness(input: {
  inWechat: boolean;
  payEnabled: boolean;
  payerBound: boolean;
}): PayReadiness {
  if (!input.inWechat) {
    return {
      ready: false,
      reason: "NOT_IN_WECHAT",
      message: "请在微信里打开本页面再充值",
    };
  }
  if (!input.payEnabled) {
    return {
      ready: false,
      reason: "PAY_DISABLED",
      message: "本店微信支付尚未开通，请稍后再试",
    };
  }
  if (!input.payerBound) {
    return {
      ready: false,
      reason: "PAYER_NOT_BOUND",
      message: "需要先在微信里授权登录一次，才能付款",
    };
  }
  return { ready: true };
}

export type PayOutcome = "PAID" | "CANCELLED" | "FAILED";

// 把微信回调的 err_msg 归一成三种结果（原文取值：...:ok / :cancel / :fail）。
export function normalizePayOutcome(errMsg: string): PayOutcome {
  if (errMsg === "get_brand_wcpay_request:ok") return "PAID";
  if (errMsg === "get_brand_wcpay_request:cancel") return "CANCELLED";
  return "FAILED";
}

// 结果页轮询策略：支付成功后要等后端回调入账，不能一看到 PAID 就宣布到账；
// 用户取消了就直接停下，不打扰。
export function nextPollAction(input: {
  outcome: PayOutcome;
  credited: boolean;
  attempts: number;
  maxAttempts: number;
}): "DONE" | "KEEP_POLLING" | "GIVE_UP" {
  if (input.credited) return "DONE";
  if (input.outcome === "CANCELLED") return "DONE";
  return input.attempts >= input.maxAttempts ? "GIVE_UP" : "KEEP_POLLING";
}

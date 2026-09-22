// S4-6a：把"能不能付 + 怎么调起"封在 feature 里，页面只依赖 feature（不直接碰 platform）。
import {
  invokeWechatJsapiPay,
  isWechatBrowser,
} from "../../platform/weixin-jsbridge";
import {
  normalizePayOutcome,
  payReadiness,
  type JsapiPayParams,
  type PayOutcome,
  type PayReadiness,
} from "./wechat-pay";

// 当前环境能不能付款：环境判定由 platform 适配层提供（页面不碰 window）。
export function currentPayReadiness(input: {
  payEnabled: boolean;
  payerBound: boolean;
}): PayReadiness {
  return payReadiness({
    inWechat: isWechatBrowser(),
    payEnabled: input.payEnabled,
    payerBound: input.payerBound,
  });
}

// 调起支付并归一结果；不在微信里会抛 NOT_IN_WECHAT（调用方应先用 currentPayReadiness 挡）。
export async function payWithWechat(
  params: JsapiPayParams,
): Promise<PayOutcome> {
  const { errMsg } = await invokeWechatJsapiPay(params);
  return normalizePayOutcome(errMsg);
}

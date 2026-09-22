// S4-6a：微信 JSAPI 支付调起（唯一允许出现 WeixinJSBridge 的地方）。
//
// 仓库硬规则：页面里不许直接碰 window / WeixinJSBridge，一律走 src/platform 适配层。
// 官方口径：浏览器侧调 WeixinJSBridge.invoke('getBrandWCPayRequest', {...}, cb)，
// 回调 res.err_msg 为 get_brand_wcpay_request:ok 表示成功，:cancel 取消，:fail 失败。
import type { JsapiPayParams } from "../features/wechat-pay/wechat-pay";

interface WeixinJsBridgeLike {
  invoke(
    api: string,
    params: Record<string, string>,
    callback: (res: { err_msg?: string; errMsg?: string }) => void,
  ): void;
}

function bridge(): WeixinJsBridgeLike | null {
  const w = globalThis as unknown as { WeixinJSBridge?: WeixinJsBridgeLike };
  return w.WeixinJSBridge ?? null;
}

// 是否在微信内置浏览器里（不在微信里就没有 WeixinJSBridge，也就没法调起支付）。
export function isWechatBrowser(): boolean {
  if (bridge()) return true;
  const ua =
    typeof navigator === "undefined" ? "" : (navigator.userAgent ?? "");
  return /MicroMessenger/i.test(ua);
}

// 等 WeixinJSBridge 就绪（微信里它的注入时机晚于页面首屏）。
function waitForBridge(timeoutMs: number): Promise<WeixinJsBridgeLike | null> {
  const existing = bridge();
  if (existing) return Promise.resolve(existing);
  if (typeof document === "undefined") return Promise.resolve(null);
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise(null), timeoutMs);
    document.addEventListener(
      "WeixinJSBridgeReady",
      () => {
        clearTimeout(timer);
        resolvePromise(bridge());
      },
      { once: true },
    );
  });
}

// 调起支付：只把微信的原始回调带回去，成功/取消/失败的判定在 features/wechat-pay 的纯函数里。
export async function invokeWechatJsapiPay(
  params: JsapiPayParams,
  options: { timeoutMs?: number } = {},
): Promise<{ errMsg: string }> {
  const handle = await waitForBridge(options.timeoutMs ?? 3000);
  if (!handle) throw new Error("NOT_IN_WECHAT");
  return new Promise((resolvePromise) => {
    handle.invoke(
      "getBrandWCPayRequest",
      {
        appId: params.appId,
        timeStamp: params.timeStamp,
        nonceStr: params.nonceStr,
        package: params.package,
        signType: params.signType,
        paySign: params.paySign,
      },
      (res) => {
        resolvePromise({ errMsg: res.err_msg ?? res.errMsg ?? "" });
      },
    );
  });
}

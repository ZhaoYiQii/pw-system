// S4-6b：支付结果页的**状态机**（纯逻辑）。页面只负责把这里给出的文案渲染出来。
//
// 一条铁律：**支付成功 ≠ 已到账**。微信回调是异步的，`PAID` 只说明客户付了钱；
// 余额要等后端回调把支付单刷成 SUCCESS（credited=true）才算真的到账。
// 所以这里的 WAITING 状态必须存在，超时也不能谎称"失败"（钱可能已经付了）。
import type { PayOutcome, PayReadiness } from "./wechat-pay";

export type PayResultKind =
  | "NOT_IN_WECHAT"
  | "PAY_DISABLED"
  | "PAYER_NOT_BOUND"
  | "WAITING"
  | "SUCCESS"
  | "CANCELLED"
  | "FAILED"
  | "TIMEOUT";

export interface PayResultView {
  kind: PayResultKind;
  title: string;
  detail: string;
  /** 是否给"再试一次"按钮（成功/超时不给，避免重复支付）。 */
  showRetry: boolean;
  /** 成功时展示到账金额（十进制字符串分）。 */
  amountFen: string | null;
}

export function payResultView(input: {
  /** null = 还没走到调起（例如环境不满足、或还在下单）。 */
  outcome: PayOutcome | null;
  readiness?: PayReadiness;
  credited: boolean;
  attempts: number;
  maxAttempts: number;
  amountFen?: string;
}): PayResultView {
  const amountFen = input.amountFen ?? null;
  if (input.readiness && !input.readiness.ready) {
    const map = {
      NOT_IN_WECHAT: "NOT_IN_WECHAT",
      PAY_DISABLED: "PAY_DISABLED",
      PAYER_NOT_BOUND: "PAYER_NOT_BOUND",
    } as const;
    return {
      kind: map[input.readiness.reason],
      title: "暂时无法支付",
      detail: input.readiness.message,
      showRetry: false,
      amountFen: null,
    };
  }
  if (input.credited) {
    return {
      kind: "SUCCESS",
      title: "支付成功",
      detail: "余额已到账，可在钱包页查看流水。",
      showRetry: false,
      amountFen,
    };
  }
  const outcome = input.outcome;
  if (outcome === "CANCELLED") {
    return {
      kind: "CANCELLED",
      title: "已取消支付",
      detail: "这笔充值没有完成，可以重新发起。",
      showRetry: true,
      amountFen,
    };
  }
  if (outcome === "FAILED") {
    return {
      kind: "FAILED",
      title: "支付未完成",
      detail: "没有收到微信的支付成功回调，可以再试一次。",
      showRetry: true,
      amountFen,
    };
  }
  // PAID 但还没到账：继续等回调
  if (outcome === "PAID") {
    if (input.attempts >= input.maxAttempts) {
      return {
        kind: "TIMEOUT",
        title: "已支付，等待到账",
        // 关键：不说"失败"，也不让客户再付一次
        detail:
          "微信已确认收到款项，但到账确认还没回来。请稍后在钱包页刷新查看；若长时间未到账，把本页截图发给门店。",
        showRetry: false,
        amountFen,
      };
    }
    return {
      kind: "WAITING",
      title: "支付已提交，正在到账",
      detail: "正在等待微信回调入账，请稍候…",
      showRetry: false,
      amountFen,
    };
  }
  return {
    kind: "WAITING",
    title: "正在发起支付",
    detail: "请在微信的支付窗口中完成付款。",
    showRetry: false,
    amountFen,
  };
}

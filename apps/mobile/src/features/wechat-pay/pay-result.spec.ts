import { describe, expect, it } from "vitest";
import { payResultView } from "./pay-result";

// S4-6b：结果页状态机单测。最关键的三条判据：
// ① 支付成功但**回调还没入账**时必须停在"等待"，不能直接宣布成功；
// ② 超时**不能谎称失败**、也不能给"再试一次"（钱可能已经付了）；
// ③ 环境/启用/授权三种阻断各有自己的文案，给用户下一步动作。

const base = {
  credited: false,
  attempts: 1,
  maxAttempts: 10,
  amountFen: "12800",
};

describe("S4-6b：支付结果页状态机", () => {
  it("支付成功且已入账 → SUCCESS，不显示重试，带金额", () => {
    const view = payResultView({ ...base, outcome: "PAID", credited: true });
    expect(view).toMatchObject({
      kind: "SUCCESS",
      showRetry: false,
      amountFen: "12800",
    });
  });

  it("已支付但回调还没到 → WAITING（绝不提前宣布到账）", () => {
    const view = payResultView({ ...base, outcome: "PAID" });
    expect(view.kind).toBe("WAITING");
    expect(view.title).toBe("支付已提交，正在到账");
    expect(view.showRetry).toBe(false);
  });

  it("超时 → TIMEOUT：不谎称失败、不给重试（可能已付款）", () => {
    const view = payResultView({
      ...base,
      outcome: "PAID",
      attempts: 10,
      maxAttempts: 10,
    });
    expect(view.kind).toBe("TIMEOUT");
    expect(view.title).not.toMatch(/失败/);
    expect(view.showRetry).toBe(false);
    expect(view.detail).toMatch(/稍后/);
  });

  it("取消与失败都能重试，但文案不同（取消不是错误）", () => {
    expect(payResultView({ ...base, outcome: "CANCELLED" })).toMatchObject({
      kind: "CANCELLED",
      showRetry: true,
    });
    expect(payResultView({ ...base, outcome: "FAILED" })).toMatchObject({
      kind: "FAILED",
      showRetry: true,
    });
  });

  it("三种阻断各有自己的 kind 与文案（含下一步动作）", () => {
    expect(
      payResultView({
        ...base,
        outcome: null,
        readiness: {
          ready: false,
          reason: "NOT_IN_WECHAT",
          message: "请在微信里打开本页面再充值",
        },
      }),
    ).toMatchObject({ kind: "NOT_IN_WECHAT", showRetry: false });
    expect(
      payResultView({
        ...base,
        outcome: null,
        readiness: {
          ready: false,
          reason: "PAYER_NOT_BOUND",
          message: "需要先在微信里授权登录一次，才能付款",
        },
      }),
    ).toMatchObject({ kind: "PAYER_NOT_BOUND" });
    expect(
      payResultView({
        ...base,
        outcome: null,
        readiness: {
          ready: false,
          reason: "PAY_DISABLED",
          message: "本店微信支付尚未开通，请稍后再试",
        },
      }),
    ).toMatchObject({ kind: "PAY_DISABLED" });
  });

  it("还没调起且环境允许 → 等待（给客户看到「正在发起支付」）", () => {
    const view = payResultView({
      ...base,
      outcome: null,
      readiness: { ready: true },
    });
    expect(view.kind).toBe("WAITING");
    expect(view.title).toBe("正在发起支付");
  });
});

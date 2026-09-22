import { describe, expect, it } from "vitest";
import {
  PayParamError,
  normalizePayOutcome,
  nextPollAction,
  parseJsapiPayParams,
  payReadiness,
} from "./wechat-pay";

// S4-6a：微信支付前端纯逻辑单测。判据来自官方「JSAPI调起支付」口径与真实失败场景。

const VALID = {
  appId: "wx1234567890abcdef",
  timeStamp: "1700000000",
  nonceStr: "abcdef123456",
  package: "prepay_id=wx201410272009395522657a690389285100",
  signType: "RSA",
  paySign: "c2lnbmF0dXJl",
};

describe("S4-6a：H5 微信支付纯逻辑", () => {
  it("调起参数：合法通过；缺字段 / signType 非 RSA / package 形式错 / 时间戳非数字都要拦", () => {
    expect(parseJsapiPayParams(VALID)).toEqual(VALID);
    const missing = { ...VALID, paySign: "" };
    expect(() => parseJsapiPayParams(missing)).toThrow(PayParamError);
    expect(() => parseJsapiPayParams(missing)).toThrow(/缺少 paySign/);
    expect(() => parseJsapiPayParams({ ...VALID, signType: "MD5" })).toThrow(
      /应为 RSA/,
    );
    expect(() => parseJsapiPayParams({ ...VALID, package: "wx123" })).toThrow(
      /prepay_id=/,
    );
    expect(() =>
      parseJsapiPayParams({ ...VALID, timeStamp: "1.7e12" }),
    ).toThrow(/timeStamp/);
    expect(() => parseJsapiPayParams(null)).toThrow(/缺少 appId/);
  });

  it("能不能付：环境优先，其次是否启用，最后是否授权（顺序错会给出误导提示）", () => {
    expect(
      payReadiness({ inWechat: false, payEnabled: false, payerBound: false }),
    ).toMatchObject({ reason: "NOT_IN_WECHAT" });
    expect(
      payReadiness({ inWechat: true, payEnabled: false, payerBound: false }),
    ).toMatchObject({ reason: "PAY_DISABLED" });
    expect(
      payReadiness({ inWechat: true, payEnabled: true, payerBound: false }),
    ).toMatchObject({
      reason: "PAYER_NOT_BOUND",
      message: "需要先在微信里授权登录一次，才能付款",
    });
    expect(
      payReadiness({ inWechat: true, payEnabled: true, payerBound: true }),
    ).toEqual({ ready: true });
  });

  it("调起结果归一：ok→PAID、cancel→CANCELLED、其余→FAILED（不把取消当失败吓用户）", () => {
    expect(normalizePayOutcome("get_brand_wcpay_request:ok")).toBe("PAID");
    expect(normalizePayOutcome("get_brand_wcpay_request:cancel")).toBe(
      "CANCELLED",
    );
    expect(normalizePayOutcome("get_brand_wcpay_request:fail")).toBe("FAILED");
    expect(normalizePayOutcome("")).toBe("FAILED");
  });

  it("轮询策略：PAID 但回调还没入账要继续轮询；取消就停；超过上限放弃", () => {
    expect(
      nextPollAction({
        outcome: "PAID",
        credited: false,
        attempts: 1,
        maxAttempts: 10,
      }),
    ).toBe("KEEP_POLLING");
    expect(
      nextPollAction({
        outcome: "PAID",
        credited: true,
        attempts: 1,
        maxAttempts: 10,
      }),
    ).toBe("DONE");
    expect(
      nextPollAction({
        outcome: "CANCELLED",
        credited: false,
        attempts: 1,
        maxAttempts: 10,
      }),
    ).toBe("DONE");
    expect(
      nextPollAction({
        outcome: "PAID",
        credited: false,
        attempts: 10,
        maxAttempts: 10,
      }),
    ).toBe("GIVE_UP");
  });
});

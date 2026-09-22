/**
 * S1a：支付通道的选择与生产门禁。
 *
 * 锁的是「配置决定行为」这条边界，而不是 MockPaymentProvider 的内部实现——
 * 它同时是「接真实通道时不能悄悄降级成 mock」的保险。
 */
import { afterEach, describe, expect, it } from "vitest";
import { MockPaymentProvider } from "./infrastructure/mock-payment.provider.js";
import { resolvePaymentProvider } from "./wallet.module.js";

type EnvKey = "PAYMENT_PROVIDER" | "NODE_ENV" | "ALLOW_MOCK_PAYMENT";
const original: Record<EnvKey, string | undefined> = {
  PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER,
  NODE_ENV: process.env.NODE_ENV,
  ALLOW_MOCK_PAYMENT: process.env.ALLOW_MOCK_PAYMENT,
};

function restore(name: EnvKey): void {
  const value = original[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restore("PAYMENT_PROVIDER");
  restore("NODE_ENV");
  restore("ALLOW_MOCK_PAYMENT");
});

describe("S1a：支付通道选择与生产门禁", () => {
  it("未配置 PAYMENT_PROVIDER 时即失败，并在错误里点名该变量", () => {
    delete process.env.PAYMENT_PROVIDER;
    expect(() => resolvePaymentProvider()).toThrowError(/PAYMENT_PROVIDER/);
  });

  it("配置了未实现的通道名时失败（不会悄悄退回 mock）", () => {
    process.env.PAYMENT_PROVIDER = "wechat";
    expect(() => resolvePaymentProvider()).toThrowError(/only 'mock'/);
  });

  it("生产 + mock 且未显式放行时拒绝启动", () => {
    process.env.PAYMENT_PROVIDER = "mock";
    process.env.NODE_ENV = "production";
    delete process.env.ALLOW_MOCK_PAYMENT;
    expect(() => resolvePaymentProvider()).toThrowError(/ALLOW_MOCK_PAYMENT/);
  });

  it("生产显式放行 mock（仅供演示）时可用", () => {
    process.env.PAYMENT_PROVIDER = "mock";
    process.env.NODE_ENV = "production";
    process.env.ALLOW_MOCK_PAYMENT = "true";
    expect(resolvePaymentProvider()).toBeInstanceOf(MockPaymentProvider);
  });

  it("非生产环境默认走 mock", () => {
    process.env.PAYMENT_PROVIDER = "mock";
    process.env.NODE_ENV = "test";
    delete process.env.ALLOW_MOCK_PAYMENT;
    expect(resolvePaymentProvider()).toBeInstanceOf(MockPaymentProvider);
  });
});

/**
 * S2：短信通道的选择与生产门禁（与 wallet.module.spec.ts 同范式）。
 *
 * 锁的同样是「配置决定行为」这条边界：**未知通道名不退回 mock**、**选了 tencent 就缺一不可**。
 * 这里能证明的只有装配与门禁；「短信真的发出去了」只能靠第一次真实调用证明。
 */
import { afterEach, describe, expect, it } from "vitest";
import { MockSmsProvider } from "./infrastructure/mock-sms.provider.js";
import { TencentSmsProvider } from "./infrastructure/tencent-sms.provider.js";
import { WechatOauthClient } from "./infrastructure/wechat-oauth.client.js";
import {
  resolveSmsProvider,
  resolveWechatLogin,
} from "./identity-access.module.js";

const ENV_KEYS = [
  "SMS_PROVIDER",
  "NODE_ENV",
  "ALLOW_MOCK_SMS",
  "TENCENT_SMS_SECRET_ID",
  "TENCENT_SMS_SECRET_KEY",
  "TENCENT_SMS_SDK_APP_ID",
  "TENCENT_SMS_SIGN_NAME",
  "TENCENT_SMS_TEMPLATE_ID",
  "WECHAT_LOGIN_ENABLED",
  "WECHAT_APP_ID",
  "WECHAT_APP_SECRET",
  "WECHAT_OAUTH_REDIRECT_URI",
  "SESSION_SECRET",
] as const;
type EnvKey = (typeof ENV_KEYS)[number];

const SECRET = "test-secret-0123456789-0123456789-0123456789";

const original = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<EnvKey, string | undefined>;

function clear(keys: readonly EnvKey[]): void {
  for (const key of keys) delete process.env[key];
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** 一份「变量齐全」的腾讯云配置；单个用例再按需删掉某一项。 */
function useTencentEnv(): void {
  clear(ENV_KEYS);
  process.env.SMS_PROVIDER = "tencent";
  process.env.TENCENT_SMS_SECRET_ID = "AKIDtest";
  process.env.TENCENT_SMS_SECRET_KEY = "secret";
  process.env.TENCENT_SMS_SDK_APP_ID = "1400000000";
  process.env.TENCENT_SMS_SIGN_NAME = "测试签名";
  process.env.TENCENT_SMS_TEMPLATE_ID = "123456";
}

describe("S2：短信通道选择与生产门禁", () => {
  it("未配置 SMS_PROVIDER 时走 mock（开发默认不变）", () => {
    clear(ENV_KEYS);
    expect(resolveSmsProvider()).toBeInstanceOf(MockSmsProvider);
  });

  it("SMS_PROVIDER=tencent 且变量齐全时返回腾讯云通道", () => {
    useTencentEnv();
    expect(resolveSmsProvider()).toBeInstanceOf(TencentSmsProvider);
  });

  it("SMS_PROVIDER=tencent 但缺凭证时启动即失败，并点名缺哪个变量", () => {
    useTencentEnv();
    delete process.env.TENCENT_SMS_SECRET_KEY;
    expect(() => resolveSmsProvider()).toThrowError(/TENCENT_SMS_SECRET_KEY/);
  });

  it("未实现的通道名直接失败（不会悄悄退回 mock）", () => {
    clear(ENV_KEYS);
    process.env.SMS_PROVIDER = "aliyun";
    expect(() => resolveSmsProvider()).toThrowError(/不支持：aliyun/);
  });

  it("生产 + mock 且未显式放行时拒绝启动", () => {
    clear(ENV_KEYS);
    process.env.SMS_PROVIDER = "mock";
    process.env.NODE_ENV = "production";
    expect(() => resolveSmsProvider()).toThrowError(/ALLOW_MOCK_SMS/);
  });

  it("生产 + tencent 不受 mock 守卫影响（真实通道就是生产用的）", () => {
    useTencentEnv();
    process.env.NODE_ENV = "production";
    expect(resolveSmsProvider()).toBeInstanceOf(TencentSmsProvider);
  });

  it("微信登录默认关闭：未设 WECHAT_LOGIN_ENABLED 时返回 disabled，且不要求公众号凭证", () => {
    clear(ENV_KEYS);
    expect(resolveWechatLogin()).toEqual({ enabled: false });
  });

  it("微信登录开启但缺凭证时启动即失败，并点名变量", () => {
    clear(ENV_KEYS);
    process.env.WECHAT_LOGIN_ENABLED = "true";
    process.env.SESSION_SECRET = SECRET;
    expect(() => resolveWechatLogin()).toThrowError(/WECHAT_APP_ID/);
  });

  it("微信登录开启且变量齐全时给出可用的 client", () => {
    clear(ENV_KEYS);
    process.env.WECHAT_LOGIN_ENABLED = "true";
    process.env.SESSION_SECRET = SECRET;
    process.env.WECHAT_APP_ID = "wx1234567890abcdef";
    process.env.WECHAT_APP_SECRET = "secret";
    process.env.WECHAT_OAUTH_REDIRECT_URI =
      "https://h5.example.com/?wechat_login=1";
    const runtime = resolveWechatLogin();
    expect(runtime.enabled).toBe(true);
    if (runtime.enabled) {
      expect(runtime.client).toBeInstanceOf(WechatOauthClient);
    }
  });
});

import { describe, expect, it } from "vitest";
import type { SendSmsCodeInput } from "../domain/sms-provider.js";
import {
  TencentSmsError,
  TencentSmsProvider,
  buildTencentSmsRequest,
  classifyTencentSmsCode,
  resolveTencentSmsConfig,
  toE164Cn,
  type TencentSmsConfig,
} from "./tencent-sms.provider.js";

const ENV = {
  TENCENT_SMS_SECRET_ID: "AKIDtest",
  TENCENT_SMS_SECRET_KEY: "secret",
  TENCENT_SMS_SDK_APP_ID: "1400000000",
  TENCENT_SMS_SIGN_NAME: "测试签名",
  TENCENT_SMS_TEMPLATE_ID: "123456",
};

function config(overrides: Partial<TencentSmsConfig> = {}): TencentSmsConfig {
  return { ...resolveTencentSmsConfig(ENV), ...overrides };
}

const input: SendSmsCodeInput = {
  tenantId: "t1",
  mobile: "13800138000",
  phoneTail: "8000",
  scene: "register_login",
  code: "654321",
};

describe("S2：腾讯云短信 adapter（可独立验证的部分）", () => {
  it("缺必需变量时在启动期报错，并点名缺哪些变量", () => {
    expect(() => resolveTencentSmsConfig({})).toThrowError(
      /TENCENT_SMS_SECRET_ID/,
    );
    expect(() =>
      resolveTencentSmsConfig({ ...ENV, TENCENT_SMS_SECRET_KEY: "" }),
    ).toThrowError(/TENCENT_SMS_SECRET_KEY/);
  });

  it("默认值：region=ap-guangzhou、endpoint=公网域名，且可被环境变量覆盖", () => {
    const parsed = resolveTencentSmsConfig(ENV);
    expect(parsed.region).toBe("ap-guangzhou");
    expect(parsed.endpoint).toBe("sms.tencentcloudapi.com");
    expect(
      resolveTencentSmsConfig({ ...ENV, TENCENT_SMS_REGION: "ap-shanghai" })
        .region,
    ).toBe("ap-shanghai");
  });

  it("号码转换：11 位补 +86；已是 E.164 原样；非法格式报错", () => {
    expect(toE164Cn("13800138000")).toBe("+8613800138000");
    expect(toE164Cn("+8613800138000")).toBe("+8613800138000");
    expect(() => toE164Cn("861")).toThrowError(/无法识别的手机号格式/);
  });

  it("返回码分类：频控 / 可重试 / 永久", () => {
    expect(classifyTencentSmsCode("LimitExceeded.PhoneNumberDailyLimit")).toBe(
      "rate_limited",
    );
    expect(classifyTencentSmsCode("RequestLimitExceeded")).toBe("retryable");
    expect(classifyTencentSmsCode("InternalError")).toBe("retryable");
    // 网络/超时/非 JSON 是我们自己合成的码，属传输层问题 → 可重试
    expect(classifyTencentSmsCode("NetworkError")).toBe("retryable");
    expect(classifyTencentSmsCode("TimeoutError")).toBe("retryable");
    expect(classifyTencentSmsCode("MalformedResponse")).toBe("retryable");
    expect(classifyTencentSmsCode("AuthFailure.SignatureFailure")).toBe(
      "permanent",
    );
  });

  it("请求拼装：动作/版本/区域/鉴权头齐备，模板参数为单元素数组", () => {
    const request = buildTencentSmsRequest(
      config(),
      { PhoneNumberSet: ["+8613800138000"], TemplateParamSet: ["654321"] },
      1_700_000_000,
    );
    expect(request.url).toBe("https://sms.tencentcloudapi.com");
    expect(request.headers["x-tc-action"]).toBe("SendSms");
    expect(request.headers["x-tc-version"]).toBe("2021-01-11");
    expect(request.headers["x-tc-region"]).toBe("ap-guangzhou");
    expect(request.headers["x-tc-timestamp"]).toBe("1700000000");
    expect(request.headers.authorization).toMatch(
      /^TC3-HMAC-SHA256 Credential=AKIDtest\/\d{4}-\d{2}-\d{2}\/sms\/tc3_request, SignedHeaders=content-type;host, Signature=[0-9a-f]{64}$/,
    );
    expect(JSON.parse(request.body).TemplateParamSet).toEqual(["654321"]);
  });

  it("签名对同一输入稳定（回归锚点；正确性由真实调用证明，见文件头注释）", () => {
    const request = buildTencentSmsRequest(config(), { a: 1 }, 1_700_000_000);
    // 同输入必须同输出；改动算法会立刻打红这里
    expect(buildTencentSmsRequest(config(), { a: 1 }, 1_700_000_000)).toEqual(
      request,
    );
    // 换密钥/换时间必须不同（防止"签名没参与计算"这类实现错误）
    expect(
      buildTencentSmsRequest(
        config({ secretKey: "other" }),
        { a: 1 },
        1_700_000_000,
      ).headers.authorization,
    ).not.toBe(request.headers.authorization);
    expect(
      buildTencentSmsRequest(config(), { a: 1 }, 1_700_000_001).headers
        .authorization,
    ).not.toBe(request.headers.authorization);
  });

  it("发送成功：Ok 即通过；请求体带齐 SDKAppId/签名/模板/号码/验证码", async () => {
    const seen: Array<{ url: string; body: string }> = [];
    const provider = new TencentSmsProvider(
      config(),
      async (url, init) => {
        seen.push({ url, body: init.body });
        return {
          json: async () => ({
            Response: {
              SendStatusSet: [{ Code: "Ok", Message: "send success" }],
            },
          }),
        };
      },
      () => 1_700_000_000,
    );
    await provider.sendCode(input);
    expect(seen).toHaveLength(1);
    const body = JSON.parse(seen[0]!.body);
    expect(body).toMatchObject({
      PhoneNumberSet: ["+8613800138000"],
      SmsSdkAppId: "1400000000",
      SignName: "测试签名",
      TemplateId: "123456",
      TemplateParamSet: ["654321"],
    });
  });

  it("API 级错误：抛类型化错误并带上原始 code（便于在日志里定位）", async () => {
    const provider = new TencentSmsProvider(
      config(),
      async () => ({
        json: async () => ({
          Response: {
            Error: {
              Code: "AuthFailure.SignatureFailure",
              Message: "signature verify fail",
            },
          },
        }),
      }),
      () => 1_700_000_000,
    );
    await expect(provider.sendCode(input)).rejects.toThrowError(
      /AuthFailure\.SignatureFailure/,
    );
  });

  it("单号失败：SendStatusSet.Code 非 Ok 也抛错，并归一成频控语义", async () => {
    const provider = new TencentSmsProvider(
      config(),
      async () => ({
        json: async () => ({
          Response: {
            SendStatusSet: [
              { Code: "LimitExceeded.PhoneNumberDailyLimit", Message: "limit" },
            ],
          },
        }),
      }),
      () => 1_700_000_000,
    );
    await expect(provider.sendCode(input)).rejects.toMatchObject({
      code: "LimitExceeded.PhoneNumberDailyLimit",
      kind: "rate_limited",
    });
    await expect(provider.sendCode(input)).rejects.toBeInstanceOf(
      TencentSmsError,
    );
  });

  it("网络失败：归一成 TencentSmsError（原始原因进 message），classified 可重试", async () => {
    const provider = new TencentSmsProvider(
      config(),
      async () => {
        throw new TypeError(
          "fetch failed: getaddrinfo ENOTFOUND sms.tencentcloudapi.com",
        );
      },
      () => 1_700_000_000,
    );
    await expect(provider.sendCode(input)).rejects.toMatchObject({
      code: "NetworkError",
      kind: "retryable",
    });
    await expect(provider.sendCode(input)).rejects.toThrowError(/ENOTFOUND/);
  });

  it("超时：AbortSignal 触发后归一成 TimeoutError，而不是把用户请求挂死", async () => {
    const provider = new TencentSmsProvider(
      config(),
      async () => {
        const abort = new Error("The operation was aborted due to timeout");
        abort.name = "TimeoutError";
        throw abort;
      },
      () => 1_700_000_000,
    );
    await expect(provider.sendCode(input)).rejects.toMatchObject({
      code: "TimeoutError",
      kind: "retryable",
    });
  });

  it("调用超时时长：请求上确实带了 AbortSignal（5s 上限）", async () => {
    const signals: Array<AbortSignal | undefined> = [];
    const provider = new TencentSmsProvider(
      config(),
      async (_url, init) => {
        signals.push(init.signal);
        return {
          json: async () => ({ Response: { SendStatusSet: [{ Code: "Ok" }] } }),
        };
      },
      () => 1_700_000_000,
    );
    await provider.sendCode(input);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });

  it("返回体不是 JSON（如网关 502 页面）：归一成 MalformedResponse，不做无意义的 JSON 解析崩溃", async () => {
    const provider = new TencentSmsProvider(
      config(),
      async () => ({
        json: async () => {
          throw new SyntaxError("Unexpected token '<'");
        },
      }),
      () => 1_700_000_000,
    );
    await expect(provider.sendCode(input)).rejects.toMatchObject({
      code: "MalformedResponse",
      kind: "retryable",
    });
  });
});

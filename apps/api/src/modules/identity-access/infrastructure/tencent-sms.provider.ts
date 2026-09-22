import { createHash, createHmac } from "node:crypto";
import type { SendSmsCodeInput, SmsProvider } from "../domain/sms-provider.js";

/**
 * 腾讯云短信（SendSms / API 2021-01-11）。
 *
 * 有意**不引入腾讯云 SDK**：TC3-HMAC-SHA256 签名与 HTTP 调用用 `node:crypto` + 内置 `fetch`
 * 就能完成，这样不新增依赖、不扩大供应链面（与本仓库既有的 provider 原则一致）。
 *
 * 关于签名的验证口径（重要）：
 * 本文件的单测钉的是「请求拼装 / 参数映射 / 错误分类 / 算法行为不回归」，
 * **不构成签名正确性的证明**——真正的证明是第一次真实调用：签名错腾讯云会返回
 * `AuthFailure.SignatureFailure`，那一条才不可辩驳。
 *
 * 模板约定（重要）：
 * 腾讯云的 `TemplateParamSet` 是**字符串数组、按位置取值**，请求里没有「参数名」字段。
 * 因此本 adapter 只支持**单变量验证码模板**（如 `您的验证码为{1}，5分钟内有效`），
 * 固定传 `[code]`。若过审模板含多个变量，第一次真实调用会返回
 * `FailedOperation.TemplateParamSetNotMatchTemplate` 一类错误，原始 code 会进错误信息——
 * 那种情况下需要按模板实际变量数扩展本 adapter（不要指望本地能提前发现）。
 */

const REQUIRED_ENV = [
  "TENCENT_SMS_SECRET_ID",
  "TENCENT_SMS_SECRET_KEY",
  "TENCENT_SMS_SDK_APP_ID",
  "TENCENT_SMS_SIGN_NAME",
  "TENCENT_SMS_TEMPLATE_ID",
] as const;

const SERVICE = "sms";
const API_VERSION = "2021-01-11";
const ALGORITHM = "TC3-HMAC-SHA256";
const CONTENT_TYPE = "application/json; charset=utf-8";

export interface TencentSmsConfig {
  secretId: string;
  secretKey: string;
  sdkAppId: string;
  signName: string;
  templateId: string;
  region: string;
  endpoint: string;
}

/** 缺少必需变量时**在启动期**就报错，并把缺哪些变量直接写进信息里。 */
export function resolveTencentSmsConfig(
  env: NodeJS.ProcessEnv = process.env,
): TencentSmsConfig {
  const missing = REQUIRED_ENV.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(
      `腾讯云短信缺少必需环境变量：${missing.join(", ")}（见 docs/runbooks/env-inventory.md）`,
    );
  }
  return {
    secretId: env.TENCENT_SMS_SECRET_ID as string,
    secretKey: env.TENCENT_SMS_SECRET_KEY as string,
    sdkAppId: env.TENCENT_SMS_SDK_APP_ID as string,
    signName: env.TENCENT_SMS_SIGN_NAME as string,
    templateId: env.TENCENT_SMS_TEMPLATE_ID as string,
    region: env.TENCENT_SMS_REGION ?? "ap-guangzhou",
    endpoint: env.TENCENT_SMS_ENDPOINT ?? "sms.tencentcloudapi.com",
  };
}

/** 腾讯云要求 E.164（国内号码带 +86）；本地库里的号码是规范化后的 11 位。 */
export function toE164Cn(mobile: string): string {
  if (mobile.startsWith("+")) return mobile;
  if (/^1\d{10}$/.test(mobile)) return `+86${mobile}`;
  throw new Error(`无法识别的手机号格式：${mobile}`);
}

export type TencentSmsFailureKind = "rate_limited" | "retryable" | "permanent";

/**
 * 返回码分类。
 *
 * 只按**前缀**判断而不枚举具体码，避免写死一堆我没法逐条核对的字符串；
 * 原始 code 始终会进错误信息，所以分类错了也能在日志里看出来。
 * 三个非腾讯返回的合成码（网络失败 / 超时 / 返回体不是 JSON）单独判为可重试：
 * 它们来自传输层或网关，不是「这次请求本身就不合法」。
 */
export function classifyTencentSmsCode(code: string): TencentSmsFailureKind {
  if (
    code === "NetworkError" ||
    code === "TimeoutError" ||
    code === "MalformedResponse"
  )
    return "retryable";
  if (code.startsWith("LimitExceeded")) return "rate_limited";
  if (
    code.startsWith("RequestLimitExceeded") ||
    code.startsWith("InternalError")
  )
    return "retryable";
  return "permanent";
}

export class TencentSmsError extends Error {
  readonly kind: TencentSmsFailureKind;
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`腾讯云短信失败 [${code}] ${message}`);
    this.name = "TencentSmsError";
    this.kind = classifyTencentSmsCode(code);
  }
}

const sha256Hex = (input: string): string =>
  createHash("sha256").update(input).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac("sha256", key).update(data).digest();

export interface TencentSmsRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** 按 TC3-HMAC-SHA256 组装一次 SendSms 请求（纯函数，便于单测与回归）。 */
export function buildTencentSmsRequest(
  config: TencentSmsConfig,
  payload: Record<string, unknown>,
  timestampSeconds: number,
): TencentSmsRequest {
  const date = new Date(timestampSeconds * 1000).toISOString().slice(0, 10);
  const body = JSON.stringify(payload);
  const canonicalHeaders = `content-type:${CONTENT_TYPE}\nhost:${config.endpoint}\n`;
  const signedHeaders = "content-type;host";
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    sha256Hex(body),
  ].join("\n");
  const credentialScope = `${date}/${SERVICE}/tc3_request`;
  const stringToSign = [
    ALGORITHM,
    String(timestampSeconds),
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = createHmac(
    "sha256",
    hmac(hmac(hmac(`TC3${config.secretKey}`, date), SERVICE), "tc3_request"),
  )
    .update(stringToSign)
    .digest("hex");

  return {
    url: `https://${config.endpoint}`,
    headers: {
      authorization: `${ALGORITHM} Credential=${config.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "content-type": CONTENT_TYPE,
      host: config.endpoint,
      "x-tc-action": "SendSms",
      "x-tc-timestamp": String(timestampSeconds),
      "x-tc-version": API_VERSION,
      "x-tc-region": config.region,
    },
    body,
  };
}

interface TencentSmsResponse {
  Response?: {
    Error?: { Code?: string; Message?: string };
    SendStatusSet?: Array<{ Code?: string; Message?: string }>;
  };
}

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{ json(): Promise<unknown> }>;

/**
 * 单次调用的超时。验证码是**登录链路**上的同步调用，卡住会一直占着用户的请求，
 * 所以宁可快速失败让用户重试，也不无限等待（腾讯云官方 SDK 默认 60s，对本场景太长）。
 * 暂不做成环境变量：等有真实运营数据再决定是否要按门店调整。
 */
const REQUEST_TIMEOUT_MS = 5_000;

export class TencentSmsProvider implements SmsProvider {
  readonly kind = "tencent" as const;

  constructor(
    private readonly config: TencentSmsConfig,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  async sendCode(input: SendSmsCodeInput): Promise<void> {
    const payload = {
      PhoneNumberSet: [toE164Cn(input.mobile)],
      SmsSdkAppId: this.config.sdkAppId,
      SignName: this.config.signName,
      TemplateId: this.config.templateId,
      TemplateParamSet: [input.code],
    };
    const request = buildTencentSmsRequest(this.config, payload, this.now());
    const response = await this.call(request);

    const apiError = response.Response?.Error;
    if (apiError?.Code) {
      throw new TencentSmsError(apiError.Code, apiError.Message ?? "调用失败");
    }
    const status = response.Response?.SendStatusSet?.[0];
    if (!status?.Code) {
      throw new TencentSmsError(
        "EmptyResponse",
        "腾讯云返回体缺少 SendStatusSet",
      );
    }
    if (status.Code !== "Ok") {
      throw new TencentSmsError(status.Code, status.Message ?? "发送失败");
    }
  }

  /** 传输层失败也归一成 `TencentSmsError`：调用方只需处理一种错误类型，原始原因进 message。 */
  private async call(request: TencentSmsRequest): Promise<TencentSmsResponse> {
    let raw: { json(): Promise<unknown> };
    try {
      raw = await this.fetchImpl(request.url, {
        method: "POST",
        headers: request.headers,
        body: request.body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      const code =
        name === "TimeoutError" || name === "AbortError"
          ? "TimeoutError"
          : "NetworkError";
      throw new TencentSmsError(
        code,
        error instanceof Error ? error.message : String(error),
      );
    }
    try {
      return (await raw.json()) as TencentSmsResponse;
    } catch {
      // 例如网关返回 502 HTML：不能让它变成「验证码行已删、堆栈看不懂」的 500
      throw new TencentSmsError("MalformedResponse", "返回体不是合法 JSON");
    }
  }
}

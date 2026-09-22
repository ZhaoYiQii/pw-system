import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createSign,
  createVerify,
  randomBytes,
} from "node:crypto";

/**
 * S4-1：微信支付**服务商模式** APIv3 客户端（JSAPI 下单 / 关单 / 回调验签与解密）。
 *
 * 官方口径（2026-09-23 从 `https://pay.weixin.qq.com/doc/v3/merchant/llms.txt` 索引取的 `.md` 原文）：
 * - 请求签名串（带 Body 的接口）：`HTTP方法\nURL\n时间戳\n随机串\n请求报文主体\n`
 *   —— 每一行都以 `\n` 结尾，**包括最后一行**；空 body 时第 5 行只有一个 `\n`。
 *   来源：`/doc/v3/merchant/4012365336.md`
 * - 签名算法：商户 API 私钥做 `SHA256 with RSA`，结果 Base64；请求头
 *   `Authorization: WECHATPAY2-SHA256-RSA2048 mchid="..",nonce_str="..",signature="..",timestamp="..",serial_no=".."`
 * - 回调验签串：`时间戳\n随机串\n报文主体\n`，用 `Wechatpay-Serial` 对应的平台证书/微信支付公钥验签。
 * - 回调业务数据在 `resource`，`AEAD_AES_256_GCM`，用 APIv3 密钥 + `nonce` + `associated_data` 解密；
 *   Base64 解码后的密文 = 密文串 + 末 16 字节 auth tag。
 * - 本机无法证明的只有一件事：**真实调用**（需要服务商凭证）。签名正确性用官方给的那对
 *   测试私钥 + 官方期望签名值做固定向量（见 spec）。
 */

export const WECHATPAY_AUTH_SCHEME = "WECHATPAY2-SHA256-RSA2048";
const DEFAULT_API_BASE = "https://api.mch.weixin.qq.com";
/** 下单/关单是同步接口：10 秒足够，且不该把用户请求挂死（与短信/微信登录同一取舍）。 */
const REQUEST_TIMEOUT_MS = 10_000;

const REQUIRED_ENV = [
  "WXPAY_SP_MCHID",
  "WXPAY_SP_APPID",
  "WXPAY_API_V3_KEY",
  "WXPAY_MCH_CERT_PATH",
  "WXPAY_MCH_CERT_SERIAL",
  "WXPAY_NOTIFY_URL",
] as const;

export interface WechatPayVerifier {
  /** 平台证书序列号，或微信支付公钥 ID。 */
  serialNo: string;
  publicKeyPem: string;
}

export interface WechatPayPartnerConfig {
  spMchid: string;
  spAppid: string;
  apiV3Key: string;
  privateKeyPem: string;
  merchantSerialNo: string;
  notifyUrl: string;
  apiBase: string;
  verifiers: WechatPayVerifier[];
}

/** 缺任一必需变量 → **启动期**报错并点名（沿用 S1a/S2/S3 的 fail-closed 口径）。 */
export function loadWechatPayPartnerConfig(input: {
  env?: NodeJS.ProcessEnv;
  readFile: (path: string) => string;
}): WechatPayPartnerConfig {
  const env = input.env ?? process.env;
  const missing = REQUIRED_ENV.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(
      `微信支付（服务商模式）缺少必需环境变量：${missing.join(", ")}（见 docs/superpowers/plans/2026-09-23-wechatpay-partner-design.md）`,
    );
  }
  const apiV3Key = env.WXPAY_API_V3_KEY as string;
  if (Buffer.from(apiV3Key, "utf8").length !== 32) {
    throw new Error("WXPAY_API_V3_KEY 必须是 32 字节（微信支付 APIv3 密钥）");
  }
  const privateKeyPem = input.readFile(env.WXPAY_MCH_CERT_PATH as string);
  if (!privateKeyPem.includes("PRIVATE KEY")) {
    throw new Error("WXPAY_MCH_CERT_PATH 指向的文件不是 PEM 私钥");
  }
  const verifiers: WechatPayVerifier[] = [];
  if (env.WXPAY_PLATFORM_CERT_PATH && env.WXPAY_PLATFORM_CERT_SERIAL) {
    verifiers.push({
      serialNo: env.WXPAY_PLATFORM_CERT_SERIAL,
      publicKeyPem: input.readFile(env.WXPAY_PLATFORM_CERT_PATH),
    });
  }
  if (env.WXPAY_PUBLIC_KEY_PATH && env.WXPAY_PUBLIC_KEY_ID) {
    verifiers.push({
      serialNo: env.WXPAY_PUBLIC_KEY_ID,
      publicKeyPem: input.readFile(env.WXPAY_PUBLIC_KEY_PATH),
    });
  }
  return {
    spMchid: env.WXPAY_SP_MCHID as string,
    spAppid: env.WXPAY_SP_APPID as string,
    apiV3Key,
    privateKeyPem,
    merchantSerialNo: env.WXPAY_MCH_CERT_SERIAL as string,
    notifyUrl: env.WXPAY_NOTIFY_URL as string,
    apiBase: env.WXPAY_API_BASE ?? DEFAULT_API_BASE,
    verifiers,
  };
}

/** 请求签名串（带 Body 的接口）。每一行含最后一行都以 `\n` 结尾。 */
export function buildRequestSignString(input: {
  method: string;
  urlPath: string;
  timestamp: number | string;
  nonce: string;
  body: string;
}): string {
  return `${input.method}\n${input.urlPath}\n${input.timestamp}\n${input.nonce}\n${input.body}\n`;
}

/** 回调/应答验签串：时间戳、随机串、报文主体，三行均以 `\n` 结尾。 */
export function buildNotificationSignString(input: {
  timestamp: number | string;
  nonce: string;
  body: string;
}): string {
  return `${input.timestamp}\n${input.nonce}\n${input.body}\n`;
}

export function signRsaSha256(privateKeyPem: string, message: string): string {
  return createSign("RSA-SHA256")
    .update(message, "utf8")
    .sign(privateKeyPem, "base64");
}

export function verifyRsaSha256(
  publicKeyPem: string,
  message: string,
  signatureBase64: string,
): boolean {
  try {
    return createVerify("RSA-SHA256")
      .update(message, "utf8")
      .verify(publicKeyPem, signatureBase64, "base64");
  } catch {
    return false;
  }
}

export function buildAuthorizationHeader(input: {
  spMchid: string;
  merchantSerialNo: string;
  privateKeyPem: string;
  method: string;
  urlPath: string;
  body: string;
  timestamp: number | string;
  nonce: string;
}): string {
  const signature = signRsaSha256(
    input.privateKeyPem,
    buildRequestSignString(input),
  );
  return (
    `${WECHATPAY_AUTH_SCHEME} mchid="${input.spMchid}",nonce_str="${input.nonce}",` +
    `signature="${signature}",timestamp="${input.timestamp}",serial_no="${input.merchantSerialNo}"`
  );
}

/** AES-256-GCM 解密（回调 resource）。密文 Base64 解码后 = 密文 + 末 16 字节 auth tag。 */
export function decryptAesGcm(input: {
  apiV3Key: string;
  ciphertext: string;
  nonce: string;
  associatedData?: string;
}): string {
  const key = Buffer.from(input.apiV3Key, "utf8");
  if (key.length !== 32) throw new Error("APIv3 密钥必须是 32 字节");
  const raw = Buffer.from(input.ciphertext, "base64");
  if (raw.length <= 16) throw new Error("密文长度非法");
  const authTag = raw.subarray(raw.length - 16);
  const payload = raw.subarray(0, raw.length - 16);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(input.nonce, "utf8"),
  );
  decipher.setAuthTag(authTag);
  if (input.associatedData !== undefined) {
    decipher.setAAD(Buffer.from(input.associatedData, "utf8"));
  }
  return Buffer.concat([decipher.update(payload), decipher.final()]).toString(
    "utf8",
  );
}

/** 与解密对称，用于本地夹具/单测构造回调报文（生产代码路径不使用）。 */
export function encryptAesGcm(input: {
  apiV3Key: string;
  plaintext: string;
  nonce: string;
  associatedData?: string;
}): string {
  const key = Buffer.from(input.apiV3Key, "utf8");
  if (key.length !== 32) throw new Error("APIv3 密钥必须是 32 字节");
  const cipher = createCipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(input.nonce, "utf8"),
  );
  if (input.associatedData !== undefined) {
    cipher.setAAD(Buffer.from(input.associatedData, "utf8"));
  }
  const enc = Buffer.concat([
    cipher.update(Buffer.from(input.plaintext, "utf8")),
    cipher.final(),
  ]);
  return Buffer.concat([enc, cipher.getAuthTag()]).toString("base64");
}

export type WechatPayFailureKind = "rate_limited" | "retryable" | "permanent";

export function classifyWechatPayFailure(input: {
  httpStatus: number;
  code?: string;
}): WechatPayFailureKind {
  // 传输层合成的码（网络/超时）与 5xx 一样可重试，不能用 httpStatus=0 判成永久失败
  if (input.code === "NetworkError" || input.code === "TimeoutError")
    return "retryable";
  if (input.httpStatus === 429) return "rate_limited";
  if (input.httpStatus >= 500) return "retryable";
  return "permanent";
}

export class WechatPayError extends Error {
  readonly kind: WechatPayFailureKind;
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    message: string,
  ) {
    super(`微信支付失败 [${code || `HTTP ${httpStatus}`}] ${message}`);
    this.name = "WechatPayError";
    this.kind = classifyWechatPayFailure({
      httpStatus,
      ...(code ? { code } : {}),
    });
  }
}

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface JsapiPrepayInput {
  subMchid: string;
  spOpenid: string;
  outTradeNo: string;
  description: string;
  amountFen: number;
  notifyUrl?: string;
  timeExpire?: string;
  attach?: string;
}

export interface JsapiPayParams {
  appId: string;
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: "RSA";
  paySign: string;
}

export class WechatPayPartnerClient {
  constructor(
    private readonly config: WechatPayPartnerConfig,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  /** 服务商商户号（下单/审计时需要落库，故对外暴露只读值）。 */
  get spMchid(): string {
    return this.config.spMchid;
  }

  /** JSAPI 下单：`sp_appid` + `sp_mchid` + `sub_mchid` + `payer.sp_openid`（官方 4012738519）。 */
  async jsapiPrepay(input: JsapiPrepayInput): Promise<{ prepayId: string }> {
    const body = JSON.stringify({
      sp_appid: this.config.spAppid,
      sp_mchid: this.config.spMchid,
      sub_mchid: input.subMchid,
      description: input.description,
      out_trade_no: input.outTradeNo,
      ...(input.timeExpire ? { time_expire: input.timeExpire } : {}),
      attach: input.attach ?? undefined,
      notify_url: input.notifyUrl ?? this.config.notifyUrl,
      amount: { total: input.amountFen, currency: "CNY" },
      payer: { sp_openid: input.spOpenid },
    });
    const response = await this.request(
      "POST",
      "/v3/pay/transactions/jsapi",
      body,
    );
    const prepayId = (response as { prepay_id?: string }).prepay_id;
    if (!prepayId)
      throw new WechatPayError("EmptyResponse", 200, "应答缺少 prepay_id");
    return { prepayId };
  }

  /** 关闭订单：`time_expire` 只是"不能再付"，关单要显式调这个接口。 */
  async closeOrder(input: {
    subMchid: string;
    outTradeNo: string;
  }): Promise<void> {
    const body = JSON.stringify({
      sp_mchid: this.config.spMchid,
      sub_mchid: input.subMchid,
    });
    await this.request(
      "POST",
      `/v3/pay/transactions/out-trade-no/${encodeURIComponent(input.outTradeNo)}/close`,
      body,
    );
  }

  /**
   * 申请交易账单（官方 partner/4012739068）：返回 SHA1 摘要与 5 分钟有效的下载地址。
   * 注意：官方「次日 9 点开始生成前一天账单，建议 10 点后获取」。
   */
  async requestTradeBill(input: {
    billDate: string;
    subMchid?: string;
    billType?: "ALL" | "SUCCESS" | "REFUND";
  }): Promise<{ hashType: string; hashValue: string; downloadUrl: string }> {
    const params = new URLSearchParams({
      bill_date: input.billDate,
      bill_type: input.billType ?? "ALL",
    });
    if (input.subMchid) params.set("sub_mchid", input.subMchid);
    const response = (await this.request(
      "GET",
      `/v3/bill/tradebill?${params.toString()}`,
      "",
    )) as { hash_type?: string; hash_value?: string; download_url?: string };
    if (!response.download_url || !response.hash_value) {
      throw new WechatPayError(
        "EmptyResponse",
        200,
        "账单应答缺少 download_url/hash_value",
      );
    }
    return {
      hashType: response.hash_type ?? "SHA1",
      hashValue: response.hash_value,
      downloadUrl: response.download_url,
    };
  }

  /**
   * 下载账单文件正文。官方（partner/4012085421）：对 download_url 也按 V3 规则签名，
   * 但**响应的请求头里没有签名，跳过验签**；完整性靠调用方比对 SHA1。
   */
  async downloadBillText(downloadUrl: string): Promise<string> {
    const url = new URL(downloadUrl);
    const urlPath = `${url.pathname}${url.search}`;
    const timestamp = this.now();
    const nonce = randomBytes(16).toString("hex").toUpperCase();
    const authorization = buildAuthorizationHeader({
      spMchid: this.config.spMchid,
      merchantSerialNo: this.config.merchantSerialNo,
      privateKeyPem: this.config.privateKeyPem,
      method: "GET",
      urlPath,
      body: "",
      timestamp,
      nonce,
    });
    const response = await this.fetchImpl(downloadUrl, {
      method: "GET",
      headers: { accept: "*/*", authorization, "user-agent": "pw-saas/1.0" },
      body: "",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    if (response.status >= 400) {
      throw new WechatPayError(
        "BillDownloadFailed",
        response.status,
        text.slice(0, 200),
      );
    }
    return text;
  }

  /**
   * 前端调起支付参数。签名串为 `appId\ntimeStamp\nnonceStr\npackage\n`（官方「JSAPI调起支付」）。
   * 注意 `appId` 必须与下单时的 `sp_appid`、实际调起的公众号一致。
   */
  buildJsapiPayParams(input: {
    prepayId: string;
    timestamp?: number;
    nonce?: string;
  }): JsapiPayParams {
    const timeStamp = String(input.timestamp ?? this.now());
    const nonceStr = input.nonce ?? randomBytes(16).toString("hex");
    const pkg = `prepay_id=${input.prepayId}`;
    const paySign = signRsaSha256(
      this.config.privateKeyPem,
      `${this.config.spAppid}\n${timeStamp}\n${nonceStr}\n${pkg}\n`,
    );
    return {
      appId: this.config.spAppid,
      timeStamp,
      nonceStr,
      package: pkg,
      signType: "RSA",
      paySign,
    };
  }

  /** 回调验签：按 `Wechatpay-Serial` 选择平台证书/微信支付公钥（双来源并行，支持轮换）。 */
  verifyNotification(input: {
    headers: Record<string, string | undefined>;
    rawBody: string;
  }): boolean {
    const serial =
      input.headers["wechatpay-serial"] ?? input.headers["Wechatpay-Serial"];
    const signature =
      input.headers["wechatpay-signature"] ??
      input.headers["Wechatpay-Signature"];
    const timestamp =
      input.headers["wechatpay-timestamp"] ??
      input.headers["Wechatpay-Timestamp"];
    const nonce =
      input.headers["wechatpay-nonce"] ?? input.headers["Wechatpay-Nonce"];
    if (!serial || !signature || !timestamp || !nonce) return false;
    const verifier = this.config.verifiers.find(
      (item) => item.serialNo === serial,
    );
    if (!verifier) return false;
    return verifyRsaSha256(
      verifier.publicKeyPem,
      buildNotificationSignString({ timestamp, nonce, body: input.rawBody }),
      signature,
    );
  }

  /** 解密回调 `resource` 并解析 JSON。 */
  decryptNotificationResource(resource: {
    ciphertext: string;
    nonce: string;
    associated_data?: string;
  }): unknown {
    const plaintext = decryptAesGcm({
      apiV3Key: this.config.apiV3Key,
      ciphertext: resource.ciphertext,
      nonce: resource.nonce,
      ...(resource.associated_data !== undefined
        ? { associatedData: resource.associated_data }
        : {}),
    });
    try {
      return JSON.parse(plaintext);
    } catch {
      throw new WechatPayError(
        "BadResourcePayload",
        200,
        "resource 解密后不是合法 JSON",
      );
    }
  }

  private async request(
    method: "GET" | "POST",
    urlPath: string,
    body: string,
  ): Promise<unknown> {
    const timestamp = this.now();
    const nonce = randomBytes(16).toString("hex").toUpperCase();
    const authorization = buildAuthorizationHeader({
      spMchid: this.config.spMchid,
      merchantSerialNo: this.config.merchantSerialNo,
      privateKeyPem: this.config.privateKeyPem,
      method,
      urlPath,
      body,
      timestamp,
      nonce,
    });
    let response: { status: number; text(): Promise<string> };
    try {
      response = await this.fetchImpl(`${this.config.apiBase}${urlPath}`, {
        method,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization,
          "user-agent": "pw-saas/1.0",
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      const code =
        name === "TimeoutError" || name === "AbortError"
          ? "TimeoutError"
          : "NetworkError";
      throw new WechatPayError(
        code,
        0,
        error instanceof Error ? error.message : String(error),
      );
    }
    const text = await response.text();
    const parsed = text ? safeJson(text) : {};
    if (response.status >= 400) {
      const code = typeof parsed?.code === "string" ? parsed.code : "";
      const message =
        typeof parsed?.message === "string"
          ? parsed.message
          : text.slice(0, 200);
      throw new WechatPayError(code, response.status, message);
    }
    return parsed;
  }
}

function safeJson(text: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** 账单文件完整性：官方 hash_type 固定 SHA1，下载后应按此比对。 */
export function sha1Hex(text: string): string {
  return createHash("sha1").update(text, "utf8").digest("hex");
}

/** 便于日志/审计：对请求体做指纹，避免把包含 openid 的原文写进日志。 */
export function bodyFingerprint(body: string): string {
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  WechatPayError,
  WechatPayPartnerClient,
  buildNotificationSignString,
  buildRequestSignString,
  classifyWechatPayFailure,
  decryptAesGcm,
  encryptAesGcm,
  loadWechatPayPartnerConfig,
  signRsaSha256,
  verifyRsaSha256,
  type WechatPayPartnerConfig,
} from "./wechatpay-partner.client.js";

/**
 * 官方给的测试私钥与期望签名（《带 Body 参数如何计算签名》官方文档内附）。
 * 这是**唯一**能把"签名串格式 + RSA-SHA256 + Base64"三件事一次钉死的外部向量：
 * 我们算出来的签名必须与官方给的值逐字符相同。
 * 来源：https://pay.weixin.qq.com/doc/v3/merchant/4012365336.md
 */
const OFFICIAL_TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCm2mb6q8gMKH/3
CNTbpJAIrbqiBiQGEOtjGcBrDYltsGynWgNscqT7WvfzU14FQbYcQUC5T4Wvva7m
i3fIp3OgX8VqMDNA0qebnr38Pe6kqiLyZgFpJPXlSKDyPyqhRbVTbXssvSMQeVKc
dXeVxoNNeoOlNFHgF/P0io6AmAVnz+hN8SiZKuOsth5/zUTLGvtkgxBcQooQrtXh
RcpLT798OyIb9xeJ2HO3xRtMv2+perEzb4gMibI74UBz+2QEbnkubPE+2jU2rRZu
dnNEz/BPOt3Qj/w2V6/G0VumGDh6+UeMU0jv4aupHztWITC4Akn0l7lBCNy3lgl8
VFaJnkIxAgMBAAECggEAYGL8aESB7NwciDWW2UdoWUsa7GxFtSdjAz2mFXGdeTsY
mVh7b9OOkRGM+Qio4LqEHDBp1mMk5E/cUJwy1zw8pGGO5nfvs7u9TT3XnHaefIs4
YvUgTYAneIuLRkXNN5rQU+CD7mVYczTSz0Vgjqo9wa1LjUz7G0xbBmJgTdMEFGJs
eJjy6AbJo0CGIwp6HJbTm4CmOUgXnnDAIbEGTIRImkZFH/rzneIeR7oZ77FVwxr1
CZB2gfRCov/yRPbw8vnryYkmvQ7D/ze3j5097vRg/MoDGBSdoOwcmo75vyofr0AS
zytMjmHYyifqkf5slPropSiJeGf4p/7gtKyF6dE/XQKBgQDVAlJ+4U5ZVGOuDc3+
sAhz8CTzgFNlq9vKuSoFK6hOz2L+cwj+E7NXGkOe2DsHHZNy2Xqxk7caKhPEp1z9
hhpMpyLVMoFt6CKemyoRBWDCQwLLwem9SZF/IAyovBkLiH36P42Jm26gUkNMKC/5
Zhtqxf6RZgRQzbVudJi47vIRCwKBgQDIh0+v27Oo+DM3fhObH4I1NrXpWOEGH7OQ
G1dEsMuFYF4hjGhg0kBEP3w9vVdl2+mRllZKTsx9oqjb8OibPLLIH8xsdbAB0WLf
JvjLu4wl/ILUzN1RI03dWnnv2EnEeQn6c3hizvrJ9wR5U4ue9RPVnQooJ0hZF1PU
uCL5fWK3MwKBgElReU/PAYbh80WP3t3Rfbdaa32dKBeQ5iCLR5lsA4zM+YgX1HqQ
EWTj126vgvHaDkyz6vWAoL/Sx+cirHFfXWIRDX5Q2hgYlQH+6qXdMgbrxeSYpHnQ
/tHBGFpkFELSAnrGsVMyOwvYBO4LzyeLK9i+ufcWJFoj1FVmsMLHDG8tAoGARdbi
iQQCoYG4DMarO2aQ6cmhN6EN1h0qY7EyBqlwaIZ0okiNfdMcMOjPc41DKCWcRmlO
qlihXcxN9TQFPzO3rH1urAOdBjUPs1qWYhZyrDQyuLyVBBJApyxAtajloDjrob+f
mQIvVDHk7ACN6xG+E7K6+9salnTKbJapD618uQMCgYBNy6XUvzLkP/A1U/UZdtcx
l8GwU/dturLxz4CyGbqDw4ubaYY2e13lnqHUqQgPtiSyH51nq3tdo8G0YAJdfkSv
KvnfslW91fyEBUKnkdW1o3/1UFU/wprZ7ixVL/F42A4xDu7OFE8EnweJOZ0jWceE
OdhCkaIGBCfRnlECRK8UyQ==
-----END PRIVATE KEY-----`;

const OFFICIAL_BODY =
  '{"appid":"wxd678efh567hg6787","mchid":"1900007291","description":"Image形象店-深圳腾大-QQ公仔","out_trade_no":"1217752501201407033233368018","notify_url":"https://www.weixin.qq.com/wxpay/pay.php","amount":{"total":100,"currency":"CNY"},"payer":{"openid":"oUpF8uMuAJO_M2pxb1Q9zNjWeS6o"}}';
const OFFICIAL_TIMESTAMP = 1554208460;
const OFFICIAL_NONCE = "593BEC0C930BF1AFEB40B4A08C8FB242";
const OFFICIAL_SIGNATURE =
  "jnks4dlrPw3ZX+ozVvSK39oa0t7OMBsg83BHAwd8BRdUFiVaQNTLTvci+wURgP1OQBbKYhFGvt7iqYpDSTQkp7Uq1sltaQKyncCyrA1g88m5bsKERQfPyT0ahSwKTYJ1CAn9QiJuSJRq1QsQs07eehbU/k9BCS51jTyc1Jpsi2H77HF9f/BnjXAOP3/sPObg6V5Ee4EzwLox684hhuMuIwHo7D8KFk3LIHOKDcNI4It1aCXydFWNpNK+SG86VUDe5kwoDpw4Ulqfu9z8OFDGbDs9TCxEv8iqQzbpxOlEVoOe2kalSYM5kApQb3nZcxdUtoE0liJGW3RGUNE0t4v01A==";

const API_V3_KEY = "0123456789abcdef0123456789abcdef"; // 32 字节

function config(
  overrides: Partial<WechatPayPartnerConfig> = {},
): WechatPayPartnerConfig {
  return {
    spMchid: "1900007291",
    spAppid: "wxd678efh567hg6787",
    apiV3Key: API_V3_KEY,
    privateKeyPem: OFFICIAL_TEST_KEY,
    merchantSerialNo: "408B07E79B8269FEC3D5D3E6AB8ED163A6A380DB",
    notifyUrl: "https://h5.17ai.club/api/v1/payments/wechatpay/notify",
    apiBase: "https://api.mch.weixin.qq.com",
    verifiers: [],
    ...overrides,
  };
}

describe("S4-1：微信支付服务商客户端（可独立验证的部分）", () => {
  it("**官方固定向量**：签名串格式 + RSA-SHA256 + Base64 与官方期望签名逐字符一致", () => {
    const signString = buildRequestSignString({
      method: "POST",
      urlPath: "/v3/pay/transactions/jsapi",
      timestamp: OFFICIAL_TIMESTAMP,
      nonce: OFFICIAL_NONCE,
      body: OFFICIAL_BODY,
    });
    expect(signString.split("\n")).toHaveLength(6); // 5 行 + 结尾空串
    expect(signString.endsWith("\n")).toBe(true);
    expect(signRsaSha256(OFFICIAL_TEST_KEY, signString)).toBe(
      OFFICIAL_SIGNATURE,
    );
  });

  it("空 body 的签名串：第 5 行只有一个换行（官方对 GET /v3/certificates 的说明）", () => {
    expect(
      buildRequestSignString({
        method: "GET",
        urlPath: "/v3/certificates",
        timestamp: OFFICIAL_TIMESTAMP,
        nonce: OFFICIAL_NONCE,
        body: "",
      }),
    ).toBe(
      `GET\n/v3/certificates\n${OFFICIAL_TIMESTAMP}\n${OFFICIAL_NONCE}\n\n`,
    );
  });

  it("回调验签串：时间戳/随机串/报文三行，均以换行结尾", () => {
    expect(
      buildNotificationSignString({ timestamp: 1, nonce: "N", body: "{}" }),
    ).toBe("1\nN\n{}\n");
  });

  it("验签：同一密钥对的签名可验证；改一个字符即失败", () => {
    const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicKeyPem = createPublicKey(keyPair.privateKey)
      .export({ type: "spki", format: "pem" })
      .toString();
    const message = buildNotificationSignString({
      timestamp: 1,
      nonce: "N",
      body: '{"a":1}',
    });
    const signature = signRsaSha256(
      keyPair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      message,
    );
    expect(verifyRsaSha256(publicKeyPem, message, signature)).toBe(true);
    const tampered = `${signature.slice(0, -2)}${signature.endsWith("aa") ? "bb" : "aa"}`;
    expect(verifyRsaSha256(publicKeyPem, message, tampered)).toBe(false);
  });

  it("回调验签走客户端：按 Wechatpay-Serial 选证书；序列号不匹配或缺头都拒绝", () => {
    const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicKeyPem = createPublicKey(keyPair.privateKey)
      .export({ type: "spki", format: "pem" })
      .toString();
    const privateKeyPem = keyPair.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    const rawBody = '{"id":"EV-1","event_type":"TRANSACTION.SUCCESS"}';
    const signature = signRsaSha256(
      privateKeyPem,
      buildNotificationSignString({
        timestamp: 1700000000,
        nonce: "NONCE",
        body: rawBody,
      }),
    );
    const client = new WechatPayPartnerClient(
      config({ verifiers: [{ serialNo: "SERIAL-1", publicKeyPem }] }),
    );
    const headers = {
      "wechatpay-serial": "SERIAL-1",
      "wechatpay-signature": signature,
      "wechatpay-timestamp": "1700000000",
      "wechatpay-nonce": "NONCE",
    };
    expect(client.verifyNotification({ headers, rawBody })).toBe(true);
    expect(
      client.verifyNotification({
        headers: { ...headers, "wechatpay-serial": "OTHER" },
        rawBody,
      }),
    ).toBe(false);
    expect(
      client.verifyNotification({
        headers: { ...headers, "wechatpay-signature": undefined },
        rawBody,
      }),
    ).toBe(false);
    expect(client.verifyNotification({ headers, rawBody: `${rawBody} ` })).toBe(
      false,
    );
  });

  it("AES-256-GCM 解密：往返一致；密文被篡改则抛错（认证标签生效）", () => {
    const nonce = "abcdefghijkl";
    const associatedData = "transaction";
    const plaintext = JSON.stringify({
      out_trade_no: "P1",
      amount: { total: 100 },
    });
    const ciphertext = encryptAesGcm({
      apiV3Key: API_V3_KEY,
      plaintext,
      nonce,
      associatedData,
    });
    expect(
      decryptAesGcm({
        apiV3Key: API_V3_KEY,
        ciphertext,
        nonce,
        associatedData,
      }),
    ).toBe(plaintext);
    const broken = Buffer.from(ciphertext, "base64");
    broken[0] = broken[0]! ^ 0x01;
    expect(() =>
      decryptAesGcm({
        apiV3Key: API_V3_KEY,
        ciphertext: broken.toString("base64"),
        nonce,
        associatedData,
      }),
    ).toThrow();
  });

  it("解密后解析 JSON；非法 JSON 报类型化错误", () => {
    const nonce = "abcdefghijkl";
    const client = new WechatPayPartnerClient(config());
    const valid = encryptAesGcm({
      apiV3Key: API_V3_KEY,
      plaintext: '{"a":1}',
      nonce,
    });
    expect(
      client.decryptNotificationResource({ ciphertext: valid, nonce }),
    ).toEqual({ a: 1 });
    const invalid = encryptAesGcm({
      apiV3Key: API_V3_KEY,
      plaintext: "not-json",
      nonce,
    });
    expect(() =>
      client.decryptNotificationResource({ ciphertext: invalid, nonce }),
    ).toThrowError(/不是合法 JSON/);
  });

  it("JSAPI 下单：请求体带 sp_appid/sp_mchid/sub_mchid/payer.sp_openid/整数分/notify_url，且带 Authorization 头", async () => {
    const seen: Array<{
      url: string;
      headers: Record<string, string>;
      body: string;
    }> = [];
    const client = new WechatPayPartnerClient(
      config(),
      async (url, init) => {
        seen.push({ url, headers: init.headers, body: init.body });
        return {
          status: 200,
          text: async () =>
            '{"prepay_id":"wx201410272009395522657a690389285100"}',
        };
      },
      () => 1700000000,
    );
    const result = await client.jsapiPrepay({
      subMchid: "1900007292",
      spOpenid: "oUpF8uMuAJO_M2pxb1Q9zNjWeS6o",
      outTradeNo: "PW20260923001",
      description: "陪玩订单",
      amountFen: 12345,
    });
    expect(result.prepayId).toBe("wx201410272009395522657a690389285100");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe(
      "https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi",
    );
    expect(seen[0]!.headers.authorization).toMatch(
      /^WECHATPAY2-SHA256-RSA2048 mchid="1900007291",nonce_str="[0-9A-F]+",signature="[A-Za-z0-9+/=]+",timestamp="1700000000",serial_no="408B07E79B8269FEC3D5D3E6AB8ED163A6A380DB"$/,
    );
    expect(JSON.parse(seen[0]!.body)).toEqual({
      sp_appid: "wxd678efh567hg6787",
      sp_mchid: "1900007291",
      sub_mchid: "1900007292",
      description: "陪玩订单",
      out_trade_no: "PW20260923001",
      notify_url: "https://h5.17ai.club/api/v1/payments/wechatpay/notify",
      amount: { total: 12345, currency: "CNY" },
      payer: { sp_openid: "oUpF8uMuAJO_M2pxb1Q9zNjWeS6o" },
    });
  });

  it("关单：走 out-trade-no 接口并带 sub_mchid", async () => {
    let captured = { url: "", body: "" };
    const client = new WechatPayPartnerClient(config(), async (url, init) => {
      captured = { url, body: init.body };
      return { status: 204, text: async () => "" };
    });
    await client.closeOrder({
      subMchid: "1900007292",
      outTradeNo: "PW20260923001",
    });
    expect(captured.url).toBe(
      "https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/PW20260923001/close",
    );
    expect(JSON.parse(captured.body)).toEqual({
      sp_mchid: "1900007291",
      sub_mchid: "1900007292",
    });
  });

  it("错误映射：401 SIGN_ERROR → permanent 且带原始 code；429 → rate_limited；500 → retryable", async () => {
    const failing = (status: number, body: string) =>
      new WechatPayPartnerClient(config(), async () => ({
        status,
        text: async () => body,
      }));
    await expect(
      failing(401, '{"code":"SIGN_ERROR","message":"签名错误"}').closeOrder({
        subMchid: "1900007292",
        outTradeNo: "X",
      }),
    ).rejects.toMatchObject({
      code: "SIGN_ERROR",
      httpStatus: 401,
      kind: "permanent",
    });
    await expect(
      failing(
        429,
        '{"code":"FREQUENCY_LIMITED","message":"频率限制"}',
      ).closeOrder({
        subMchid: "1900007292",
        outTradeNo: "X",
      }),
    ).rejects.toMatchObject({ kind: "rate_limited" });
    await expect(
      failing(500, '{"code":"SYSTEM_ERROR","message":"系统异常"}').closeOrder({
        subMchid: "1900007292",
        outTradeNo: "X",
      }),
    ).rejects.toMatchObject({ kind: "retryable" });
    expect(
      classifyWechatPayFailure({ httpStatus: 400, code: "PARAM_ERROR" }),
    ).toBe("permanent");
    await expect(
      new WechatPayPartnerClient(config(), async () => {
        const abort = new Error("The operation was aborted due to timeout");
        abort.name = "TimeoutError";
        throw abort;
      }).closeOrder({ subMchid: "1900007292", outTradeNo: "X" }),
    ).rejects.toBeInstanceOf(WechatPayError);
  });

  it("调起支付参数：字段齐备、package=prepay_id=...、signType=RSA，且 paySign 可被对应公钥验证", () => {
    const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPem = keyPair.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    const publicKeyPem = createPublicKey(keyPair.privateKey)
      .export({ type: "spki", format: "pem" })
      .toString();
    const client = new WechatPayPartnerClient(config({ privateKeyPem }));
    const params = client.buildJsapiPayParams({
      prepayId: "wx201410272009395522657a690389285100",
      timestamp: 1700000000,
      nonce: "NONCE123",
    });
    expect(params).toMatchObject({
      appId: "wxd678efh567hg6787",
      timeStamp: "1700000000",
      nonceStr: "NONCE123",
      package: "prepay_id=wx201410272009395522657a690389285100",
      signType: "RSA",
    });
    expect(
      verifyRsaSha256(
        publicKeyPem,
        `wxd678efh567hg6787\n1700000000\nNONCE123\nprepay_id=wx201410272009395522657a690389285100\n`,
        params.paySign,
      ),
    ).toBe(true);
  });

  it("配置门禁：缺变量时启动即失败并点名；APIv3 密钥长度不对也拒绝", () => {
    expect(() =>
      loadWechatPayPartnerConfig({ env: {}, readFile: () => "" }),
    ).toThrowError(/WXPAY_SP_MCHID/);
    const env = {
      WXPAY_SP_MCHID: "1900007291",
      WXPAY_SP_APPID: "wxd678efh567hg6787",
      WXPAY_API_V3_KEY: "short",
      WXPAY_MCH_CERT_PATH: "/tmp/key.pem",
      WXPAY_MCH_CERT_SERIAL: "SERIAL",
      WXPAY_NOTIFY_URL: "https://h5.17ai.club/notify",
    };
    expect(() =>
      loadWechatPayPartnerConfig({ env, readFile: () => OFFICIAL_TEST_KEY }),
    ).toThrowError(/32 字节/);
  });
});

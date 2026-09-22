import {
  createHash,
  createPublicKey,
  createVerify,
  generateKeyPairSync,
} from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  WechatPayError,
  WechatPayPartnerClient,
  assertUploadableMedia,
  buildMultipartBody,
  signRequestBody,
  type WechatPayPartnerConfig,
} from "./wechatpay-partner.client.js";

/**
 * S4-5b-2：进件材料图片上传（官方「文件上传」partner/4012760490，零凭证）。
 *
 * 两个容易做错、也最容易在真机才炸的点，这里都钉死：
 * 1. **签名覆盖的是 multipart 体的原始字节**（不是 JSON 字符串）——所以签名用 Buffer 参与计算；
 * 2. `meta.sha256` 必须是**文件二进制内容**的摘要，微信会拿它校验上传内容。
 */

const BOUNDARY = "pwboundary0123456789";
const JPG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

function config(privateKeyPem: string): WechatPayPartnerConfig {
  return {
    spMchid: "1900013511",
    spAppid: "wxappid",
    apiV3Key: "0123456789abcdef0123456789abcdef",
    privateKeyPem,
    merchantSerialNo: "MCH-SERIAL",
    notifyUrl: "https://h5.17ai.club/api/v1/payments/wechatpay/notify",
    apiBase: "https://api.mch.weixin.qq.com",
    verifiers: [],
  };
}

describe("S4-5b-2：进件材料上传", () => {
  it("multipart 体格式：meta(JSON) + file(原始字节) + CRLF 边界，且 sha256 是文件内容的摘要", () => {
    const sha256 = createHash("sha256").update(JPG_BYTES).digest("hex");
    const body = buildMultipartBody({
      boundary: BOUNDARY,
      metaJson: JSON.stringify({ filename: "biz.jpg", sha256 }),
      filename: "biz.jpg",
      mimeType: "image/jpeg",
      content: JPG_BYTES,
    });
    const text = body.toString("latin1");
    expect(text.startsWith(`--${BOUNDARY}\r\n`)).toBe(true);
    expect(text).toContain('name="meta"');
    expect(text).toContain("Content-Type: application/json");
    expect(text).toContain(`"filename":"biz.jpg"`);
    expect(text).toContain(`"sha256":"${sha256}"`);
    expect(text).toContain('name="file"; filename="biz.jpg"');
    expect(text).toContain("Content-Type: image/jpeg");
    expect(text.endsWith(`\r\n--${BOUNDARY}--\r\n`)).toBe(true);
    // 原始字节一字不差地出现在体内（用 Buffer.indexOf 比断言字符串更可靠）
    expect(body.indexOf(JPG_BYTES)).toBeGreaterThan(0);
  });

  it("签名覆盖二进制正文：能被我方公钥验签通过，且正文被改动即验签失败", () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPem = pair.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    const publicKeyPem = createPublicKey(pair.privateKey)
      .export({ type: "spki", format: "pem" })
      .toString();
    const body = buildMultipartBody({
      boundary: BOUNDARY,
      metaJson: '{"filename":"biz.jpg","sha256":"x"}',
      filename: "biz.jpg",
      mimeType: "image/jpeg",
      content: JPG_BYTES,
    });
    const parts = {
      method: "POST",
      urlPath: "/v3/merchant/media/upload",
      timestamp: 1700000000,
      nonce: "NONCE",
    };
    const signature = signRequestBody(privateKeyPem, parts, body);
    const signString = Buffer.concat([
      Buffer.from(
        `${parts.method}\n${parts.urlPath}\n${parts.timestamp}\n${parts.nonce}\n`,
        "utf8",
      ),
      body,
      Buffer.from("\n", "utf8"),
    ]);
    // 注意：这里的验签必须按**字节**验（verifyRsaSha256 走 utf8，只适用于字符串正文）
    expect(
      createVerify("RSA-SHA256")
        .update(signString)
        .verify(publicKeyPem, signature, "base64"),
    ).toBe(true);
    // 正文改一个字节 → 同一签名验不过
    const tampered = Buffer.from(body);
    tampered[tampered.length - 5] = 0x41;
    const tamperedString = Buffer.concat([
      Buffer.from(
        `${parts.method}\n${parts.urlPath}\n${parts.timestamp}\n${parts.nonce}\n`,
        "utf8",
      ),
      tampered,
      Buffer.from("\n", "utf8"),
    ]);
    expect(
      createVerify("RSA-SHA256")
        .update(tamperedString)
        .verify(publicKeyPem, signature, "base64"),
    ).toBe(false);
  });

  it("上传成功：请求头是 multipart + 带边界，正文含 sha256，应答取 media_id", async () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const client = new WechatPayPartnerClient(
      config(
        pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      ),
      async (url, init) => {
        expect(url).toBe(
          "https://api.mch.weixin.qq.com/v3/merchant/media/upload",
        );
        expect(init.method).toBe("POST");
        expect(init.headers["content-type"]).toMatch(
          /^multipart\/form-data; boundary=pw[0-9a-f]{32}$/,
        );
        expect(init.headers.authorization).toContain(
          "WECHATPAY2-SHA256-RSA2048",
        );
        const sent = Buffer.isBuffer(init.body)
          ? init.body
          : Buffer.from(init.body);
        const sha256 = createHash("sha256").update(JPG_BYTES).digest("hex");
        expect(sent.toString("latin1")).toContain(`"sha256":"${sha256}"`);
        expect(sent.indexOf(JPG_BYTES)).toBeGreaterThan(0);
        return {
          status: 200,
          text: async () =>
            '{"media_id":"H1ihR9JUtVj-J7CJqBUY5ZOrG_Je75H-rKhTG7FUmg9sxNTbRN54dFiUHnhg"}',
        };
      },
    );
    const result = await client.uploadMedia({
      filename: "biz.jpg",
      mimeType: "image/jpeg",
      content: JPG_BYTES,
    });
    expect(result.mediaId).toBe(
      "H1ihR9JUtVj-J7CJqBUY5ZOrG_Je75H-rKhTG7FUmg9sxNTbRN54dFiUHnhg",
    );
  });

  it("本地先挡一道：类型不支持 / 空文件 / 超 5M，都不发请求", async () => {
    expect(() =>
      assertUploadableMedia({ filename: "biz.gif", content: JPG_BYTES }),
    ).toThrow(/不支持的媒体文件类型/);
    expect(() =>
      assertUploadableMedia({
        filename: "biz.jpg",
        content: Buffer.alloc(0),
      }),
    ).toThrow(/内容为空/);
    expect(() =>
      assertUploadableMedia({
        filename: "biz.png",
        content: Buffer.alloc(5 * 1024 * 1024 + 1),
      }),
    ).toThrow(/超过上限/);
    // PDF 上限更宽（7.5M），6M 的 PDF 应当放行
    expect(() =>
      assertUploadableMedia({
        filename: "proof.pdf",
        content: Buffer.alloc(6 * 1024 * 1024),
      }),
    ).not.toThrow();

    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    let called = 0;
    const client = new WechatPayPartnerClient(
      config(
        pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      ),
      async () => {
        called += 1;
        return { status: 200, text: async () => "{}" };
      },
    );
    await expect(
      client.uploadMedia({
        filename: "biz.gif",
        mimeType: "image/gif",
        content: JPG_BYTES,
      }),
    ).rejects.toBeInstanceOf(WechatPayError);
    expect(called).toBe(0);
  });
});

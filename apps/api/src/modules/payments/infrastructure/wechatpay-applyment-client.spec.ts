import {
  constants,
  createPublicKey,
  generateKeyPairSync,
  privateDecrypt,
} from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SENSITIVE_FIELD_PATHS,
  WechatPayError,
  WechatPayPartnerClient,
  encryptSensitiveFields,
  rsaEncryptOaep,
  type WechatPayPartnerConfig,
} from "./wechatpay-partner.client.js";

/**
 * S4-5b：进件资料上送的**线上格式**单测（零凭证）。
 *
 * 本片唯一不能靠猜的东西：敏感字段必须用微信支付公钥 RSA-OAEP 加密、密钥串要填在
 * `Wechatpay-Serial` 头里（官方 4013059044 + 4012719997）。这里用自己生成的 RSA 密钥对
 * 做"加密→私钥解密"往返，把算法与字段清单钉死；配置缺失时必须**抛错而不是发明文**。
 */

const PUBLIC_KEY_ID = "PUB_KEY_ID_0116571234562024052000123400000000";

function keyPair() {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    privateKeyPem: pair.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    publicKeyPem: createPublicKey(pair.privateKey)
      .export({ type: "spki", format: "pem" })
      .toString(),
  };
}

function decryptOaep(privateKeyPem: string, cipherBase64: string): string {
  return privateDecrypt(
    { key: privateKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING },
    Buffer.from(cipherBase64, "base64"),
  ).toString("utf8");
}

function config(input: {
  privateKeyPem: string;
  publicKeyPem?: string;
}): WechatPayPartnerConfig {
  return {
    spMchid: "1900013511",
    spAppid: "wxappid",
    apiV3Key: "0123456789abcdef0123456789abcdef",
    privateKeyPem: input.privateKeyPem,
    merchantSerialNo: "MCH-SERIAL",
    notifyUrl: "https://h5.17ai.club/api/v1/payments/wechatpay/notify",
    apiBase: "https://api.mch.weixin.qq.com",
    verifiers: [],
    ...(input.publicKeyPem
      ? {
          publicKey: {
            publicKeyId: PUBLIC_KEY_ID,
            publicKeyPem: input.publicKeyPem,
          },
        }
      : {}),
  };
}

const INTAKE: Record<string, unknown> = {
  business_code: "1900013511_s5cwalk",
  contact_info: {
    contact_type: "LEGAL",
    contact_name: "张三",
    mobile_phone: "13800000000",
    contact_email: "boss@example.com",
  },
  subject_info: {
    subject_type: "SUBJECT_TYPE_INDIVIDUAL",
    identity_info: {
      id_card_info: {
        id_card_name: "张三",
        id_card_number: "11010119900307551X",
      },
    },
    ubo_info_list: [
      { ubo_id_doc_name: "张三", ubo_id_doc_number: "11010119900307551X" },
    ],
  },
  bank_account_info: {
    bank_account_type: "BANK_ACCOUNT_TYPE_PERSONAL",
    account_name: "张三",
    account_number: "6217000010000000000",
  },
  business_licence_info: {
    // 非敏感字段：必须原样保留（错加密会被微信判为参数错误）
    licence_number: "91110000MA0000000X",
    merchant_shortname: "示例陪玩",
  },
};

describe("S4-5b：进件敏感字段加密与提交", () => {
  it("RSA-OAEP 加密可用私钥解回原文（算法/填充与官方一致），且中文与长文本都支持", () => {
    const { privateKeyPem, publicKeyPem } = keyPair();
    for (const plaintext of [
      "张三",
      "11010119900307551X",
      "北京市朝阳区某路 1 号 2 单元 303",
      "A".repeat(200),
    ]) {
      const cipher = rsaEncryptOaep(publicKeyPem, plaintext);
      expect(cipher).not.toBe(plaintext);
      expect(decryptOaep(privateKeyPem, cipher)).toBe(plaintext);
    }
  });

  it("字段清单：15 条官方标注的敏感路径，全部被加密且可解回；其它字段原样保留", () => {
    const { privateKeyPem, publicKeyPem } = keyPair();
    const encrypted = encryptSensitiveFields(INTAKE, (text) =>
      rsaEncryptOaep(publicKeyPem, text),
    );
    const read = (path: string): unknown => readPath(encrypted, path);
    let checked = 0;
    for (const path of SENSITIVE_FIELD_PATHS) {
      const value = read(path);
      if (value === undefined) continue; // ubo/可选字段本夹具没全给
      checked += 1;
      expect(typeof value).toBe("string");
      expect(value).toMatch(/^[A-Za-z0-9+/=]+$/);
      expect(decryptOaep(privateKeyPem, value as string)).toBe(
        readPath(INTAKE, path),
      );
    }
    // 夹具里实际给了 9 条敏感字段（其余是选填/其它主体类型才用）；数量对不上说明测试自己漏了
    expect(checked).toBe(9);
    // 非敏感字段不动
    expect(read("business_code")).toBe(INTAKE.business_code);
    expect(
      (encrypted.business_licence_info as Record<string, unknown>)
        .licence_number,
    ).toBe("91110000MA0000000X");
    // 原文没被就地改坏
    expect((INTAKE.contact_info as Record<string, unknown>).contact_name).toBe(
      "张三",
    );
    // UBO 数组逐个元素都被加密
    const ubo = (
      (encrypted.subject_info as Record<string, unknown>)
        .ubo_info_list as Array<Record<string, unknown>>
    )[0]!;
    expect(decryptOaep(privateKeyPem, ubo.ubo_id_doc_name as string)).toBe(
      "张三",
    );
  });

  it("提交进件：URL/请求头/正文都符合官方要求（密文可解、Serial 是公钥 ID）", async () => {
    const { privateKeyPem, publicKeyPem } = keyPair();
    const seen: Array<{
      url: string;
      method: string;
      headers: Record<string, string>;
      body: string;
    }> = [];
    const client = new WechatPayPartnerClient(
      config({ privateKeyPem, publicKeyPem }),
      async (url, init) => {
        seen.push({
          url,
          method: init.method,
          headers: init.headers,
          body:
            typeof init.body === "string"
              ? init.body
              : init.body.toString("utf8"),
        });
        return {
          status: 200,
          text: async () => '{"applyment_id":2000002124775691}',
        };
      },
    );
    const result = await client.submitApplyment(INTAKE);
    expect(result).toEqual({
      applymentId: 2000002124775691,
      businessCode: "1900013511_s5cwalk",
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.url).toBe(
      "https://api.mch.weixin.qq.com/v3/applyment4sub/applyment/",
    );
    expect(seen[0]!.headers["Wechatpay-Serial"]).toBe(PUBLIC_KEY_ID);
    expect(seen[0]!.headers.authorization).toContain(
      "WECHATPAY2-SHA256-RSA2048",
    );

    const sent = JSON.parse(seen[0]!.body) as Record<string, unknown>;
    const contact = sent.contact_info as Record<string, unknown>;
    // 姓名/手机号是密文，且能解回原文
    expect(contact.contact_name).not.toBe("张三");
    expect(decryptOaep(privateKeyPem, contact.contact_name as string)).toBe(
      "张三",
    );
    expect(decryptOaep(privateKeyPem, contact.mobile_phone as string)).toBe(
      "13800000000",
    );
    // 非敏感字段仍是明文（微信要按明文校验主体类型、营业执照号）
    expect(contact.contact_type).toBe("LEGAL");
    expect(sent.business_code).toBe("1900013511_s5cwalk");
  });

  it("没配公钥 → 直接抛 MISSING_PUBLIC_KEY，绝不明文上送", async () => {
    const { privateKeyPem } = keyPair();
    let called = 0;
    const client = new WechatPayPartnerClient(
      config({ privateKeyPem }),
      async () => {
        called += 1;
        return { status: 200, text: async () => "{}" };
      },
    );
    await expect(client.submitApplyment(INTAKE)).rejects.toBeInstanceOf(
      WechatPayError,
    );
    await expect(client.submitApplyment(INTAKE)).rejects.toThrow(
      /未配置微信支付公钥/,
    );
    expect(called).toBe(0);
  });

  it("应答没有 applyment_id → 报错而不是返回空值（否则调用方会存一个假申请单号）", async () => {
    const { privateKeyPem, publicKeyPem } = keyPair();
    const client = new WechatPayPartnerClient(
      config({ privateKeyPem, publicKeyPem }),
      async () => ({ status: 200, text: async () => "{}" }),
    );
    await expect(client.submitApplyment(INTAKE)).rejects.toThrow(
      /缺少 applyment_id/,
    );
  });
});

/** 按 `a.b.c` 路径取值（数组字段在夹具里只取第 0 个元素就够）。 */
function readPath(root: unknown, path: string): unknown {
  let node: unknown = root;
  for (const key of path.split(".")) {
    if (Array.isArray(node)) node = node[0];
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

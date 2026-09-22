import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  WechatPayPartnerClient,
  type WechatPayPartnerConfig,
} from "../infrastructure/wechatpay-partner.client.js";
import {
  PrepayInputError,
  TenantPaymentNotReadyError,
  WechatPayDisabledError,
  WechatPayerNotBoundError,
} from "../domain/payments.errors.js";
import type { CheckoutRepository } from "./checkout-ports.js";
import {
  WechatPayCheckoutService,
  generateOutTradeNo,
} from "./wechatpay-checkout.service.js";

const API_V3_KEY = "0123456789abcdef0123456789abcdef";

function harness(
  options: {
    account?: { subMchid: string | null; status: string } | null;
    payer?: { customerProfileId: string; spOpenid: string | null } | null;
  } = {},
) {
  const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const config: WechatPayPartnerConfig = {
    spMchid: "1900007291",
    spAppid: "wxd678efh567hg6787",
    apiV3Key: API_V3_KEY,
    privateKeyPem: keyPair.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    merchantSerialNo: "MCH-SERIAL",
    notifyUrl: "https://h5.17ai.club/api/v1/payments/wechatpay/notify",
    apiBase: "https://api.mch.weixin.qq.com",
    verifiers: [
      {
        serialNo: "PLATFORM-SERIAL",
        publicKeyPem: createPublicKey(keyPair.privateKey)
          .export({ type: "spki", format: "pem" })
          .toString(),
      },
    ],
  };
  const created: Array<Record<string, unknown>> = [];
  const attached: Array<{ orderId: string; prepayId: string }> = [];
  const requests: Array<{ url: string; body: string }> = [];
  const repository: CheckoutRepository = {
    findTenantPaymentAccount: async () =>
      options.account === undefined
        ? { subMchid: "1900007292", status: "ACTIVE" }
        : options.account,
    findCustomerPayerIdentity: async () =>
      options.payer === undefined
        ? { customerProfileId: "profile-1", spOpenid: "oSpOpenid" }
        : options.payer,
    createPrepayOrder: async (input) => {
      created.push(input);
      return { id: "order-1", outNo: input.outNo };
    },
    attachPrepayId: async (_tenantId, orderId, prepayId) => {
      attached.push({ orderId, prepayId });
    },
  };
  const client = new WechatPayPartnerClient(config, async (url, init) => {
    requests.push({ url, body: init.body });
    return {
      status: 200,
      text: async () => '{"prepay_id":"wx201410272009395522657a690389285100"}',
    };
  });
  return {
    service: new WechatPayCheckoutService(
      repository,
      client,
      () => 1_700_000_000_000,
    ),
    disabledService: new WechatPayCheckoutService(repository, null),
    created,
    attached,
    requests,
  };
}

const input = {
  tenantId: "tenant-1",
  customerAccountId: "account-1",
  amountFen: 12800n,
};

describe("S4-2c：服务商模式 JSAPI 下单", () => {
  it("未启用支付通道 → 直接拒绝", async () => {
    const h = harness();
    await expect(h.disabledService.prepay(input)).rejects.toBeInstanceOf(
      WechatPayDisabledError,
    );
    expect(h.created).toHaveLength(0);
  });

  it("门店未进件（没有 sub_mchid）→ 拒绝收款，且不创建支付单", async () => {
    const h = harness({ account: { subMchid: null, status: "APPLYING" } });
    await expect(h.service.prepay(input)).rejects.toBeInstanceOf(
      TenantPaymentNotReadyError,
    );
    expect(h.created).toHaveLength(0);
    expect(h.requests).toHaveLength(0);
  });

  it("门店未完成开户意愿确认（PENDING_CONFIRM）→ 拒绝并说明当前状态", async () => {
    const h = harness({
      account: { subMchid: "1900007292", status: "PENDING_CONFIRM" },
    });
    await expect(h.service.prepay(input)).rejects.toThrowError(
      /PENDING_CONFIRM/,
    );
    expect(h.created).toHaveLength(0);
  });

  it("客户没有 sp_openid（没走过微信授权）→ 提示先授权，且不创建支付单、不调微信", async () => {
    const h = harness({
      payer: { customerProfileId: "profile-1", spOpenid: null },
    });
    await expect(h.service.prepay(input)).rejects.toBeInstanceOf(
      WechatPayerNotBoundError,
    );
    expect(h.created).toHaveLength(0);
    expect(h.requests).toHaveLength(0);
  });

  it("金额非法（0 / 负数）→ 拒绝", async () => {
    const h = harness();
    await expect(
      h.service.prepay({ ...input, amountFen: 0n }),
    ).rejects.toBeInstanceOf(PrepayInputError);
    await expect(
      h.service.prepay({ ...input, amountFen: -1n }),
    ).rejects.toBeInstanceOf(PrepayInputError);
  });

  it("正常下单：创建 PENDING 支付单 → 用门店子商户号下单 → 回填 prepay_id → 返回调起参数", async () => {
    const h = harness();
    const result = await h.service.prepay({
      ...input,
      description: "陪玩充值",
    });

    expect(h.created).toHaveLength(1);
    expect(h.created[0]).toMatchObject({
      tenantId: "tenant-1",
      customerProfileId: "profile-1",
      amountFen: 12800n,
      spMchid: "1900007291",
      subMchid: "1900007292",
    });
    expect(String(h.created[0]!.outNo)).toMatch(/^WX[0-9A-Z]+$/);

    expect(h.requests).toHaveLength(1);
    expect(h.requests[0]!.url).toBe(
      "https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi",
    );
    expect(JSON.parse(h.requests[0]!.body)).toMatchObject({
      sp_appid: "wxd678efh567hg6787",
      sp_mchid: "1900007291",
      sub_mchid: "1900007292",
      description: "陪玩充值",
      amount: { total: 12800, currency: "CNY" },
      payer: { sp_openid: "oSpOpenid" },
    });

    expect(h.attached).toEqual([
      { orderId: "order-1", prepayId: "wx201410272009395522657a690389285100" },
    ]);
    expect(result.prepayId).toBe("wx201410272009395522657a690389285100");
    expect(result.payParams).toMatchObject({
      appId: "wxd678efh567hg6787",
      package: "prepay_id=wx201410272009395522657a690389285100",
      signType: "RSA",
    });
  });

  it("商户单号格式：字母数字、带时间戳前缀、每次不同", () => {
    const a = generateOutTradeNo(1_700_000_000_000);
    const b = generateOutTradeNo(1_700_000_000_000);
    expect(a).toMatch(/^WX[0-9A-Z]+$/);
    expect(a).not.toBe(b);
  });
});

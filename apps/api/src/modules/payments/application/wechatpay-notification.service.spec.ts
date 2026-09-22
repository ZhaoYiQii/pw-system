import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  WechatPayPartnerClient,
  buildNotificationSignString,
  encryptAesGcm,
  signRsaSha256,
  type WechatPayPartnerConfig,
} from "../infrastructure/wechatpay-partner.client.js";
import {
  WechatPayDisabledError,
  WechatPaySignatureError,
} from "../domain/payments.errors.js";
import { WechatPayNotificationService } from "./wechatpay-notification.service.js";
import type {
  InboxEventRecord,
  NewInboxEvent,
  PaymentOrderRecord,
  PaymentsRepository,
} from "./payments-ports.js";

const API_V3_KEY = "0123456789abcdef0123456789abcdef";
const SERIAL = "PLATFORM-SERIAL-1";

function keys() {
  const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    privateKeyPem: keyPair.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    publicKeyPem: createPublicKey(keyPair.privateKey)
      .export({ type: "spki", format: "pem" })
      .toString(),
  };
}

function clientWith(privateKeyPem: string, publicKeyPem: string) {
  const config: WechatPayPartnerConfig = {
    spMchid: "1900007291",
    spAppid: "wxd678efh567hg6787",
    apiV3Key: API_V3_KEY,
    privateKeyPem,
    merchantSerialNo: "MCH-SERIAL",
    notifyUrl: "https://h5.17ai.club/api/v1/payments/wechatpay/notify",
    apiBase: "https://api.mch.weixin.qq.com",
    verifiers: [{ serialNo: SERIAL, publicKeyPem }],
  };
  return new WechatPayPartnerClient(config);
}

/** 造一条"真"回调：用测试私钥签名 + 用 APIv3 密钥加密业务数据。 */
function signedCallback(input: {
  privateKeyPem: string;
  eventId: string;
  eventType?: string;
  transaction: Record<string, unknown>;
}) {
  const nonce = "0123456789ab";
  const associatedData = "transaction";
  const ciphertext = encryptAesGcm({
    apiV3Key: API_V3_KEY,
    plaintext: JSON.stringify(input.transaction),
    nonce,
    associatedData,
  });
  const rawBody = JSON.stringify({
    id: input.eventId,
    create_time: "2026-09-23T12:00:00+08:00",
    resource_type: "encrypt-resource",
    event_type: input.eventType ?? "TRANSACTION.SUCCESS",
    summary: "支付成功",
    resource: {
      original_type: "transaction",
      algorithm: "AEAD_AES_256_GCM",
      ciphertext,
      associated_data: associatedData,
      nonce,
    },
  });
  const timestamp = "1700000000";
  const headerNonce = "HEADERNONCE";
  const signature = signRsaSha256(
    input.privateKeyPem,
    buildNotificationSignString({
      timestamp,
      nonce: headerNonce,
      body: rawBody,
    }),
  );
  return {
    rawBody,
    headers: {
      "wechatpay-serial": SERIAL,
      "wechatpay-signature": signature,
      "wechatpay-timestamp": timestamp,
      "wechatpay-nonce": headerNonce,
    } as Record<string, string | undefined>,
  };
}

const ORDER: PaymentOrderRecord = {
  id: "order-1",
  tenantId: "tenant-1",
  customerProfileId: "profile-1",
  amountFen: 12800n,
  status: "PENDING",
  transactionId: null,
  providerRef: null,
};

function harness(
  options: {
    order?: PaymentOrderRecord | null;
    rows?: InboxEventRecord[];
  } = {},
) {
  const { privateKeyPem, publicKeyPem } = keys();
  const inboxWrites: NewInboxEvent[] = [];
  const processed: string[] = [];
  const settled: Array<Record<string, unknown>> = [];
  const differences: Array<Record<string, unknown>> = [];
  let duplicate = false;
  let rows: InboxEventRecord[] = options.rows ?? [];
  const repository: PaymentsRepository = {
    saveInboxEvent: async (input) => {
      if (duplicate) return null;
      inboxWrites.push(input);
      return { id: "inbox-1" };
    },
    listUnprocessedInbox: async () => rows,
    markInboxProcessed: async (id) => {
      processed.push(id);
    },
    findPaymentOrderByOutNo: async () =>
      options.order === undefined ? ORDER : options.order,
    settlePaymentOrder: async (input) => {
      settled.push(input);
      return { credited: true, balanceAfterFen: 12800n };
    },
    recordDifference: async (input) => {
      differences.push(input);
    },
  };
  const client = clientWith(privateKeyPem, publicKeyPem);
  return {
    service: new WechatPayNotificationService(repository, client),
    privateKeyPem,
    inboxWrites,
    processed,
    settled,
    differences,
    setRows: (next: InboxEventRecord[]) => {
      rows = next;
    },
    markDuplicate: () => {
      duplicate = true;
    },
  };
}

const transaction = {
  out_trade_no: "RCH123",
  transaction_id: "4200001234202609230000000001",
  trade_state: "SUCCESS",
  success_time: "2026-09-23T12:00:00+08:00",
  amount: { total: 12800, currency: "CNY" },
};

function stubRepository(
  overrides: Partial<PaymentsRepository> = {},
): PaymentsRepository {
  return {
    saveInboxEvent: async () => ({ id: "inbox-stub" }),
    listUnprocessedInbox: async () => [],
    markInboxProcessed: async () => undefined,
    findPaymentOrderByOutNo: async () => null,
    settlePaymentOrder: async () => ({ credited: false }),
    recordDifference: async () => undefined,
    ...overrides,
  };
}

describe("S4-2：微信支付回调管线", () => {
  it("未启用（无凭证）时回调直接拒绝，不写任何东西", async () => {
    const service = new WechatPayNotificationService(stubRepository(), null);
    await expect(
      service.ingest({ headers: {}, rawBody: "{}" }),
    ).rejects.toBeInstanceOf(WechatPayDisabledError);
  });

  it("验签失败：抛签名错误且**不落收件箱**（微信会重试）", async () => {
    const h = harness();
    const { rawBody, headers } = signedCallback({
      privateKeyPem: h.privateKeyPem,
      eventId: "EV-1",
      transaction,
    });
    await expect(
      h.service.ingest({
        headers: { ...headers, "wechatpay-signature": "AAAA" },
        rawBody,
      }),
    ).rejects.toBeInstanceOf(WechatPaySignatureError);
    expect(h.inboxWrites).toHaveLength(0);
  });

  it("验签通过：落收件箱（含 eventId/eventType/原始报文/已验签标记）", async () => {
    const h = harness();
    const { rawBody, headers } = signedCallback({
      privateKeyPem: h.privateKeyPem,
      eventId: "EV-2",
      transaction,
    });
    const result = await h.service.ingest({ headers, rawBody });
    expect(result).toEqual({
      accepted: true,
      duplicate: false,
      eventId: "EV-2",
    });
    expect(h.inboxWrites).toHaveLength(1);
    expect(h.inboxWrites[0]).toMatchObject({
      provider: "wechatpay_partner",
      eventId: "EV-2",
      eventType: "TRANSACTION.SUCCESS",
      rawBody,
      signatureVerified: true,
    });
    expect(h.inboxWrites[0]!.headers["wechatpay-serial"]).toBe(SERIAL);
  });

  it("同一事件重复投递：按幂等成功应答（duplicate=true），不重复落库", async () => {
    const h = harness();
    const { rawBody, headers } = signedCallback({
      privateKeyPem: h.privateKeyPem,
      eventId: "EV-3",
      transaction,
    });
    const first = await h.service.ingest({ headers, rawBody });
    expect(first.duplicate).toBe(false);
    h.markDuplicate(); // 第二次投递时仓储报唯一冲突
    const result = await h.service.ingest({ headers, rawBody });
    expect(result.duplicate).toBe(true);
    expect(h.inboxWrites).toHaveLength(1);
    expect(h.inboxWrites[0]?.eventId).toBe("EV-3");
  });

  it("处理成功事件：解密 → 校验金额 → 入账 → 标记已处理", async () => {
    const h = harness();
    const { rawBody, headers } = signedCallback({
      privateKeyPem: h.privateKeyPem,
      eventId: "EV-4",
      transaction,
    });
    await h.service.ingest({ headers, rawBody });
    h.setRows([
      {
        id: "inbox-4",
        provider: "wechatpay_partner",
        eventId: "EV-4",
        eventType: "TRANSACTION.SUCCESS",
        rawBody,
      },
    ]);
    const summary = await h.service.processPending(
      10,
      new Date("2026-09-23T04:05:06Z"),
    );
    expect(summary).toEqual({ processed: 1, skipped: 0, failed: 0 });
    expect(h.settled).toHaveLength(1);
    expect(h.settled[0]).toMatchObject({
      tenantId: "tenant-1",
      orderId: "order-1",
      transactionId: "4200001234202609230000000001",
      reason: "微信支付充值",
    });
    expect(h.processed).toEqual(["inbox-4"]);
    expect(h.differences).toHaveLength(0);
  });

  it("金额不符：**拒绝入账** + 写对账差异（AMOUNT_MISMATCH）", async () => {
    const h = harness();
    const { rawBody, headers } = signedCallback({
      privateKeyPem: h.privateKeyPem,
      eventId: "EV-5",
      transaction: { ...transaction, amount: { total: 100, currency: "CNY" } },
    });
    await h.service.ingest({ headers, rawBody });
    h.setRows([
      {
        id: "inbox-5",
        provider: "wechatpay_partner",
        eventId: "EV-5",
        eventType: "TRANSACTION.SUCCESS",
        rawBody,
      },
    ]);
    const summary = await h.service.processPending();
    expect(summary).toEqual({ processed: 0, skipped: 1, failed: 0 });
    expect(h.settled).toHaveLength(0);
    expect(h.differences[0]).toMatchObject({
      kind: "AMOUNT_MISMATCH",
      amountFen: 100n,
    });
    expect(h.processed).toEqual(["inbox-5"]);
  });

  it("已经入过账的同一笔：不重复入账（幂等）", async () => {
    const h = harness({
      order: {
        ...ORDER,
        status: "SUCCESS",
        transactionId: "4200001234202609230000000001",
      },
    });
    const { rawBody, headers } = signedCallback({
      privateKeyPem: h.privateKeyPem,
      eventId: "EV-6",
      transaction,
    });
    await h.service.ingest({ headers, rawBody });
    h.setRows([
      {
        id: "inbox-6",
        provider: "wechatpay_partner",
        eventId: "EV-6",
        eventType: "TRANSACTION.SUCCESS",
        rawBody,
      },
    ]);
    const summary = await h.service.processPending();
    expect(summary).toEqual({ processed: 0, skipped: 1, failed: 0 });
    expect(h.settled).toHaveLength(0);
  });

  it("找不到支付单：**不标记已处理**（留在收件箱等人工/对账），计入 failed", async () => {
    const h = harness({ order: null });
    const { rawBody, headers } = signedCallback({
      privateKeyPem: h.privateKeyPem,
      eventId: "EV-7",
      transaction,
    });
    await h.service.ingest({ headers, rawBody });
    h.setRows([
      {
        id: "inbox-7",
        provider: "wechatpay_partner",
        eventId: "EV-7",
        eventType: "TRANSACTION.SUCCESS",
        rawBody,
      },
    ]);
    const summary = await h.service.processPending();
    expect(summary).toEqual({ processed: 0, skipped: 0, failed: 1 });
    expect(h.processed).toHaveLength(0);
    expect(h.settled).toHaveLength(0);
  });

  it("非支付成功事件（或非 SUCCESS 状态）→ 忽略但标记已处理", async () => {
    const h = harness();
    const { rawBody, headers } = signedCallback({
      privateKeyPem: h.privateKeyPem,
      eventId: "EV-8",
      eventType: "REFUND.SUCCESS",
      transaction,
    });
    await h.service.ingest({ headers, rawBody });
    h.setRows([
      {
        id: "inbox-8",
        provider: "wechatpay_partner",
        eventId: "EV-8",
        eventType: "REFUND.SUCCESS",
        rawBody,
      },
    ]);
    const summary = await h.service.processPending();
    expect(summary).toEqual({ processed: 0, skipped: 1, failed: 0 });
    expect(h.settled).toHaveLength(0);
    expect(h.processed).toEqual(["inbox-8"]);
  });

  it("一行失败不影响其它行（逐行隔离）", async () => {
    const { privateKeyPem, publicKeyPem } = keys();
    const processed: string[] = [];
    const good = signedCallback({
      privateKeyPem,
      eventId: "EV-9",
      transaction,
    });
    const bad = signedCallback({
      privateKeyPem,
      eventId: "EV-10",
      transaction: { ...transaction, out_trade_no: "UNKNOWN" },
    });
    // 第一行能查到订单、第二行查不到 → 只应有一行成功、一行失败
    let calls = 0;
    const repository = stubRepository({
      listUnprocessedInbox: async () => [
        {
          id: "i9",
          provider: "wechatpay_partner",
          eventId: "EV-9",
          eventType: "TRANSACTION.SUCCESS",
          rawBody: good.rawBody,
        },
        {
          id: "i10",
          provider: "wechatpay_partner",
          eventId: "EV-10",
          eventType: "TRANSACTION.SUCCESS",
          rawBody: bad.rawBody,
        },
      ],
      markInboxProcessed: async (id: string) => {
        processed.push(id);
      },
      findPaymentOrderByOutNo: async () => {
        calls += 1;
        return calls === 1 ? ORDER : null;
      },
      settlePaymentOrder: async () => ({ credited: true }),
    });
    const service = new WechatPayNotificationService(
      repository,
      clientWith(privateKeyPem, publicKeyPem),
    );
    const summary = await service.processPending();
    expect(summary).toEqual({ processed: 1, skipped: 0, failed: 1 });
    expect(processed).toEqual(["i9"]);
  });
});

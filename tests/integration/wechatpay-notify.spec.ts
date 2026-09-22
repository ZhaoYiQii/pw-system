import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";
import { WechatPayNotificationService } from "../../apps/api/src/modules/payments/application/wechatpay-notification.service.js";
import { WechatPayCheckoutService } from "../../apps/api/src/modules/payments/application/wechatpay-checkout.service.js";
import { PrismaPaymentsRepository } from "../../apps/api/src/modules/payments/infrastructure/prisma-payments.repository.js";
import {
  WechatPayPartnerClient,
  buildNotificationSignString,
  encryptAesGcm,
  signRsaSha256,
  type WechatPayPartnerConfig,
} from "../../apps/api/src/modules/payments/infrastructure/wechatpay-partner.client.js";

/**
 * S4-2b：微信支付回调 → 自动入账的**真库**验证。
 *
 * 为什么不满足于单测：入账要跨 4 张表（boss_wallets / wallet_entries / payment_orders / audit_logs）
 * 并在 RLS 上下文里跑行锁；字段名、RLS 授权、唯一约束、金额单位这些只有真库能验
 * （上一次就是靠真库测试抓到"仓储漏映射字段导致规则失效"）。
 */

const suffix = Date.now().toString(36);
const API_V3_KEY = "0123456789abcdef0123456789abcdef";
const SERIAL = "SERIAL-IT-1";
const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = keyPair.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const publicKeyPem = createPublicKey(keyPair.privateKey)
  .export({ type: "spki", format: "pem" })
  .toString();

function envOrThrow(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing env ${name}`);
  return value;
}

function signedCallback(input: {
  eventId: string;
  outTradeNo: string;
  transactionId?: string;
  totalFen?: number;
}) {
  const nonce = "0123456789ab";
  const associatedData = "transaction";
  const ciphertext = encryptAesGcm({
    apiV3Key: API_V3_KEY,
    plaintext: JSON.stringify({
      out_trade_no: input.outTradeNo,
      transaction_id: input.transactionId ?? "4200001234202609230000000001",
      trade_state: "SUCCESS",
      success_time: "2026-09-23T12:00:00+08:00",
      amount: { total: input.totalFen ?? 12800, currency: "CNY" },
    }),
    nonce,
    associatedData,
  });
  const rawBody = JSON.stringify({
    id: input.eventId,
    create_time: "2026-09-23T12:00:00+08:00",
    resource_type: "encrypt-resource",
    event_type: "TRANSACTION.SUCCESS",
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
  return {
    rawBody,
    headers: {
      "wechatpay-serial": SERIAL,
      "wechatpay-signature": signRsaSha256(
        privateKeyPem,
        buildNotificationSignString({
          timestamp,
          nonce: headerNonce,
          body: rawBody,
        }),
      ),
      "wechatpay-timestamp": timestamp,
      "wechatpay-nonce": headerNonce,
    } as Record<string, string | undefined>,
  };
}

describe("wechatpay 回调 → 自动入账（真库）", () => {
  let owner: PrismaClient;
  let runtime: PrismaClient;
  let service: WechatPayNotificationService;
  let tenantId: string;
  let profileId: string;
  let accountId: string;
  let orderId: string;
  let outNo: string;
  let checkout: WechatPayCheckoutService;
  const eventIds = [
    `EV-IT-1-${suffix}`,
    `EV-IT-2-${suffix}`,
    `EV-IT-3-${suffix}`,
  ];

  beforeAll(async () => {
    owner = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    runtime = createDatabaseClient(envOrThrow("PW_TEST_RUNTIME_URL"));

    const tenant = await owner.tenant.create({
      data: { code: `wxpay_${suffix}`, name: "微信支付集成测试店" },
    });
    tenantId = tenant.id;

    const account = await owner.tenantAccount.create({
      data: {
        tenantId,
        username: `wx_probe_${suffix}`,
        passwordHash: "scrypt:test:test",
        wechatOpenid: `oProbe${suffix}`,
      },
    });
    accountId = account.id;
    const profile = await owner.customerProfile.create({
      data: { tenantId, tenantAccountId: account.id, name: "测试客户" },
    });
    profileId = profile.id;

    outNo = `RCH-WXPAY-${suffix}`;
    const order = await owner.paymentOrder.create({
      data: {
        tenantId,
        customerProfileId: profileId,
        outNo,
        amountFen: 12800n,
        provider: "wechatpay_partner",
        status: "PENDING",
        spMchid: "1900007291",
        subMchid: "1900007292",
      },
    });
    orderId = order.id;

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
    service = new WechatPayNotificationService(
      new PrismaPaymentsRepository(owner, runtime),
      new WechatPayPartnerClient(config),
    );
    // S4-2c：同一套仓储也给下单用（真库验证新方法：门店子商户 / 客户 sp_openid / 预支付单）
    checkout = new WechatPayCheckoutService(
      new PrismaPaymentsRepository(owner, runtime),
      new WechatPayPartnerClient(config, async () => ({
        status: 200,
        text: async () => '{"prepay_id":"wx-pay-params-probe"}',
      })),
      () => 1_700_000_000_000,
    );
  });

  afterAll(async () => {
    if (!tenantId) return;
    await owner.webhookInbox.deleteMany({
      where: { eventId: { in: eventIds } },
    });
    await owner.reconciliationDifference.deleteMany({ where: { tenantId } });
    await owner.walletEntry.deleteMany({ where: { tenantId } });
    await owner.bossWallet.deleteMany({ where: { tenantId } });
    await owner.tenantPaymentAccount.deleteMany({ where: { tenantId } });
    await owner.paymentOrder.deleteMany({ where: { tenantId } });
    await owner.auditLog.deleteMany({ where: { tenantId } });
    await owner.customerProfile.deleteMany({ where: { tenantId } });
    await owner.tenantAccountRole.deleteMany({ where: { tenantId } });
    await owner.tenantAccount.deleteMany({ where: { tenantId } });
    await owner.tenant.delete({ where: { id: tenantId } });
    await owner.$disconnect();
    await runtime.$disconnect();
  });

  it("回调落库；同一事件重复投递只留一行（幂等）", async () => {
    const callback = signedCallback({
      eventId: eventIds[0]!,
      outTradeNo: outNo,
    });
    const first = await service.ingest(callback);
    expect(first).toEqual({
      accepted: true,
      duplicate: false,
      eventId: eventIds[0],
    });
    const again = await service.ingest(callback);
    expect(again.duplicate).toBe(true);
    const rows = await owner.webhookInbox.findMany({
      where: { eventId: eventIds[0]! },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.signatureVerified).toBe(true);
  });

  it("worker 处理 → 钱包入账 + 支付单转 SUCCESS + 流水 + 审计；重复处理不重复入账", async () => {
    const summary = await service.processPending(10);
    expect(summary.processed).toBeGreaterThanOrEqual(1);

    const order = await owner.paymentOrder.findUnique({
      where: { id: orderId },
    });
    expect(order?.status).toBe("SUCCESS");
    expect(order?.transactionId).toBe("4200001234202609230000000001");

    const wallet = await owner.bossWallet.findFirst({
      where: { tenantId, customerProfileId: profileId },
    });
    expect(wallet).not.toBeNull();
    expect(wallet!.balanceFen).toBe(12800n);

    const entries = await owner.walletEntry.findMany({ where: { tenantId } });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.type).toBe("RECHARGE");
    expect(entries[0]!.amountFen).toBe(12800n);
    expect(entries[0]!.balanceAfterFen).toBe(12800n);

    const audits = await owner.auditLog.count({
      where: { tenantId, action: "payment.wechatpay.paid" },
    });
    expect(audits).toBe(1);

    // 再跑一轮（模拟微信重试或 worker 重启）：不得重复入账
    await service.processPending(10);
    const walletAgain = await owner.bossWallet.findFirst({
      where: { tenantId, customerProfileId: profileId },
    });
    expect(walletAgain!.balanceFen).toBe(12800n);
    expect(await owner.walletEntry.count({ where: { tenantId } })).toBe(1);
  });

  it("金额不符：写对账差异、不入账、支付单保持 PENDING", async () => {
    const mismatchOutNo = `RCH-WXPAY-MISMATCH-${suffix}`;
    const mismatchOrder = await owner.paymentOrder.create({
      data: {
        tenantId,
        customerProfileId: profileId,
        outNo: mismatchOutNo,
        amountFen: 5000n,
        provider: "wechatpay_partner",
        status: "PENDING",
        spMchid: "1900007291",
        subMchid: "1900007292",
      },
    });
    const callback = signedCallback({
      eventId: eventIds[2]!,
      outTradeNo: mismatchOutNo,
      totalFen: 1, // 与订单 5000 分不一致
    });
    await service.ingest(callback);
    const summary = await service.processPending(10);
    expect(summary.skipped).toBeGreaterThanOrEqual(1);
    expect(summary.processed).toBe(0);

    const difference = await owner.reconciliationDifference.findFirst({
      where: { tenantId, kind: "AMOUNT_MISMATCH" },
    });
    expect(difference).not.toBeNull();
    expect(difference!.paymentOrderId).toBe(mismatchOrder.id);

    const stillPending = await owner.paymentOrder.findUnique({
      where: { id: mismatchOrder.id },
    });
    expect(stillPending?.status).toBe("PENDING");
    await owner.paymentOrder.delete({ where: { id: mismatchOrder.id } });
  });

  it("下单：门店 ACTIVE 子商户 + 客户 sp_openid → 落 PENDING 支付单并回填 prepay_id（真库）", async () => {
    await owner.tenantPaymentAccount.create({
      data: {
        tenantId,
        subMchid: "1900007292",
        applyNo: `APPLY-${suffix}`,
        status: "ACTIVE",
      },
    });
    const result = await checkout.prepay({
      tenantId,
      customerAccountId: accountId,
      amountFen: 6600n,
      description: "真库下单验证",
    });
    expect(result.payParams.package).toBe("prepay_id=wx-pay-params-probe");

    const row = await owner.paymentOrder.findFirst({
      where: { tenantId, outNo: result.outTradeNo },
    });
    expect(row).not.toBeNull();
    expect(row!.status).toBe("PENDING");
    expect(row!.amountFen).toBe(6600n);
    expect(row!.provider).toBe("wechatpay_partner");
    expect(row!.spMchid).toBe("1900007291");
    expect(row!.subMchid).toBe("1900007292");
    expect(row!.prepayId).toBe("wx-pay-params-probe");
    expect(row!.customerProfileId).toBe(profileId);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";
import { ManualRefundService } from "../../apps/api/src/modules/payments/application/manual-refund.service.js";
import { PrismaRefundRepository } from "../../apps/api/src/modules/payments/infrastructure/prisma-refund.repository.js";
import { RefundStatusTransitionError } from "../../apps/api/src/modules/payments/domain/refund-confirmation-state.js";

const suffix = Date.now().toString(36);
const PAY_AMOUNT = 12_800n;

function envOrThrow(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing env ${name}`);
  return value;
}

describe("人工退款登记与确认（真库）", () => {
  let owner: PrismaClient;
  let runtime: PrismaClient;
  let refunds: ManualRefundService;
  let tenantId: string;
  let profileId: string;
  let orderId: string;
  let fundAccountId: string;
  let operatorAccountId: string;
  let pendingRefundId: string;

  const walletBalance = async () => {
    const wallet = await owner.bossWallet.findFirst({
      where: { tenantId, customerProfileId: profileId },
    });
    return wallet?.balanceFen ?? -1n;
  };

  beforeAll(async () => {
    owner = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    runtime = createDatabaseClient(envOrThrow("PW_TEST_RUNTIME_URL"));
    const tenant = await owner.tenant.create({
      data: { code: `wxrefund2_${suffix}`, name: "退款确认集成测试店" },
    });
    tenantId = tenant.id;
    const account = await owner.tenantAccount.create({
      data: {
        tenantId,
        username: `wxrefund2_${suffix}`,
        passwordHash: "scrypt:test:test",
      },
    });
    operatorAccountId = account.id;
    const profile = await owner.customerProfile.create({
      data: { tenantId, tenantAccountId: account.id, name: "退款确认客户" },
    });
    profileId = profile.id;
    const fund = await owner.fundAccount.create({
      data: {
        tenantId,
        code: "WECHAT_TEST",
        name: "微信测试结算账户",
        kind: "WECHAT_SETTLEMENT",
        status: "ACTIVE",
      },
    });
    fundAccountId = fund.id;
    const order = await owner.paymentOrder.create({
      data: {
        tenantId,
        customerProfileId: profileId,
        outNo: `RCH-REFUND2-${suffix}`,
        amountFen: PAY_AMOUNT,
        provider: "wechatpay_partner",
        status: "SUCCESS",
        transactionId: `420000${suffix}`,
        spMchid: "1900007291",
        subMchid: "1900007292",
        paidAt: new Date("2026-09-23T02:00:00.000Z"),
      },
    });
    orderId = order.id;
    const [asset, liability] = await Promise.all([
      owner.ledgerAccount.create({
        data: {
          tenantId,
          code: "WECHAT_SETTLEMENT_ASSET",
          name: "微信渠道待结算资产",
        },
      }),
      owner.ledgerAccount.create({
        data: {
          tenantId,
          code: "CUSTOMER_PREPAID_LIABILITY",
          name: "客户预收款",
        },
      }),
    ]);
    const paymentPosting = await owner.ledgerTransaction.create({
      data: {
        tenantId,
        txNo: `PAYREF${suffix}`,
        description: "集成测试支付入账",
        sourceType: "payment_order",
        sourceId: orderId,
        eventType: "PAYMENT_CONFIRMED",
        status: "CONFIRMED",
        fundAccountId,
        occurredAt: order.paidAt!,
        confirmedAt: order.paidAt!,
      },
    });
    await owner.ledgerEntry.createMany({
      data: [
        {
          tenantId,
          transactionId: paymentPosting.id,
          accountId: asset.id,
          direction: "DEBIT",
          amountFen: PAY_AMOUNT,
          fundAccountId,
          auxiliaryType: "customer_profile",
          auxiliaryId: profileId,
        },
        {
          tenantId,
          transactionId: paymentPosting.id,
          accountId: liability.id,
          direction: "CREDIT",
          amountFen: PAY_AMOUNT,
          auxiliaryType: "customer_profile",
          auxiliaryId: profileId,
        },
      ],
    });
    await owner.bossWallet.create({
      data: {
        tenantId,
        customerProfileId: profileId,
        bossNo: `B${suffix.toUpperCase()}`,
        balanceFen: PAY_AMOUNT,
      },
    });
    refunds = new ManualRefundService(new PrismaRefundRepository(runtime));
  });

  afterAll(async () => {
    if (!tenantId) return;
    await owner.ledgerEntry.deleteMany({ where: { tenantId } });
    await owner.ledgerTransaction.deleteMany({ where: { tenantId } });
    await owner.ledgerAccount.deleteMany({ where: { tenantId } });
    await owner.fundAccount.deleteMany({ where: { tenantId } });
    await owner.paymentRefund.deleteMany({ where: { tenantId } });
    await owner.walletEntry.deleteMany({ where: { tenantId } });
    await owner.bossWallet.deleteMany({ where: { tenantId } });
    await owner.paymentOrder.deleteMany({ where: { tenantId } });
    await owner.auditLog.deleteMany({ where: { tenantId } });
    await owner.customerProfile.deleteMany({ where: { tenantId } });
    await owner.tenantAccountRole.deleteMany({ where: { tenantId } });
    await owner.tenantAccount.deleteMany({ where: { tenantId } });
    await owner.tenant.delete({ where: { id: tenantId } });
    await owner.$disconnect();
    await runtime.$disconnect();
  });

  it("登记申请只占退款额度：不扣钱包、不写流水或总账", async () => {
    const result = await refunds.register({
      tenantId,
      operatorAccountId,
      orderId,
      amountFen: 5000n,
      reason: "客户取消部分服务",
      idempotencyKey: `request-${suffix}`,
    });
    pendingRefundId = result.refund.refundId;
    expect(result).toMatchObject({
      duplicate: false,
      refund: {
        status: "PENDING_CONFIRMATION",
        amountFen: 5000n,
        refundedFen: 0n,
        walletBalanceFen: PAY_AMOUNT,
      },
    });
    expect(await walletBalance()).toBe(PAY_AMOUNT);
    expect(await owner.walletEntry.count({ where: { tenantId } })).toBe(0);
    expect(await owner.ledgerTransaction.count({ where: { tenantId } })).toBe(
      1,
    );
    const row = await owner.paymentRefund.findUnique({
      where: { id: pendingRefundId },
    });
    expect(row).toMatchObject({
      status: "PENDING_CONFIRMATION",
      refundId: null,
      succeededAt: null,
    });
    expect(
      await owner.auditLog.count({
        where: { tenantId, action: "payment.refund.manual.requested" },
      }),
    ).toBe(1);
  });

  it("确认才原子扣钱包、写退款流水并冲销原支付资金账户", async () => {
    const result = await refunds.confirm({
      tenantId,
      operatorAccountId,
      refundId: pendingRefundId,
      evidenceRef: "WX-REFUND_20260924",
    });
    expect(result).toMatchObject({
      duplicate: false,
      refund: {
        status: "SUCCEEDED",
        amountFen: 5000n,
        refundedFen: 5000n,
        walletBalanceFen: 7800n,
      },
    });
    expect(await walletBalance()).toBe(7800n);
    const entry = await owner.walletEntry.findFirst({
      where: { tenantId, referenceId: pendingRefundId },
    });
    expect(entry).toMatchObject({
      type: "REFUND",
      amountFen: 5000n,
      balanceAfterFen: 7800n,
    });
    const refund = await owner.paymentRefund.findUnique({
      where: { id: pendingRefundId },
    });
    expect(refund).toMatchObject({
      status: "SUCCEEDED",
      refundId: "WX-REFUND_20260924",
    });
    expect(refund!.succeededAt).not.toBeNull();
    const posting = await owner.ledgerTransaction.findFirst({
      where: {
        tenantId,
        sourceType: "payment_refund",
        sourceId: pendingRefundId,
        eventType: "REFUND_CONFIRMED",
      },
    });
    expect(posting).toMatchObject({ status: "CONFIRMED", fundAccountId });
    const entries = await owner.ledgerEntry.findMany({
      where: { tenantId, transactionId: posting!.id },
    });
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          direction: "DEBIT",
          amountFen: 5000n,
          fundAccountId: null,
          auxiliaryId: profileId,
        }),
        expect.objectContaining({
          direction: "CREDIT",
          amountFen: 5000n,
          fundAccountId,
          auxiliaryId: profileId,
        }),
      ]),
    );
    expect(
      await owner.auditLog.count({
        where: { tenantId, action: "payment.refund.manual.confirmed" },
      }),
    ).toBe(1);
  });

  it("重复确认冲突，不会二次扣款或新增退款总账", async () => {
    await expect(
      refunds.confirm({
        tenantId,
        operatorAccountId,
        refundId: pendingRefundId,
        evidenceRef: "WX-REFUND_20260924",
      }),
    ).rejects.toBeInstanceOf(RefundStatusTransitionError);
    expect(await walletBalance()).toBe(7800n);
    expect(await owner.walletEntry.count({ where: { tenantId } })).toBe(1);
    expect(
      await owner.ledgerTransaction.count({
        where: {
          tenantId,
          sourceType: "payment_refund",
          sourceId: pendingRefundId,
        },
      }),
    ).toBe(1);
  });
});

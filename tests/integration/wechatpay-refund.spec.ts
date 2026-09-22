import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";
import { ManualRefundService } from "../../apps/api/src/modules/payments/application/manual-refund.service.js";
import { PrismaRefundRepository } from "../../apps/api/src/modules/payments/infrastructure/prisma-refund.repository.js";
import {
  RefundInsufficientBalanceError,
  RefundNotAllowedError,
} from "../../apps/api/src/modules/payments/domain/payments.errors.js";

/**
 * S4-4：人工退款登记的**真库**验证。
 *
 * 为什么必须真库：这一片要跨 4 张表写（payment_refunds / boss_wallets / wallet_entries / audit_logs）、
 * 在 RLS 上下文里跑行锁、还要靠唯一约束挡重复提交——字段名、`updated_at` 无默认值、
 * RLS 授权、金额符号这些只有真库能验。
 */

const suffix = Date.now().toString(36);
const PAY_AMOUNT = 12800n;

function envOrThrow(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing env ${name}`);
  return value;
}

describe("wechatpay 人工退款登记（真库）", () => {
  let owner: PrismaClient;
  let runtime: PrismaClient;
  let refunds: ManualRefundService;
  let tenantId: string;
  let profileId: string;
  let orderId: string;
  let outNo: string;
  let operatorAccountId: string;

  async function walletBalance(): Promise<bigint> {
    const wallet = await owner.bossWallet.findFirst({
      where: { tenantId, customerProfileId: profileId },
    });
    return wallet?.balanceFen ?? -1n;
  }

  async function refundRows() {
    return owner.paymentRefund.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
    });
  }

  beforeAll(async () => {
    owner = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    runtime = createDatabaseClient(envOrThrow("PW_TEST_RUNTIME_URL"));

    const tenant = await owner.tenant.create({
      data: { code: `wxrefund_${suffix}`, name: "人工退款集成测试店" },
    });
    tenantId = tenant.id;
    const account = await owner.tenantAccount.create({
      data: {
        tenantId,
        username: `wxrefund_${suffix}`,
        passwordHash: "scrypt:test:test",
      },
    });
    operatorAccountId = account.id;
    const profile = await owner.customerProfile.create({
      data: { tenantId, tenantAccountId: account.id, name: "退款客户" },
    });
    profileId = profile.id;

    // 支付已成功并已入账 → 钱包余额 128 元（与回调链路一致的初始状态）
    outNo = `RCH-REFUND-${suffix}`;
    const order = await owner.paymentOrder.create({
      data: {
        tenantId,
        customerProfileId: profileId,
        outNo,
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

  it("支付单不存在 → 拒绝且不写库", async () => {
    await expect(
      refunds.register({
        tenantId,
        operatorAccountId,
        outNo: `NOT-EXIST-${suffix}`,
        amountFen: 100n,
        reason: "测试",
      }),
    ).rejects.toThrow(/支付单不存在/);
    expect(await owner.paymentRefund.count({ where: { tenantId } })).toBe(0);
    expect(await walletBalance()).toBe(PAY_AMOUNT);
  });

  it("部分退款：扣钱包 + REFUND 流水 + 审计，支付单保持 SUCCESS", async () => {
    const result = await refunds.register({
      tenantId,
      operatorAccountId,
      outNo,
      amountFen: 5000n,
      reason: "客户取消部分服务",
    });
    expect(result.duplicate).toBe(false);
    expect(result.refund.amountFen).toBe(5000n);
    expect(result.refund.refundedFen).toBe(5000n);
    expect(result.refund.walletBalanceFen).toBe(7800n);
    expect(result.refund.fullyRefunded).toBe(false);

    const order = await owner.paymentOrder.findUnique({
      where: { id: orderId },
    });
    expect(order?.status).toBe("SUCCESS");
    expect(await walletBalance()).toBe(7800n);

    const rows = await refundRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("SUCCEEDED");
    expect(rows[0]!.amountFen).toBe(5000n);
    expect(rows[0]!.reason).toBe("客户取消部分服务");
    expect(rows[0]!.paymentOrderId).toBe(orderId);
    expect(rows[0]!.succeededAt).not.toBeNull();
    expect(rows[0]!.outRefundNo).toBe(result.refund.outRefundNo);

    const entries = await owner.walletEntry.findMany({ where: { tenantId } });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.type).toBe("REFUND");
    // 金额恒为正、方向由 type 决定（表上有 CHECK amount_fen > 0）
    expect(entries[0]!.amountFen).toBe(5000n);
    expect(entries[0]!.balanceAfterFen).toBe(7800n);
    expect(entries[0]!.referenceId).toBe(result.refund.refundId);

    expect(
      await owner.auditLog.count({
        where: { tenantId, action: "payment.refund.manual" },
      }),
    ).toBe(1);
  });

  it("幂等键重复提交：只扣一次钱（按 orderId 查单也走通）", async () => {
    const first = await refunds.register({
      tenantId,
      operatorAccountId,
      orderId,
      amountFen: 1000n,
      reason: "补偿差额",
      idempotencyKey: `key-${suffix}`,
    });
    expect(first.duplicate).toBe(false);
    expect(first.refund.refundedFen).toBe(6000n);
    expect(await walletBalance()).toBe(6800n);

    const again = await refunds.register({
      tenantId,
      operatorAccountId,
      orderId,
      amountFen: 1000n,
      reason: "补偿差额",
      idempotencyKey: `key-${suffix}`,
    });
    expect(again.duplicate).toBe(true);
    expect(again.refund.refundId).toBe(first.refund.refundId);
    expect(await walletBalance()).toBe(6800n);
    expect(await refundRows()).toHaveLength(2);
    expect(await owner.walletEntry.count({ where: { tenantId } })).toBe(2);
  });

  it("超过可退余额（可退 6800 分）→ 拒绝，退款单与钱包都不变", async () => {
    await expect(
      refunds.register({
        tenantId,
        operatorAccountId,
        outNo,
        amountFen: 6801n,
        reason: "手抖多填",
      }),
    ).rejects.toBeInstanceOf(RefundNotAllowedError);
    expect(await refundRows()).toHaveLength(2);
    expect(await walletBalance()).toBe(6800n);
  });

  it("钱包余额不足 → 整笔回滚（退款单不落库、余额不变）", async () => {
    const wallet = await owner.bossWallet.findFirst({
      where: { tenantId, customerProfileId: profileId },
    });
    await owner.bossWallet.update({
      where: { id: wallet!.id },
      data: { balanceFen: 100n },
    });
    await expect(
      refunds.register({
        tenantId,
        operatorAccountId,
        outNo,
        amountFen: 500n,
        reason: "余额不足场景",
      }),
    ).rejects.toBeInstanceOf(RefundInsufficientBalanceError);
    expect(await refundRows()).toHaveLength(2);
    expect(await walletBalance()).toBe(100n);
    // 还原，供下一条用例继续验「全额退款」
    await owner.bossWallet.update({
      where: { id: wallet!.id },
      data: { balanceFen: 6800n },
    });
  });

  it("全额退款：钱包扣到 0 且 fullyRefunded=true（支付单状态不变）；再退被拒", async () => {
    const result = await refunds.register({
      tenantId,
      operatorAccountId,
      outNo,
      amountFen: 6800n,
      reason: "客户整单取消",
    });
    expect(result.refund.fullyRefunded).toBe(true);
    expect(result.refund.refundedFen).toBe(PAY_AMOUNT);
    expect(result.refund.walletBalanceFen).toBe(0n);
    expect(await walletBalance()).toBe(0n);
    // 支付单状态**不因退款改变**：表上只有 PENDING/SUCCESS/FAILED，退款事实落 payment_refunds
    const order = await owner.paymentOrder.findUnique({
      where: { id: orderId },
    });
    expect(order?.status).toBe("SUCCESS");

    await expect(
      refunds.register({
        tenantId,
        operatorAccountId,
        outNo,
        amountFen: 100n,
        reason: "已全额退过还想退",
      }),
    ).rejects.toThrow(/退款金额超过可退余额（可退 0 分，本次 100 分）/);
    expect(await refundRows()).toHaveLength(3);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";
import { ManualRefundService } from "../../apps/api/src/modules/payments/application/manual-refund.service.js";
import { PrismaRefundRepository } from "../../apps/api/src/modules/payments/infrastructure/prisma-refund.repository.js";
import { RefundStatusTransitionError } from "../../apps/api/src/modules/payments/domain/refund-confirmation-state.js";
import {
  RefundInsufficientBalanceError,
  RefundNotAllowedError,
} from "../../apps/api/src/modules/payments/domain/payments.errors.js";
import {
  CUSTOMER_PREPAID_LIABILITY_ACCOUNT,
  WECHAT_SETTLEMENT_ASSET_ACCOUNT,
  buildPaymentConfirmedLedgerPosting,
} from "../../apps/api/src/modules/payments/domain/payment-confirmed-ledger-posting.js";
import {
  REFUND_CONFIRMED_EVENT_TYPE,
  REFUND_CONFIRMED_SOURCE_TYPE,
  REFUND_CONFIRMED_STATUS,
} from "../../apps/api/src/modules/payments/domain/refund-confirmed-ledger-posting.js";
import { buildLedgerTransactionNo } from "../../apps/api/src/modules/ledger/domain/ledger-transaction-no.js";

/**
 * DS-005：人工退款**两步事实流**的真库验证。
 *
 * 为什么必须真库：这一片要跨 6 张表写（payment_refunds / boss_wallets / wallet_entries /
 * audit_logs 以及 DS-003 的 ledger_transactions / ledger_entries）、在 RLS 上下文里跑行锁、
 * 还要靠唯一约束挡重复提交——字段名、`updated_at` 无默认值、RLS 授权、金额符号这些只有真库能验。
 *
 * 两步的资金语义**不同**，断言必须分开：
 * 1. `register()` 只登记申请（`PENDING_CONFIRMATION` + 审计），**不扣钱包、不写流水、不写总账**；
 * 2. `confirm()` 在**同一事务**内转 `SUCCEEDED` + 扣钱包 + 写流水 + 退款冲销总账 + 审计。
 * 任何一步失败都必须整笔回滚（状态、钱包、流水、总账、审计一个都不留）。
 *
 * 确认路径还要求能定位**原支付**的 PAYMENT_CONFIRMED 总账交易及其资金账户，
 * 所以 beforeAll 必须先用领域构建函数把这条支付事实建出来（复用常量，不自己编科目与方向）。
 *
 * 用例串行共享同一租户（原支付 12800 分），累计状态按文件顺序推进：
 * 5000 已确认 → 1000 已确认 → 待确认 500 因余额不足回滚并删除 → 6800 全额确认。
 */

const suffix = Date.now().toString(36);
const PAY_AMOUNT = 12800n;
const REQUESTED_ACTION = "payment.refund.manual.requested";
const CONFIRMED_ACTION = "payment.refund.manual.confirmed";
const PAID_AT = new Date("2026-09-23T02:00:00.000Z");

function envOrThrow(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing env ${name}`);
  return value;
}

describe("wechatpay 人工退款两步流（真库）", () => {
  let owner: PrismaClient;
  let runtime: PrismaClient;
  let refunds: ManualRefundService;
  let tenantId: string;
  let profileId: string;
  let orderId: string;
  let outNo: string;
  let operatorAccountId: string;
  let fundAccountId: string;

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

  async function walletEntries() {
    return owner.walletEntry.findMany({ where: { tenantId } });
  }

  async function auditCount(action: string): Promise<number> {
    return owner.auditLog.count({ where: { tenantId, action } });
  }

  /** 该租户已写入的退款冲销总账交易条数（未确认的退款单不得贡献）。 */
  async function refundLedgerCount(): Promise<number> {
    return owner.ledgerTransaction.count({
      where: { tenantId, eventType: REFUND_CONFIRMED_EVENT_TYPE },
    });
  }

  /** 某张退款单的 REFUND_CONFIRMED 冲销交易与它的两条分录（未确认时为 null / 空）。 */
  async function refundLedger(refundId: string) {
    const transaction = await owner.ledgerTransaction.findFirst({
      where: {
        tenantId,
        sourceType: REFUND_CONFIRMED_SOURCE_TYPE,
        sourceId: refundId,
        eventType: REFUND_CONFIRMED_EVENT_TYPE,
      },
    });
    const entries = transaction
      ? await owner.ledgerEntry.findMany({
          where: { tenantId, transactionId: transaction.id },
        })
      : [];
    return { transaction, entries };
  }

  async function ledgerAccountCodes(): Promise<Map<string, string>> {
    const rows = await owner.ledgerAccount.findMany({
      where: { tenantId },
      select: { id: true, code: true },
    });
    return new Map(rows.map((row) => [row.id, row.code]));
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
        paidAt: PAID_AT,
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

    // ===== DS-003：原支付成功入账的资金事实 =====
    // 退款确认要靠它定位"钱从哪个资金账户流出"：取不到就整笔回滚
    // （OriginalPaymentPostingMissingError），所以先把这笔事实按生产同款口径建出来。
    // 科目与方向一律来自领域构建函数，测试不自己编一套。
    const fundAccount = await owner.fundAccount.create({
      data: {
        tenantId,
        code: `WX_SETTLE_${suffix}`,
        name: "微信结算资金账户",
        kind: "WECHAT_SETTLEMENT",
        status: "ACTIVE",
      },
    });
    fundAccountId = fundAccount.id;
    const assetAccount = await owner.ledgerAccount.create({
      data: {
        tenantId,
        code: WECHAT_SETTLEMENT_ASSET_ACCOUNT.code,
        name: WECHAT_SETTLEMENT_ASSET_ACCOUNT.name,
      },
    });
    const liabilityAccount = await owner.ledgerAccount.create({
      data: {
        tenantId,
        code: CUSTOMER_PREPAID_LIABILITY_ACCOUNT.code,
        name: CUSTOMER_PREPAID_LIABILITY_ACCOUNT.name,
      },
    });
    const paymentPosting = buildPaymentConfirmedLedgerPosting({
      amountFen: PAY_AMOUNT,
      fundAccountId,
      paymentOrderId: orderId,
      paymentOrderOutNo: outNo,
      customerProfileId: profileId,
      paidAt: PAID_AT,
    });
    const paymentTransaction = await owner.ledgerTransaction.create({
      data: {
        tenantId,
        txNo: buildLedgerTransactionNo(),
        description: paymentPosting.transaction.description,
        sourceType: paymentPosting.transaction.sourceType,
        sourceId: paymentPosting.transaction.sourceId,
        eventType: paymentPosting.transaction.eventType,
        status: paymentPosting.transaction.status,
        fundAccountId: paymentPosting.transaction.fundAccountId,
        occurredAt: paymentPosting.transaction.occurredAt,
        confirmedAt: paymentPosting.transaction.confirmedAt,
      },
    });
    const accountIdByCode = new Map<string, string>([
      [WECHAT_SETTLEMENT_ASSET_ACCOUNT.code, assetAccount.id],
      [CUSTOMER_PREPAID_LIABILITY_ACCOUNT.code, liabilityAccount.id],
    ]);
    for (const entry of paymentPosting.entries) {
      const accountId = accountIdByCode.get(entry.accountCode);
      if (!accountId) {
        throw new Error(`测试总账科目未就绪：${entry.accountCode}`);
      }
      await owner.ledgerEntry.create({
        data: {
          tenantId,
          transactionId: paymentTransaction.id,
          accountId,
          direction: entry.direction,
          amountFen: entry.amountFen,
          fundAccountId: entry.fundAccountId,
          auxiliaryType: entry.auxiliaryType,
          auxiliaryId: entry.auxiliaryId,
        },
      });
    }

    refunds = new ManualRefundService(new PrismaRefundRepository(runtime));
  });

  afterAll(async () => {
    if (!tenantId) return;
    // 按外键顺序清理：先分录，再交易、科目、资金账户
    await owner.ledgerEntry.deleteMany({ where: { tenantId } });
    await owner.ledgerTransaction.deleteMany({ where: { tenantId } });
    await owner.ledgerAccount.deleteMany({ where: { tenantId } });
    await owner.paymentRefund.deleteMany({ where: { tenantId } });
    await owner.walletEntry.deleteMany({ where: { tenantId } });
    await owner.bossWallet.deleteMany({ where: { tenantId } });
    await owner.fundAccount.deleteMany({ where: { tenantId } });
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
    expect(await refundLedgerCount()).toBe(0);
  });

  it("部分退款：登记只待确认不扣款，确认后才扣钱包 + 流水 + 冲销总账 + 审计", async () => {
    const evidenceRef = `STORE-RFD-PART-${suffix}`;
    const registered = await refunds.register({
      tenantId,
      operatorAccountId,
      outNo,
      amountFen: 5000n,
      reason: "客户取消部分服务",
    });
    expect(registered.duplicate).toBe(false);
    expect(registered.refund.status).toBe("PENDING_CONFIRMATION");
    expect(registered.refund.amountFen).toBe(5000n);
    // 登记不是退款事实：累计已确认仍为 0，钱包余额是**未扣减**的真实余额
    expect(registered.refund.refundedFen).toBe(0n);
    expect(registered.refund.walletBalanceFen).toBe(PAY_AMOUNT);
    expect(registered.refund.fullyRefunded).toBe(false);

    expect(await walletBalance()).toBe(PAY_AMOUNT);
    expect(await walletEntries()).toHaveLength(0);
    expect(await refundLedgerCount()).toBe(0);
    expect(await auditCount(REQUESTED_ACTION)).toBe(1);
    expect(await auditCount(CONFIRMED_ACTION)).toBe(0);

    const refundId = registered.refund.refundId;
    const confirmed = await refunds.confirm({
      tenantId,
      operatorAccountId,
      refundId,
      evidenceRef,
    });
    expect(confirmed.duplicate).toBe(false);
    expect(confirmed.refund.status).toBe("SUCCEEDED");
    expect(confirmed.refund.amountFen).toBe(5000n);
    expect(confirmed.refund.refundedFen).toBe(5000n);
    expect(confirmed.refund.walletBalanceFen).toBe(7800n);
    expect(confirmed.refund.fullyRefunded).toBe(false);
    expect(await walletBalance()).toBe(7800n);

    const rows = await refundRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("SUCCEEDED");
    expect(rows[0]!.amountFen).toBe(5000n);
    expect(rows[0]!.reason).toBe("客户取消部分服务");
    expect(rows[0]!.paymentOrderId).toBe(orderId);
    expect(rows[0]!.succeededAt).not.toBeNull();
    // 门店退款凭据号写进 refund_id（仅作可审计引用）
    expect(rows[0]!.refundId).toBe(evidenceRef);
    expect(rows[0]!.outRefundNo).toBe(registered.refund.outRefundNo);

    const entries = await walletEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.type).toBe("REFUND");
    // 金额恒为正、方向由 type 决定（表上有 CHECK amount_fen > 0）
    expect(entries[0]!.amountFen).toBe(5000n);
    expect(entries[0]!.balanceAfterFen).toBe(7800n);
    expect(entries[0]!.referenceId).toBe(refundId);

    // 冲销总账与支付入账方向相反：借客户预收款、贷微信结算资产
    const posting = await refundLedger(refundId);
    expect(posting.transaction).not.toBeNull();
    expect(posting.transaction!.status).toBe(REFUND_CONFIRMED_STATUS);
    expect(posting.transaction!.fundAccountId).toBe(fundAccountId);
    expect(posting.transaction!.sourceType).toBe(REFUND_CONFIRMED_SOURCE_TYPE);
    expect(posting.transaction!.sourceId).toBe(refundId);
    expect(posting.entries).toHaveLength(2);
    const codeById = await ledgerAccountCodes();
    const liabilityDebit = posting.entries.find(
      (row) => row.direction === "DEBIT",
    );
    const assetCredit = posting.entries.find(
      (row) => row.direction === "CREDIT",
    );
    expect(liabilityDebit).toBeDefined();
    expect(assetCredit).toBeDefined();
    expect(codeById.get(liabilityDebit!.accountId)).toBe(
      CUSTOMER_PREPAID_LIABILITY_ACCOUNT.code,
    );
    expect(codeById.get(assetCredit!.accountId)).toBe(
      WECHAT_SETTLEMENT_ASSET_ACCOUNT.code,
    );
    // 两条分录金额严格相等（平衡）；只有贷方（资产）挂原支付资金账户
    expect(liabilityDebit!.amountFen).toBe(5000n);
    expect(assetCredit!.amountFen).toBe(5000n);
    expect(liabilityDebit!.fundAccountId).toBeNull();
    expect(assetCredit!.fundAccountId).toBe(fundAccountId);

    expect(await auditCount(CONFIRMED_ACTION)).toBe(1);
    // 支付单状态**不因退款改变**：表上只有 PENDING/SUCCESS/FAILED，退款事实落 payment_refunds
    const order = await owner.paymentOrder.findUnique({
      where: { id: orderId },
    });
    expect(order?.status).toBe("SUCCESS");
  });

  it("幂等键重复提交：只产生一张申请且不扣款；确认只扣一次，重复确认报冲突", async () => {
    const idempotencyKey = `key-${suffix}`;
    const first = await refunds.register({
      tenantId,
      operatorAccountId,
      orderId,
      amountFen: 1000n,
      reason: "补偿差额",
      idempotencyKey,
    });
    expect(first.duplicate).toBe(false);
    expect(first.refund.status).toBe("PENDING_CONFIRMATION");
    expect(first.refund.refundedFen).toBe(5000n);
    expect(await walletBalance()).toBe(7800n);

    const again = await refunds.register({
      tenantId,
      operatorAccountId,
      orderId,
      amountFen: 1000n,
      reason: "补偿差额",
      idempotencyKey,
    });
    expect(again.duplicate).toBe(true);
    expect(again.refund.refundId).toBe(first.refund.refundId);
    expect(await walletBalance()).toBe(7800n);
    // 第二张申请没有被创建；钱包流水也还是只有上一笔确认写入的
    expect(await refundRows()).toHaveLength(2);
    expect(await walletEntries()).toHaveLength(1);
    expect(await auditCount(REQUESTED_ACTION)).toBe(2);

    const refundId = first.refund.refundId;
    const confirmed = await refunds.confirm({
      tenantId,
      operatorAccountId,
      refundId,
      evidenceRef: `STORE-RFD-IDEM-${suffix}`,
    });
    expect(confirmed.refund.status).toBe("SUCCEEDED");
    expect(confirmed.refund.refundedFen).toBe(6000n);
    expect(confirmed.refund.walletBalanceFen).toBe(6800n);
    expect(await walletBalance()).toBe(6800n);
    expect(await walletEntries()).toHaveLength(2);

    // 重复确认必须报冲突，绝不二次扣款
    await expect(
      refunds.confirm({
        tenantId,
        operatorAccountId,
        refundId,
        evidenceRef: `STORE-RFD-IDEM-RETRY-${suffix}`,
      }),
    ).rejects.toBeInstanceOf(RefundStatusTransitionError);
    expect(await walletBalance()).toBe(6800n);
    expect(await walletEntries()).toHaveLength(2);
    expect(await refundLedgerCount()).toBe(2);
    expect(await auditCount(CONFIRMED_ACTION)).toBe(2);
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
    expect(await auditCount(REQUESTED_ACTION)).toBe(2);
  });

  it("钱包不足：登记成功保持待确认，确认时才因余额不足整笔回滚", async () => {
    const wallet = await owner.bossWallet.findFirst({
      where: { tenantId, customerProfileId: profileId },
    });
    await owner.bossWallet.update({
      where: { id: wallet!.id },
      data: { balanceFen: 100n },
    });

    const registered = await refunds.register({
      tenantId,
      operatorAccountId,
      outNo,
      amountFen: 500n,
      reason: "余额不足场景",
    });
    // 登记只看可退额度、不看钱包余额：这里必须成功且仍是待确认
    expect(registered.refund.status).toBe("PENDING_CONFIRMATION");
    expect(registered.refund.walletBalanceFen).toBe(100n);

    const refundId = registered.refund.refundId;
    await expect(
      refunds.confirm({
        tenantId,
        operatorAccountId,
        refundId,
        evidenceRef: `STORE-RFD-INSUFF-${suffix}`,
      }),
    ).rejects.toBeInstanceOf(RefundInsufficientBalanceError);

    // 整笔回滚：钱包、流水、冲销总账、审计都不变，退款单仍停在待确认
    expect(await walletBalance()).toBe(100n);
    expect(await walletEntries()).toHaveLength(2);
    expect(await refundLedgerCount()).toBe(2);
    expect(await refundLedger(refundId)).toEqual({
      transaction: null,
      entries: [],
    });
    expect(await auditCount(CONFIRMED_ACTION)).toBe(2);
    const stillPending = await owner.paymentRefund.findUnique({
      where: { id: refundId },
    });
    expect(stillPending?.status).toBe("PENDING_CONFIRMATION");
    expect(stillPending?.succeededAt).toBeNull();
    expect(stillPending?.refundId).toBeNull();

    // 这条待确认申请会一直占着额度：删掉它，避免影响后面的全额退款用例；并还原钱包
    await owner.paymentRefund.delete({ where: { id: refundId } });
    await owner.bossWallet.update({
      where: { id: wallet!.id },
      data: { balanceFen: 6800n },
    });
  });

  it("全额退款：登记 6800 后确认，钱包扣到 0 且 fullyRefunded=true；再退被拒", async () => {
    const registered = await refunds.register({
      tenantId,
      operatorAccountId,
      outNo,
      amountFen: 6800n,
      reason: "客户整单取消",
    });
    expect(registered.refund.status).toBe("PENDING_CONFIRMATION");
    expect(registered.refund.refundedFen).toBe(6000n);
    expect(await walletBalance()).toBe(6800n);

    const confirmed = await refunds.confirm({
      tenantId,
      operatorAccountId,
      refundId: registered.refund.refundId,
      evidenceRef: `STORE-RFD-FULL-${suffix}`,
    });
    expect(confirmed.refund.status).toBe("SUCCEEDED");
    expect(confirmed.refund.refundedFen).toBe(PAY_AMOUNT);
    expect(confirmed.refund.walletBalanceFen).toBe(0n);
    expect(confirmed.refund.fullyRefunded).toBe(true);
    expect(await walletBalance()).toBe(0n);
    // 支付单状态**不因退款改变**：退款事实落 payment_refunds
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
    expect(await auditCount(CONFIRMED_ACTION)).toBe(3);
  });
});

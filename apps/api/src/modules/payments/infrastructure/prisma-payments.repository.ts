import { withTenantContext } from "@pw/database";
import type { DbTransaction, PrismaClient } from "@pw/database";
import { randomBytes } from "node:crypto";
import { buildLedgerTransactionNo } from "../../ledger/domain/ledger-transaction-no.js";
import type { CheckoutRepository } from "../application/checkout-ports.js";
import type {
  InboxEventRecord,
  NewInboxEvent,
  PaymentOrderRecord,
  PaymentsRepository,
  SettleResult,
} from "../application/payments-ports.js";
import {
  CUSTOMER_PREPAID_LIABILITY_ACCOUNT,
  WECHAT_SETTLEMENT_ASSET_ACCOUNT,
  WechatSettlementFundAccountConfigurationError,
  buildPaymentConfirmedLedgerPosting,
} from "../domain/payment-confirmed-ledger-posting.js";

/** 与 wallet.service 同款老板号生成规则（钱包不存在时按需建）。 */
function bossNo(): string {
  return `B${Date.now().toString(36).toUpperCase()}${randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;
}

export class PrismaPaymentsRepository
  implements PaymentsRepository, CheckoutRepository
{
  constructor(
    /** 平台/owner 连接：回件箱与"按商户单号全局找支付单"都在不知道租户时进行。 */
    private readonly platform: PrismaClient,
    /** 运行时连接：入账必须在租户上下文内（RLS 生效）。 */
    private readonly runtime: PrismaClient,
  ) {}

  async saveInboxEvent(input: NewInboxEvent): Promise<{ id: string } | null> {
    try {
      const row = await this.platform.webhookInbox.create({
        data: {
          provider: input.provider,
          eventId: input.eventId,
          eventType: input.eventType,
          headers: input.headers,
          rawBody: input.rawBody,
          signatureVerified: input.signatureVerified,
        },
      });
      return { id: row.id };
    } catch (error) {
      // (provider, event_id) 唯一约束 → 同一事件重复投递，按幂等成功处理
      if ((error as { code?: string }).code === "P2002") return null;
      throw error;
    }
  }

  async listUnprocessedInbox(limit: number): Promise<InboxEventRecord[]> {
    const rows = await this.platform.webhookInbox.findMany({
      where: { processedAt: null },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: {
        id: true,
        provider: true,
        eventId: true,
        eventType: true,
        rawBody: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      eventId: row.eventId,
      eventType: row.eventType,
      rawBody: row.rawBody,
    }));
  }

  async markInboxProcessed(id: string, processedAt: Date): Promise<void> {
    await this.platform.webhookInbox.update({
      where: { id },
      data: { processedAt },
    });
  }

  async findPaymentOrderByOutNo(
    outNo: string,
  ): Promise<PaymentOrderRecord | null> {
    const row = await this.platform.paymentOrder.findFirst({
      where: { outNo },
      select: {
        id: true,
        tenantId: true,
        customerProfileId: true,
        amountFen: true,
        status: true,
        transactionId: true,
        providerRef: true,
      },
    });
    return row;
  }

  async settlePaymentOrder(input: {
    tenantId: string;
    orderId: string;
    transactionId: string;
    paidAt: Date;
    reason: string;
  }): Promise<SettleResult> {
    return withTenantContext(
      this.runtime,
      input.tenantId,
      async (tx: DbTransaction) => {
        const order = await tx.paymentOrder.findFirst({
          where: { id: input.orderId, tenantId: input.tenantId },
          select: {
            id: true,
            outNo: true,
            customerProfileId: true,
            amountFen: true,
          },
        });
        if (!order) throw new Error("payment order not found");

        // 状态守卫：只有非 SUCCESS 才允许入账（幂等的第二层）
        const guard = await tx.paymentOrder.updateMany({
          where: {
            id: input.orderId,
            tenantId: input.tenantId,
            status: { not: "SUCCESS" },
          },
          data: {
            status: "SUCCESS",
            provider: "wechatpay_partner",
            providerRef: input.transactionId,
            transactionId: input.transactionId,
            paidAt: input.paidAt,
          },
        });
        if (guard.count !== 1) return { credited: false };

        let wallet = await tx.bossWallet.findFirst({
          where: {
            tenantId: input.tenantId,
            customerProfileId: order.customerProfileId,
          },
        });
        if (!wallet) {
          wallet = await tx.bossWallet.create({
            data: {
              tenantId: input.tenantId,
              customerProfileId: order.customerProfileId,
              bossNo: bossNo(),
              balanceFen: 0n,
            },
          });
        }

        // 行锁 + 读当前余额（与 wallet.service 的充值路径同一把锁，避免并发丢更新）
        const locks = await tx.$queryRaw<
          Array<{ id: string; balance_fen: bigint }>
        >`
        SELECT id, balance_fen FROM boss_wallets
        WHERE id = ${wallet.id}::uuid AND tenant_id = ${input.tenantId}::uuid
        FOR UPDATE`;
        const current = locks[0]?.balance_fen ?? 0n;
        const after = current + order.amountFen;
        await tx.bossWallet.update({
          where: { id: wallet.id },
          data: { balanceFen: after },
        });
        await tx.walletEntry.create({
          data: {
            tenantId: input.tenantId,
            customerProfileId: order.customerProfileId,
            walletId: wallet.id,
            txNo: order.outNo,
            type: "RECHARGE",
            amountFen: order.amountFen,
            balanceAfterFen: after,
            referenceType: "payment_order",
            referenceId: order.id,
            reason: input.reason,
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId: input.tenantId,
            actorType: "system",
            action: "payment.wechatpay.paid",
            resourceType: "payment_order",
            resourceId: order.id,
            summary: `微信支付入账 ${order.amountFen} 分（transaction_id=${input.transactionId}）`,
          },
        });

        // ===== DS-003：同一事务内追加统一总账交易（借贷平衡、可按资金账户查询） =====
        // 资金账户必须恰好一个：0 个说明还没配微信结算账户，多于 1 个说明配置有歧义。
        // 两种情况都不得擅自挑一个，抛错让整个事务回滚——支付单不转 SUCCESS、钱包不变动、总账不写入。
        const fundAccounts = await tx.fundAccount.findMany({
          where: {
            tenantId: input.tenantId,
            status: "ACTIVE",
            kind: "WECHAT_SETTLEMENT",
          },
          select: { id: true },
        });
        const fundAccount =
          fundAccounts.length === 1 ? fundAccounts[0] : undefined;
        if (!fundAccount) {
          throw new WechatSettlementFundAccountConfigurationError(
            fundAccounts.length,
          );
        }

        const posting = buildPaymentConfirmedLedgerPosting({
          amountFen: order.amountFen,
          fundAccountId: fundAccount.id,
          paymentOrderId: order.id,
          paymentOrderOutNo: order.outNo,
          customerProfileId: order.customerProfileId,
          paidAt: input.paidAt,
        });

        // 科目只建不改：`update` 为空对象，避免覆盖既有科目的名称。
        // 不依赖 upsert 的返回值——空 update 的 upsert 在行已存在时不保证回读该行；
        // 按仓内既有约定（prisma-ledger.repository.ensureAccount）改成 upsert 后重新查回 id。
        for (const account of [
          WECHAT_SETTLEMENT_ASSET_ACCOUNT,
          CUSTOMER_PREPAID_LIABILITY_ACCOUNT,
        ]) {
          await tx.ledgerAccount.upsert({
            where: {
              tenantId_code: {
                tenantId: input.tenantId,
                code: account.code,
              },
            },
            create: {
              tenantId: input.tenantId,
              code: account.code,
              name: account.name,
            },
            update: {},
          });
        }
        const accountRows = await tx.ledgerAccount.findMany({
          where: {
            tenantId: input.tenantId,
            code: {
              in: [
                WECHAT_SETTLEMENT_ASSET_ACCOUNT.code,
                CUSTOMER_PREPAID_LIABILITY_ACCOUNT.code,
              ],
            },
          },
          select: { id: true, code: true },
        });
        const accountIds = new Map<string, string>();
        for (const row of accountRows) {
          accountIds.set(row.code, row.id);
        }

        const ledgerTransaction = await tx.ledgerTransaction.create({
          data: {
            tenantId: input.tenantId,
            txNo: buildLedgerTransactionNo(),
            description: posting.transaction.description,
            sourceType: posting.transaction.sourceType,
            sourceId: posting.transaction.sourceId,
            eventType: posting.transaction.eventType,
            status: posting.transaction.status,
            fundAccountId: posting.transaction.fundAccountId,
            occurredAt: posting.transaction.occurredAt,
            confirmedAt: posting.transaction.confirmedAt,
          },
          select: { id: true },
        });

        for (const entry of posting.entries) {
          const accountId = accountIds.get(entry.accountCode);
          if (!accountId) {
            throw new Error(`总账科目未就绪：${entry.accountCode}`);
          }
          await tx.ledgerEntry.create({
            data: {
              tenantId: input.tenantId,
              transactionId: ledgerTransaction.id,
              accountId,
              direction: entry.direction,
              amountFen: entry.amountFen,
              fundAccountId: entry.fundAccountId,
              auxiliaryType: entry.auxiliaryType,
              auxiliaryId: entry.auxiliaryId,
            },
          });
        }

        return { credited: true, balanceAfterFen: after };
      },
    );
  }

  async recordDifference(input: {
    tenantId: string;
    kind: string;
    paymentOrderId?: string;
    amountFen?: bigint;
    detail: string;
  }): Promise<void> {
    await withTenantContext(this.runtime, input.tenantId, (tx: DbTransaction) =>
      tx.reconciliationDifference.create({
        data: {
          tenantId: input.tenantId,
          kind: input.kind,
          ...(input.paymentOrderId
            ? { paymentOrderId: input.paymentOrderId }
            : {}),
          ...(input.amountFen !== undefined
            ? { amountFen: input.amountFen }
            : {}),
          detail: input.detail,
        },
      }),
    );
  }

  // ===== S4-2c：下单所需（门店子商户 / 客户 sp_openid / 预支付单） =====

  async findTenantPaymentAccount(
    tenantId: string,
  ): Promise<{ subMchid: string | null; status: string } | null> {
    return withTenantContext(
      this.runtime,
      tenantId,
      async (tx: DbTransaction) => {
        const row = await tx.tenantPaymentAccount.findFirst({
          where: { tenantId },
          select: { subMchid: true, status: true },
        });
        return row ?? null;
      },
    );
  }

  async findCustomerPayerIdentity(
    tenantId: string,
    customerAccountId: string,
  ): Promise<{ customerProfileId: string; spOpenid: string | null } | null> {
    return withTenantContext(
      this.runtime,
      tenantId,
      async (tx: DbTransaction) => {
        const profile = await tx.customerProfile.findFirst({
          where: { tenantId, tenantAccountId: customerAccountId },
          select: { id: true },
        });
        if (!profile) return null;
        const account = await tx.tenantAccount.findFirst({
          where: { tenantId, id: customerAccountId },
          select: { wechatOpenid: true },
        });
        return {
          customerProfileId: profile.id,
          spOpenid: account?.wechatOpenid ?? null,
        };
      },
    );
  }

  async createPrepayOrder(input: {
    tenantId: string;
    customerProfileId: string;
    outNo: string;
    amountFen: bigint;
    spMchid: string;
    subMchid: string;
  }): Promise<{ id: string; outNo: string }> {
    return withTenantContext(
      this.runtime,
      input.tenantId,
      async (tx: DbTransaction) => {
        const row = await tx.paymentOrder.create({
          data: {
            tenantId: input.tenantId,
            customerProfileId: input.customerProfileId,
            outNo: input.outNo,
            amountFen: input.amountFen,
            provider: "wechatpay_partner",
            status: "PENDING",
            spMchid: input.spMchid,
            subMchid: input.subMchid,
          },
          select: { id: true, outNo: true },
        });
        return { id: row.id, outNo: row.outNo };
      },
    );
  }

  async findCustomerPaymentOrder(input: {
    tenantId: string;
    customerProfileId: string;
    outNo: string;
  }): Promise<{
    outNo: string;
    status: string;
    amountFen: bigint;
    paidAt: Date | null;
  } | null> {
    return withTenantContext(
      this.runtime,
      input.tenantId,
      async (tx: DbTransaction) => {
        const row = await tx.paymentOrder.findFirst({
          where: {
            tenantId: input.tenantId,
            customerProfileId: input.customerProfileId,
            outNo: input.outNo,
          },
          select: {
            outNo: true,
            status: true,
            amountFen: true,
            paidAt: true,
          },
        });
        return row ?? null;
      },
    );
  }

  async attachPrepayId(
    tenantId: string,
    orderId: string,
    prepayId: string,
  ): Promise<void> {
    await withTenantContext(
      this.runtime,
      tenantId,
      async (tx: DbTransaction) => {
        await tx.paymentOrder.updateMany({
          where: { id: orderId, tenantId },
          data: { prepayId },
        });
      },
    );
  }
}

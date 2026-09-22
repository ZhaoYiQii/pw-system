import { withTenantContext } from "@pw/database";
import type { DbTransaction, PrismaClient } from "@pw/database";
import type {
  ManualRefundRepository,
  ManualRefundResult,
  RefundOrderRecord,
} from "../application/refund-ports.js";
import {
  DuplicateRefundError,
  InsufficientWalletBalanceError,
} from "../application/manual-refund.service.js";

/**
 * S4-4：人工退款登记的真库实现。
 *
 * 全部走**运行时连接 + 租户上下文**（RLS 生效）：退款是租户级资源，
 * 与回调链路需要跨租户找单的情况不同——这里租户 id 从登录态来，不需要平台连接。
 */
export class PrismaRefundRepository implements ManualRefundRepository {
  constructor(private readonly runtime: PrismaClient) {}

  async findOrderForRefund(
    tenantId: string,
    input: { outNo?: string; orderId?: string },
  ): Promise<RefundOrderRecord | null> {
    return withTenantContext(
      this.runtime,
      tenantId,
      async (tx: DbTransaction) => {
        const order = await tx.paymentOrder.findFirst({
          where: {
            tenantId,
            ...(input.orderId ? { id: input.orderId } : {}),
            ...(input.outNo ? { outNo: input.outNo } : {}),
          },
          select: {
            id: true,
            outNo: true,
            amountFen: true,
            status: true,
            customerProfileId: true,
          },
        });
        if (!order) return null;
        const refunded = await tx.paymentRefund.aggregate({
          where: {
            tenantId,
            paymentOrderId: order.id,
            status: "SUCCEEDED",
          },
          _sum: { amountFen: true },
        });
        return {
          id: order.id,
          outNo: order.outNo,
          amountFen: order.amountFen,
          status: order.status,
          customerProfileId: order.customerProfileId,
          refundedFen: refunded._sum.amountFen ?? 0n,
        };
      },
    );
  }

  async applyManualRefund(input: {
    tenantId: string;
    orderId: string;
    customerProfileId: string;
    orderAmountFen: bigint;
    amountFen: bigint;
    reason: string;
    operatorAccountId: string;
    outRefundNo: string;
  }): Promise<ManualRefundResult> {
    return withTenantContext(
      this.runtime,
      input.tenantId,
      async (tx: DbTransaction) => {
        // 1) 先原子插入退款单：唯一约束挡重复提交。
        //    为什么用 ON CONFLICT DO NOTHING 而不是"catch 唯一冲突再查询"：
        //    Postgres 事务里任何语句报错后整个事务作废（25P02），后续查询会被拒——
        //    S4-3b 的真库测试抓到过这个坑，这里沿用同一写法。
        //    注意 updated_at 无默认值（Prisma 的 @updatedAt 只在 client 写入时生效），原生 SQL 必须自己给。
        const inserted = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO payment_refunds
          (tenant_id, payment_order_id, out_refund_no, amount_fen, status, reason, succeeded_at, updated_at)
        VALUES (
          ${input.tenantId}::uuid,
          ${input.orderId}::uuid,
          ${input.outRefundNo},
          ${input.amountFen},
          'SUCCEEDED',
          ${input.reason},
          now(),
          now()
        )
        ON CONFLICT (tenant_id, out_refund_no) DO NOTHING
        RETURNING id::text AS id`;
        if (inserted.length === 0) {
          throw new DuplicateRefundError(
            await this.loadExistingRefund(
              tx,
              input.tenantId,
              input.outRefundNo,
            ),
          );
        }
        const refundId = inserted[0]!.id;

        // 2) 钱包扣减：与充值/入账同一把行锁（SELECT ... FOR UPDATE），余额不够则抛错整笔回滚
        const locks = await tx.$queryRaw<
          Array<{ id: string; balance_fen: bigint }>
        >`
        SELECT id, balance_fen FROM boss_wallets
        WHERE tenant_id = ${input.tenantId}::uuid
          AND customer_profile_id = ${input.customerProfileId}::uuid
        FOR UPDATE`;
        const wallet = locks[0];
        if (!wallet) {
          throw new InsufficientWalletBalanceError(0n, input.amountFen);
        }
        const balance = wallet.balance_fen;
        if (balance < input.amountFen) {
          throw new InsufficientWalletBalanceError(balance, input.amountFen);
        }
        const after = balance - input.amountFen;
        await tx.bossWallet.update({
          where: { id: wallet.id },
          data: { balanceFen: after },
        });
        await tx.walletEntry.create({
          data: {
            tenantId: input.tenantId,
            customerProfileId: input.customerProfileId,
            walletId: wallet.id,
            txNo: input.outRefundNo,
            type: "REFUND",
            amountFen: input.amountFen,
            balanceAfterFen: after,
            referenceType: "payment_refund",
            referenceId: refundId,
            reason: `人工退款登记：${input.reason}`,
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId: input.tenantId,
            actorType: "tenant_account",
            actorId: input.operatorAccountId,
            action: "payment.refund.manual",
            resourceType: "payment_refund",
            resourceId: refundId,
            summary: `人工退款登记 ${input.amountFen} 分（out_refund_no=${input.outRefundNo}）：${input.reason}`,
          },
        });

        // 3) 累计退款达到支付金额 → fullyRefunded=true（**不动 payment_orders.status**）。
        //    为什么不标记 REFUNDED：表上有 CHECK (status IN ('PENDING','SUCCESS','FAILED'))，
        //    没有这个状态（本片真库测试当场抓到）。退款的事实来源是 payment_refunds：
        //    「累计已退 = 支付金额」即全额退，再退会被服务端"可退 0 分"规则挡住。
        const refunded = await tx.paymentRefund.aggregate({
          where: {
            tenantId: input.tenantId,
            paymentOrderId: input.orderId,
            status: "SUCCEEDED",
          },
          _sum: { amountFen: true },
        });
        const refundedFen = refunded._sum.amountFen ?? 0n;
        const fullyRefunded = refundedFen >= input.orderAmountFen;
        return {
          refundId,
          outRefundNo: input.outRefundNo,
          amountFen: input.amountFen,
          refundedFen,
          walletBalanceFen: after,
          fullyRefunded,
        };
      },
    );
  }

  /** 幂等命中：把已经登记好的那笔原样读回来（含当前余额与累计退款）。 */
  private async loadExistingRefund(
    tx: DbTransaction,
    tenantId: string,
    outRefundNo: string,
  ): Promise<ManualRefundResult> {
    const existing = await tx.paymentRefund.findFirst({
      where: { tenantId, outRefundNo },
      select: {
        id: true,
        outRefundNo: true,
        amountFen: true,
        paymentOrderId: true,
      },
    });
    if (!existing) {
      // 理论上不可达：插入冲突意味着这行存在。真出现说明唯一索引与查询条件不一致，必须暴露。
      throw new Error(`refund row disappeared: ${outRefundNo}`);
    }
    const order = await tx.paymentOrder.findFirst({
      where: { tenantId, id: existing.paymentOrderId },
      select: { customerProfileId: true, amountFen: true },
    });
    const refunded = await tx.paymentRefund.aggregate({
      where: {
        tenantId,
        paymentOrderId: existing.paymentOrderId,
        status: "SUCCEEDED",
      },
      _sum: { amountFen: true },
    });
    const refundedFen = refunded._sum.amountFen ?? 0n;
    const wallet = order
      ? await tx.bossWallet.findFirst({
          where: { tenantId, customerProfileId: order.customerProfileId },
          select: { balanceFen: true },
        })
      : null;
    return {
      refundId: existing.id,
      outRefundNo,
      amountFen: existing.amountFen,
      refundedFen,
      walletBalanceFen: wallet?.balanceFen ?? 0n,
      fullyRefunded: order ? refundedFen >= order.amountFen : false,
    };
  }
}

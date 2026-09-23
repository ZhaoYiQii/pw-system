import { withTenantContext } from "@pw/database";
import type { DbTransaction, PrismaClient } from "@pw/database";
import type {
  PaymentLedgerQuery,
  PaymentLedgerRepository,
  PaymentLedgerRow,
} from "../application/payment-ledger-ports.js";

/**
 * S4-7：门店支付台账的真库实现。
 *
 * 走**运行时连接 + 租户上下文**（RLS 生效）：台账是租户级资源，租户 id 从登录态来，
 * 不需要平台连接（那是回调链路跨租户找单才需要的）。
 *
 * 三次查询而不是一次 join 的原因：`payment_refunds` 要按支付单**求和**，
 * join 会把行数放大（一个支付单多笔退款 → 支付单重复计数），所以退款金额单独聚合后按 id 合并。
 */
export class PrismaPaymentLedgerRepository implements PaymentLedgerRepository {
  constructor(private readonly runtime: PrismaClient) {}

  async listOrders(query: PaymentLedgerQuery): Promise<PaymentLedgerRow[]> {
    return withTenantContext(
      this.runtime,
      query.tenantId,
      async (tx: DbTransaction) => {
        const orders = await tx.paymentOrder.findMany({
          where: {
            tenantId: query.tenantId,
            ...(query.status ? { status: query.status } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: query.limit,
          select: {
            id: true,
            outNo: true,
            amountFen: true,
            status: true,
            customerProfileId: true,
            createdAt: true,
            paidAt: true,
          },
        });
        if (orders.length === 0) return [];

        const refunds = await tx.paymentRefund.groupBy({
          by: ["paymentOrderId"],
          where: {
            tenantId: query.tenantId,
            paymentOrderId: { in: orders.map((order) => order.id) },
            status: "SUCCEEDED",
          },
          _sum: { amountFen: true },
        });
        const refundedByOrder = new Map(
          refunds.map((item) => [
            item.paymentOrderId,
            item._sum.amountFen ?? 0n,
          ]),
        );

        const profiles = await tx.customerProfile.findMany({
          where: {
            tenantId: query.tenantId,
            id: {
              in: [...new Set(orders.map((order) => order.customerProfileId))],
            },
          },
          select: { id: true, name: true },
        });
        const nameByProfile = new Map(
          profiles.map((profile) => [profile.id, profile.name]),
        );

        return orders.map((order) => ({
          id: order.id,
          outNo: order.outNo,
          amountFen: order.amountFen,
          refundedFen: refundedByOrder.get(order.id) ?? 0n,
          status: order.status,
          customerProfileId: order.customerProfileId,
          customerName: nameByProfile.get(order.customerProfileId) ?? null,
          createdAt: order.createdAt,
          paidAt: order.paidAt,
        }));
      },
    );
  }
}

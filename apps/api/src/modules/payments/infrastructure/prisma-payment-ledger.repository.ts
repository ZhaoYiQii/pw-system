import { withTenantContext } from "@pw/database";
import type { DbTransaction, PrismaClient } from "@pw/database";
import type {
  PaymentLedgerQuery,
  PaymentLedgerRepository,
  PaymentLedgerRow,
} from "../application/payment-ledger-ports.js";

/**
 * S5-1：门店支付台账的真库实现（服务端分页/排序/筛选）。
 *
 * 走**运行时连接 + 租户上下文**（RLS 生效）：台账是租户级资源，租户 id 从登录态来。
 *
 * 三次查询而不是一次 join：
 * - `payment_refunds` 要按支付单**求和**，join 会把行数放大（一个支付单多笔退款 → 支付单重复计数）；
 * - 关键词搜索要按**客户名**匹配，而 `PaymentOrder` 上没有指向客户档案的关系字段
 *   （S4-9a 的 `BossWallet` 踩过同一个坑：写关系过滤会被 Prisma 判为未知参数），
 *   所以先按名字取档案 id，再用 `in` 过滤。
 * 需要 count 与 list 的筛选条件**完全一致**，两处各自内联构造（避免抽一个手写类型的
 * where 工厂：Prisma 的 where 类型靠推断，手工标注更容易写错）。
 */
export class PrismaPaymentLedgerRepository implements PaymentLedgerRepository {
  constructor(private readonly runtime: PrismaClient) {}

  async listOrders(query: PaymentLedgerQuery): Promise<PaymentLedgerRow[]> {
    return withTenantContext(
      this.runtime,
      query.tenantId,
      async (tx: DbTransaction) => {
        const profileIds = await this.profileIdsForSearch(tx, query);
        const orders = await tx.paymentOrder.findMany({
          where: {
            tenantId: query.tenantId,
            ...(query.status ? { status: query.status } : {}),
            ...(query.q
              ? {
                  OR: [
                    { outNo: { contains: query.q, mode: "insensitive" } },
                    ...(profileIds.length > 0
                      ? [{ customerProfileId: { in: profileIds } }]
                      : []),
                  ],
                }
              : {}),
          },
          orderBy: { [query.sortBy]: query.sortDir },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
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

  async countOrders(
    query: Pick<PaymentLedgerQuery, "tenantId" | "status" | "q">,
  ): Promise<number> {
    return withTenantContext(
      this.runtime,
      query.tenantId,
      async (tx: DbTransaction) => {
        const profileIds = await this.profileIdsForSearch(tx, query);
        return tx.paymentOrder.count({
          where: {
            tenantId: query.tenantId,
            ...(query.status ? { status: query.status } : {}),
            ...(query.q
              ? {
                  OR: [
                    { outNo: { contains: query.q, mode: "insensitive" } },
                    ...(profileIds.length > 0
                      ? [{ customerProfileId: { in: profileIds } }]
                      : []),
                  ],
                }
              : {}),
          },
        });
      },
    );
  }

  /** 关键词是不是某个客户名：先查档案 id（`PaymentOrder` 上没有关系字段，不能写关系过滤）。 */
  private async profileIdsForSearch(
    tx: DbTransaction,
    query: Pick<PaymentLedgerQuery, "tenantId" | "q">,
  ): Promise<string[]> {
    if (!query.q) return [];
    const matched = await tx.customerProfile.findMany({
      where: {
        tenantId: query.tenantId,
        name: { contains: query.q, mode: "insensitive" },
      },
      select: { id: true },
    });
    return matched.map((profile) => profile.id);
  }
}

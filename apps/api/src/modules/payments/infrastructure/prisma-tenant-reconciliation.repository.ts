import { withTenantContext } from "@pw/database";
import type { DbTransaction, PrismaClient } from "@pw/database";
import type {
  ReconciliationDifferenceRow,
  ReconciliationStatementRow,
  TenantReconciliationRepository,
} from "../application/tenant-reconciliation-ports.js";

/**
 * S4-7b：门店可见对账的真库实现（**只读**）。
 *
 * 差异列表拆成两次查询：未解决一批、已解决一批，再按 limit 截断。
 * 不用 `orderBy: { resolvedAt: { nulls: "first" } }` 的原因：那是"排序技巧"，
 * 而这里是业务口径（**未解决必须永远排在最前**），写清楚比写得短重要。
 */
export class PrismaTenantReconciliationRepository implements TenantReconciliationRepository {
  constructor(private readonly runtime: PrismaClient) {}

  async listStatements(input: {
    tenantId: string;
    limit: number;
  }): Promise<ReconciliationStatementRow[]> {
    return withTenantContext(
      this.runtime,
      input.tenantId,
      async (tx: DbTransaction) =>
        tx.reconciliationStatement.findMany({
          where: { tenantId: input.tenantId },
          orderBy: { billDate: "desc" },
          take: input.limit,
          select: {
            id: true,
            billType: true,
            billDate: true,
            subMchid: true,
            totalCount: true,
            totalFen: true,
            downloadedAt: true,
          },
        }),
    );
  }

  async listDifferences(input: {
    tenantId: string;
    limit: number;
  }): Promise<ReconciliationDifferenceRow[]> {
    return withTenantContext(
      this.runtime,
      input.tenantId,
      async (tx: DbTransaction) => {
        const select = {
          id: true,
          kind: true,
          amountFen: true,
          detail: true,
          paymentOrderId: true,
          resolvedAt: true,
          createdAt: true,
        } as const;
        const unresolved = await tx.reconciliationDifference.findMany({
          where: { tenantId: input.tenantId, resolvedAt: null },
          orderBy: { createdAt: "desc" },
          take: input.limit,
          select,
        });
        if (unresolved.length >= input.limit) return unresolved;
        const resolved = await tx.reconciliationDifference.findMany({
          where: { tenantId: input.tenantId, resolvedAt: { not: null } },
          orderBy: { resolvedAt: "desc" },
          take: input.limit - unresolved.length,
          select,
        });
        return [...unresolved, ...resolved];
      },
    );
  }

  async countUnresolvedDifferences(tenantId: string): Promise<number> {
    return withTenantContext(
      this.runtime,
      tenantId,
      async (tx: DbTransaction) =>
        tx.reconciliationDifference.count({
          where: { tenantId, resolvedAt: null },
        }),
    );
  }
}

import { withTenantContext } from "@pw/database";
import type { DbTransaction, PrismaClient } from "@pw/database";
import type {
  LocalPaymentOrder,
  ReconcileTarget,
  ReconciliationRepository,
} from "../application/reconciliation-ports.js";

export class PrismaReconciliationRepository implements ReconciliationRepository {
  constructor(
    /** 平台/owner 连接：跨门店找对账目标、落账单记录（此时按门店逐个处理，读写都在租户上下文里也能做，
     *  但"哪些门店需要对账"必须跨租户读，所以用平台连接）。 */
    private readonly platform: PrismaClient,
    /** 运行时连接：租户内的支付单与差异。 */
    private readonly runtime: PrismaClient,
  ) {}

  async listReconcileTargets(): Promise<ReconcileTarget[]> {
    const rows = await this.platform.tenantPaymentAccount.findMany({
      where: { status: "ACTIVE", subMchid: { not: null } },
      select: { tenantId: true, subMchid: true },
    });
    return rows
      .filter(
        (row): row is { tenantId: string; subMchid: string } =>
          row.subMchid !== null,
      )
      .map((row) => ({ tenantId: row.tenantId, subMchid: row.subMchid }));
  }

  async findLocalOrders(
    tenantId: string,
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<LocalPaymentOrder[]> {
    return withTenantContext(
      this.runtime,
      tenantId,
      async (tx: DbTransaction) => {
        const rows = await tx.paymentOrder.findMany({
          where: {
            tenantId,
            OR: [
              { paidAt: { gte: rangeStart, lt: rangeEnd } },
              // 回调还没到的单：按创建时间纳入，才能发现"微信有本地无/本地未标记支付"
              { paidAt: null, createdAt: { gte: rangeStart, lt: rangeEnd } },
            ],
          },
          select: {
            id: true,
            outNo: true,
            amountFen: true,
            status: true,
            transactionId: true,
          },
        });
        return rows;
      },
    );
  }

  async saveStatement(input: {
    tenantId: string;
    subMchid: string;
    billType: string;
    billDate: string;
    fileSha256: string;
    totalCount: number;
    totalFen: bigint;
  }): Promise<{ id: string; inserted: boolean }> {
    return withTenantContext(
      this.runtime,
      input.tenantId,
      async (tx: DbTransaction) => {
        // 为什么用原生 INSERT ... ON CONFLICT 而不是 create() + catch P2002：
        // Postgres 里事务内任何语句报错后，整个事务进入 aborted 状态（25P02），
        // 之后再发查询会被拒绝——"捕获唯一冲突再查一次"在事务内是走不通的（真库测试抓到过）。
        const inserted = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO reconciliation_statements
          (tenant_id, sub_mchid, bill_type, bill_date, file_sha256, total_count, total_fen)
        VALUES (
          ${input.tenantId}::uuid,
          ${input.subMchid},
          ${input.billType},
          ${input.billDate}::date,
          ${input.fileSha256},
          ${input.totalCount},
          ${input.totalFen}
        )
        ON CONFLICT (tenant_id, bill_type, bill_date, sub_mchid) DO NOTHING
        RETURNING id::text AS id`;
        if (inserted.length === 1)
          return { id: inserted[0]!.id, inserted: true };
        const existing = await tx.reconciliationStatement.findFirst({
          where: {
            tenantId: input.tenantId,
            subMchid: input.subMchid,
            billType: input.billType,
            billDate: new Date(`${input.billDate}T00:00:00.000Z`),
          },
          select: { id: true },
        });
        return { id: existing?.id ?? "", inserted: false };
      },
    );
  }

  async recordDifferences(
    inputs: Array<{
      tenantId: string;
      kind: string;
      paymentOrderId?: string;
      amountFen?: bigint;
      detail: string;
    }>,
  ): Promise<void> {
    for (const input of inputs) {
      await withTenantContext(
        this.runtime,
        input.tenantId,
        (tx: DbTransaction) =>
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
  }
}

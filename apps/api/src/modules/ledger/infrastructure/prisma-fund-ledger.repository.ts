/**
 * DS-007：统一资金台账查询仓储（**只读**，绝不写库）。
 *
 * 租户上下文：由 `tenantGuarded` 在模块注册处（`ledger.module.ts`）开启唯一的一层
 * `withTenantContext`（`SET LOCAL app.tenant_id`）。守卫会把方法接收者副本上的
 * `this.client` 换成该事务连接，因此本仓储**只使用 `this.client`**，不自行再开事务
 * （自开会在同一请求里叠出第二个连接，且守卫的租户设定无法作用到它）。
 *
 * 取数策略（禁止 N+1、禁止内存里过滤它租户数据、禁止把金额口径挪到应用层）：
 * 1) 一段参数化 SQL 在数据库层完成过滤 + 借方聚合 + 排序 + 分页，返回本页交易 id 与
 *    `COUNT(*) OVER ()` 总数；过滤条件写在这**唯一一处**，列表与计数因此不可能漂移；
 * 2) 再用有限次批量 `findMany`（`id in (...)`）取本页交易、其全部分录与资金账户，
 *    在内存里组装（两模型无 `@relation`，无法用 include，且批量读取仍然是常数次查询）。
 *
 * 金额口径：`amountFen` = 该交易**借方分录之和**（过滤与排序同口径，绝不把借贷相加）；
 * 该值在 SQL 里只算一次（派生表列 `debit_fen`），排序与金额过滤都引用它。
 * PostgreSQL 的 `SUM(bigint)` 返回 `numeric`，因此金额过滤参数也按 `::numeric` 比较，
 * 永不 cast 成 int8——否则超过 int8 的合法输入会在数据库层炸成 500。
 *
 * 分页：`OFFSET` 以 `bigint` 计算并绑定（大页码下 number 会溢出），`LIMIT` 由
 * `pageSize ≤ 200` 保护，保持 `::int`。
 */

import type { createDatabaseClient } from "@pw/database";
import type {
  FundLedgerEntryRow,
  FundLedgerFundAccountRef,
  FundLedgerPage,
  FundLedgerQuery,
  FundLedgerRepository,
  FundLedgerTransactionRow,
} from "../application/fund-ledger-ports.js";

type FundLedgerDbClient = ReturnType<typeof createDatabaseClient>;

/**
 * 绑定集合：缺席的过滤条件一律用 `null`（不是空串），
 * SQL 中每个条件都写成 `(${param}::text IS NULL OR ...)`，
 * 使一段固定 SQL 覆盖所有参数组合，同时保证每个占位符都有显式类型。
 */
interface FundLedgerBindings {
  tenantId: string;
  eventType: string | null;
  status: string | null;
  fundAccountId: string | null;
  sourceType: string | null;
  q: string | null;
  occurredFrom: string | null;
  occurredTo: string | null;
  /**
   * 金额边界以**十进制字符串**绑定，SQL 端再 `::numeric` 比较：
   * `SUM(bigint)` 返回 numeric，而 cast 成 `bigint` 会让超过 int8 的合法输入
   * （如 9223372036854775808）在数据库层报错——客户端输入问题不该变成 500。
   */
  minAmountFen: string | null;
  maxAmountFen: string | null;
  sortBy: string;
  sortDir: string;
}

/** 原始分页行：`COUNT(*) OVER ()` 是 int8，Prisma 交回 BigInt，照实标注并显式转换。 */
interface RawPageRow {
  id: string;
  total: bigint;
}

function toBindings(query: FundLedgerQuery): FundLedgerBindings {
  return {
    tenantId: query.tenantId,
    eventType: query.eventType ?? null,
    status: query.status ?? null,
    fundAccountId: query.fundAccountId ?? null,
    sourceType: query.sourceType ?? null,
    q: query.q ?? null,
    // 时间以 ISO 字符串绑定再 `::timestamptz`：绑定 Date 会被当成 timestamp，
    // 与 timestamptz 比较时按会话时区隐式换算，边界会整体偏移；ISO 串自带偏移，无歧义。
    occurredFrom: query.occurredFrom?.toISOString() ?? null,
    occurredTo: query.occurredTo?.toISOString() ?? null,
    minAmountFen: query.minAmountFen?.toString() ?? null,
    maxAmountFen: query.maxAmountFen?.toString() ?? null,
    sortBy: query.sortBy,
    sortDir: query.sortDir,
  };
}

export class PrismaFundLedgerRepository implements FundLedgerRepository {
  constructor(private readonly client: FundLedgerDbClient) {}

  async listTransactions(query: FundLedgerQuery): Promise<FundLedgerPage> {
    const bindings = toBindings(query);
    // offset 一律用 BigInt 计算：number 在大页码 × 大页大小时会先溢出再传给数据库，
    // 得到的是被悄悄改写的页（不报错、也不返回该页），BigInt 让越界交给数据库决定。
    const offset = (BigInt(query.page) - 1n) * BigInt(query.pageSize);

    const pageRows = await this.selectPageIds(bindings, query.pageSize, offset);
    const first = pageRows[0];
    if (first === undefined) {
      // 空页（可能只是翻过了末页）：窗口计数读不到。用**同一段 SQL** 只取第一行拿 total，
      // 过滤条件逐字相同，因此计数与列表口径一致；真没有匹配行时为 0。
      const probe = await this.selectPageIds(bindings, 1, 0n);
      const probeFirst = probe[0];
      return {
        rows: [],
        total: probeFirst === undefined ? 0 : Number(probeFirst.total),
      };
    }

    return {
      rows: await this.loadRows(
        bindings.tenantId,
        pageRows.map((row) => row.id),
      ),
      total: Number(first.total),
    };
  }

  /**
   * 本页交易 id + 总数。**过滤、金额聚合、排序、分页都在数据库层完成**。
   *
   * 排序键与方向都以参数参与 `CASE` 比较：命中的那一个排序项才有值，其余恒为 `NULL`；
   * `NULLS LAST` 让恒 `NULL` 的排序项不产生影响，等价于「按命中列排序 + `id` 稳定次级排序」，
   * 且 SQL 里没有任何拼接进来的用户输入（关键字、列名都不拼）。
   *
   * `limit` 受 `pageSize ≤ 200` 保护，保持 `::int`；`offset` 是大页码下会溢出的量，
   * 以 `bigint` 绑定并 `::bigint` 转换，绝不经过 number。
   */
  private async selectPageIds(
    bindings: FundLedgerBindings,
    limit: number,
    offset: bigint,
  ): Promise<RawPageRow[]> {
    return this.client.$queryRaw<RawPageRow[]>`
      SELECT t.id AS id, COUNT(*) OVER () AS total
      FROM (
        SELECT
          t0.id,
          t0.tx_no,
          t0.occurred_at,
          t0.confirmed_at,
          t0.created_at,
          (
            SELECT COALESCE(SUM(e.amount_fen), 0)
            FROM ledger_entries e
            WHERE e.tenant_id = t0.tenant_id
              AND e.transaction_id = t0.id
              AND e.direction = 'DEBIT'
          ) AS debit_fen
        FROM ledger_transactions t0
        WHERE t0.tenant_id = ${bindings.tenantId}::uuid
          AND (${bindings.eventType}::text IS NULL OR t0.event_type::text = ${bindings.eventType}::text)
          AND (${bindings.status}::text IS NULL OR t0.status::text = ${bindings.status}::text)
          AND (${bindings.fundAccountId}::text IS NULL OR t0.fund_account_id = ${bindings.fundAccountId}::uuid)
          AND (${bindings.sourceType}::text IS NULL OR t0.source_type = ${bindings.sourceType}::text)
          AND (${bindings.occurredFrom}::text IS NULL OR t0.occurred_at >= ${bindings.occurredFrom}::text::timestamptz)
          AND (${bindings.occurredTo}::text IS NULL OR t0.occurred_at < ${bindings.occurredTo}::text::timestamptz)
          AND (${bindings.q}::text IS NULL OR (
                strpos(lower(t0.tx_no), lower(${bindings.q}::text)) > 0
             OR strpos(lower(t0.description), lower(${bindings.q}::text)) > 0
             OR strpos(lower(t0.source_type), lower(${bindings.q}::text)) > 0
             OR strpos(lower(t0.source_id), lower(${bindings.q}::text)) > 0
             OR EXISTS (
                  SELECT 1 FROM fund_accounts fa
                  WHERE fa.tenant_id = t0.tenant_id
                    AND fa.id = t0.fund_account_id
                    AND (
                         strpos(lower(fa.code), lower(${bindings.q}::text)) > 0
                      OR strpos(lower(fa.name), lower(${bindings.q}::text)) > 0
                    )
                )
          ))
      ) t
      WHERE (${bindings.minAmountFen}::text IS NULL OR t.debit_fen >= ${bindings.minAmountFen}::text::numeric)
        AND (${bindings.maxAmountFen}::text IS NULL OR t.debit_fen <= ${bindings.maxAmountFen}::text::numeric)
      ORDER BY
        CASE WHEN ${bindings.sortBy}::text = 'txNo' AND ${bindings.sortDir}::text = 'asc' THEN t.tx_no END ASC NULLS LAST,
        CASE WHEN ${bindings.sortBy}::text = 'txNo' AND ${bindings.sortDir}::text = 'desc' THEN t.tx_no END DESC NULLS LAST,
        CASE WHEN ${bindings.sortBy}::text = 'occurredAt' AND ${bindings.sortDir}::text = 'asc' THEN t.occurred_at END ASC NULLS LAST,
        CASE WHEN ${bindings.sortBy}::text = 'occurredAt' AND ${bindings.sortDir}::text = 'desc' THEN t.occurred_at END DESC NULLS LAST,
        CASE WHEN ${bindings.sortBy}::text = 'confirmedAt' AND ${bindings.sortDir}::text = 'asc' THEN t.confirmed_at END ASC NULLS LAST,
        CASE WHEN ${bindings.sortBy}::text = 'confirmedAt' AND ${bindings.sortDir}::text = 'desc' THEN t.confirmed_at END DESC NULLS LAST,
        CASE WHEN ${bindings.sortBy}::text = 'createdAt' AND ${bindings.sortDir}::text = 'asc' THEN t.created_at END ASC NULLS LAST,
        CASE WHEN ${bindings.sortBy}::text = 'createdAt' AND ${bindings.sortDir}::text = 'desc' THEN t.created_at END DESC NULLS LAST,
        CASE WHEN ${bindings.sortBy}::text = 'amountFen' AND ${bindings.sortDir}::text = 'asc' THEN t.debit_fen END ASC NULLS LAST,
        CASE WHEN ${bindings.sortBy}::text = 'amountFen' AND ${bindings.sortDir}::text = 'desc' THEN t.debit_fen END DESC NULLS LAST,
        CASE WHEN ${bindings.sortDir}::text = 'asc' THEN t.id END ASC NULLS LAST,
        CASE WHEN ${bindings.sortDir}::text = 'desc' THEN t.id END DESC NULLS LAST
      LIMIT ${limit}::int OFFSET ${offset}::bigint
    `;
  }

  /**
   * 本页交易、其全部分录与资金账户：三次批量查询（与页大小无关，不是 N+1）。
   * 全部条件显式带 `tenantId`；字段选择最小化（不含备注、凭证、渠道敏感标识或客户隐私）。
   * 输出顺序严格照 SQL 给出的 id 次序，保证翻页顺序与数据库排序一致。
   */
  private async loadRows(
    tenantId: string,
    ids: string[],
  ): Promise<FundLedgerTransactionRow[]> {
    const transactions = await this.client.ledgerTransaction.findMany({
      where: { tenantId, id: { in: ids } },
      select: {
        id: true,
        txNo: true,
        description: true,
        sourceType: true,
        sourceId: true,
        eventType: true,
        status: true,
        fundAccountId: true,
        createdBy: true,
        confirmedBy: true,
        occurredAt: true,
        confirmedAt: true,
        createdAt: true,
      },
    });

    const entries = await this.client.ledgerEntry.findMany({
      where: { tenantId, transactionId: { in: ids } },
      select: {
        transactionId: true,
        direction: true,
        amountFen: true,
        fundAccountId: true,
        auxiliaryType: true,
        auxiliaryId: true,
      },
    });

    const accountIds = [
      ...new Set(
        transactions
          .map((transaction) => transaction.fundAccountId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const accounts =
      accountIds.length === 0
        ? []
        : await this.client.fundAccount.findMany({
            where: { tenantId, id: { in: accountIds } },
            select: {
              id: true,
              code: true,
              name: true,
              kind: true,
              status: true,
            },
          });

    const transactionById = new Map(
      transactions.map((transaction) => [transaction.id, transaction]),
    );
    const entriesByTransaction = new Map<string, FundLedgerEntryRow[]>();
    for (const entry of entries) {
      const row: FundLedgerEntryRow = {
        transactionId: entry.transactionId,
        direction: entry.direction,
        amountFen: entry.amountFen,
        fundAccountId: entry.fundAccountId,
        auxiliaryType: entry.auxiliaryType,
        auxiliaryId: entry.auxiliaryId,
      };
      const existing = entriesByTransaction.get(entry.transactionId);
      if (existing === undefined) {
        entriesByTransaction.set(entry.transactionId, [row]);
      } else {
        existing.push(row);
      }
    }
    const accountById = new Map(
      accounts.map((account) => [account.id, account]),
    );

    const rows: FundLedgerTransactionRow[] = [];
    for (const id of ids) {
      const transaction = transactionById.get(id);
      // 理论上不该缺失（同一事务里刚读到的 id）；缺了就跳过，不伪造一行假数据。
      if (transaction === undefined) continue;
      const account =
        transaction.fundAccountId === null
          ? undefined
          : accountById.get(transaction.fundAccountId);
      const fundAccount: FundLedgerFundAccountRef | null =
        account === undefined
          ? null
          : {
              id: account.id,
              code: account.code,
              name: account.name,
              kind: account.kind,
              status: account.status,
            };
      rows.push({
        id: transaction.id,
        txNo: transaction.txNo,
        description: transaction.description,
        sourceType: transaction.sourceType,
        sourceId: transaction.sourceId,
        eventType: transaction.eventType,
        status: transaction.status,
        fundAccountId: transaction.fundAccountId,
        createdBy: transaction.createdBy,
        confirmedBy: transaction.confirmedBy,
        occurredAt: transaction.occurredAt,
        confirmedAt: transaction.confirmedAt,
        createdAt: transaction.createdAt,
        entries: entriesByTransaction.get(transaction.id) ?? [],
        fundAccount,
      });
    }
    return rows;
  }
}

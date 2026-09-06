// B5：账本借贷平衡校验（只读）。
// 运行：node scripts/check-ledger-balance.mjs   （DATABASE_URL/PLATFORM_DATABASE_URL 指向被测库）
import { createDatabaseClient } from "@pw/database";

const url = process.env.PLATFORM_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("PLATFORM_DATABASE_URL/DATABASE_URL is required");
  process.exit(2);
}

const client = createDatabaseClient(url);
try {
  const rows = await client.$queryRaw`
    SELECT tenant_id, transaction_id,
           SUM(amount_fen) FILTER (WHERE direction = 'DEBIT')  AS debit,
           SUM(amount_fen) FILTER (WHERE direction = 'CREDIT') AS credit
    FROM ledger_entries
    GROUP BY tenant_id, transaction_id
    HAVING COALESCE(SUM(amount_fen) FILTER (WHERE direction = 'DEBIT'), 0)
        <> COALESCE(SUM(amount_fen) FILTER (WHERE direction = 'CREDIT'), 0)
  `;
  if (rows.length > 0) {
    console.error(`ledger unbalanced: ${rows.length} transaction(s)`);
    for (const r of rows.slice(0, 20)) {
      console.error(`tenant=${r.tenant_id} tx=${r.transaction_id} debit=${r.debit ?? 0n} credit=${r.credit ?? 0n}`);
    }
    process.exit(1);
  }
  console.log("ledger balance ok");
} finally {
  await client.$disconnect();
}
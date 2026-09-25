-- Business funds foundation. This migration is intentionally additive: existing
-- ledger rows remain valid and source/event columns stay nullable for history.

CREATE TYPE "FundAccountKind" AS ENUM ('WECHAT_SETTLEMENT', 'BANK', 'CASH', 'OFFLINE');
CREATE TYPE "FundAccountStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "LedgerEventType" AS ENUM ('ORDER_ACCOUNTING', 'PAYMENT_CONFIRMED', 'WALLET_CONSUMED', 'REFUND_CONFIRMED', 'PLAYER_PAYOUT_CONFIRMED', 'RECONCILIATION_ADJUSTMENT', 'REVERSAL');
CREATE TYPE "LedgerTransactionStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'RECONCILED', 'REVERSED');

CREATE TABLE "fund_accounts" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" "FundAccountKind" NOT NULL,
  "status" "FundAccountStatus" NOT NULL DEFAULT 'ACTIVE',
  "external_ref" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "fund_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fund_accounts_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "fund_accounts_tenant_id_code_key" ON "fund_accounts"("tenant_id", "code");
CREATE INDEX "fund_accounts_tenant_id_status_idx" ON "fund_accounts"("tenant_id", "status");

ALTER TABLE "ledger_transactions"
  ADD COLUMN "source_type" TEXT,
  ADD COLUMN "source_id" TEXT,
  ADD COLUMN "event_type" "LedgerEventType",
  ADD COLUMN "status" "LedgerTransactionStatus" NOT NULL DEFAULT 'CONFIRMED',
  ADD COLUMN "fund_account_id" UUID,
  ADD COLUMN "reversal_of_id" UUID,
  ADD COLUMN "created_by" UUID,
  ADD COLUMN "confirmed_by" UUID,
  ADD COLUMN "confirmed_at" TIMESTAMPTZ;

ALTER TABLE "ledger_entries"
  ADD COLUMN "fund_account_id" UUID,
  ADD COLUMN "auxiliary_type" TEXT,
  ADD COLUMN "auxiliary_id" TEXT;

ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_fund_account_fkey"
  FOREIGN KEY ("fund_account_id") REFERENCES "fund_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_reversal_fkey"
  FOREIGN KEY ("reversal_of_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_fund_account_fkey"
  FOREIGN KEY ("fund_account_id") REFERENCES "fund_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ledger_transactions_tenant_source_event_key"
  ON "ledger_transactions"("tenant_id", "source_type", "source_id", "event_type");
CREATE INDEX "ledger_transactions_tenant_fund_occurred_idx"
  ON "ledger_transactions"("tenant_id", "fund_account_id", "occurred_at");
CREATE INDEX "ledger_transactions_tenant_source_idx"
  ON "ledger_transactions"("tenant_id", "source_type", "source_id");
CREATE INDEX "ledger_entries_tenant_fund_created_idx"
  ON "ledger_entries"("tenant_id", "fund_account_id", "created_at");
CREATE INDEX "ledger_entries_tenant_auxiliary_idx"
  ON "ledger_entries"("tenant_id", "auxiliary_type", "auxiliary_id");

ALTER TABLE "fund_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fund_accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_platform ON "fund_accounts" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_runtime ON "fund_accounts" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

-- Slice 8：核算、账本与陪玩结算
CREATE TYPE "Direction" AS ENUM ('DEBIT','CREDIT');
CREATE TYPE "EarningStatus" AS ENUM ('PENDING','BATCHED','PAID');
CREATE TYPE "BatchStatus" AS ENUM ('DRAFT','REVIEWED','APPROVED','PAID','VOID');

CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id"));
CREATE TABLE "ledger_transactions" (
    "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "tx_no" TEXT NOT NULL, "description" TEXT,
    "occurred_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id"));
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "transaction_id" UUID NOT NULL, "account_id" UUID NOT NULL,
    "direction" "Direction" NOT NULL, "amount_fen" BIGINT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id"));
CREATE TABLE "earnings" (
    "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "player_id" UUID NOT NULL, "order_id" UUID NOT NULL,
    "amount_fen" BIGINT NOT NULL, "status" "EarningStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "earnings_pkey" PRIMARY KEY ("id"));
CREATE TABLE "settlement_batches" (
    "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "batch_no" TEXT NOT NULL, "status" "BatchStatus" NOT NULL DEFAULT 'DRAFT',
    "total_amount_fen" BIGINT NOT NULL, "created_by" UUID, "reviewed_by" UUID, "approved_by" UUID, "paid_by" UUID, "remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "settlement_batches_pkey" PRIMARY KEY ("id"));
CREATE TABLE "settlement_items" (
    "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "batch_id" UUID NOT NULL, "earning_id" UUID NOT NULL,
    "amount_fen" BIGINT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "settlement_items_pkey" PRIMARY KEY ("id"));
CREATE TABLE "manual_payment_records" (
    "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "batch_id" UUID NOT NULL, "amount_fen" BIGINT NOT NULL,
    "paid_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, "channel" TEXT NOT NULL DEFAULT 'OFFLINE',
    "operator_id" UUID, "note" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "manual_payment_records_pkey" PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "ledger_accounts_tenant_id_code_key" ON "ledger_accounts"("tenant_id","code");
CREATE UNIQUE INDEX "ledger_transactions_tenant_id_tx_no_key" ON "ledger_transactions"("tenant_id","tx_no");
CREATE INDEX "ledger_transactions_tenant_id_occurred_at_idx" ON "ledger_transactions"("tenant_id","occurred_at");
CREATE INDEX "ledger_entries_tenant_id_transaction_id_idx" ON "ledger_entries"("tenant_id","transaction_id");
CREATE INDEX "ledger_entries_tenant_id_account_id_idx" ON "ledger_entries"("tenant_id","account_id");
CREATE UNIQUE INDEX "earnings_tenant_id_order_id_key" ON "earnings"("tenant_id","order_id");
CREATE INDEX "earnings_tenant_id_player_id_status_idx" ON "earnings"("tenant_id","player_id","status");
CREATE UNIQUE INDEX "settlement_batches_tenant_id_batch_no_key" ON "settlement_batches"("tenant_id","batch_no");
CREATE INDEX "settlement_batches_tenant_id_status_created_at_idx" ON "settlement_batches"("tenant_id","status","created_at");
CREATE UNIQUE INDEX "settlement_items_tenant_id_batch_id_earning_id_key" ON "settlement_items"("tenant_id","batch_id","earning_id");
CREATE INDEX "settlement_items_tenant_id_earning_id_idx" ON "settlement_items"("tenant_id","earning_id");
CREATE INDEX "settlement_items_tenant_id_batch_id_idx" ON "settlement_items"("tenant_id","batch_id");
CREATE INDEX "manual_payment_records_tenant_id_batch_id_idx" ON "manual_payment_records"("tenant_id","batch_id");

ALTER TABLE "ledger_accounts" ADD CONSTRAINT "la_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "lt_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "le_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "le_tx_fkey" FOREIGN KEY ("transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "le_account_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "earnings" ADD CONSTRAINT "e_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "earnings" ADD CONSTRAINT "e_player_fkey" FOREIGN KEY ("player_id") REFERENCES "player_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "earnings" ADD CONSTRAINT "e_order_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlement_batches" ADD CONSTRAINT "sb_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlement_items" ADD CONSTRAINT "si_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlement_items" ADD CONSTRAINT "si_batch_fkey" FOREIGN KEY ("batch_id") REFERENCES "settlement_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlement_items" ADD CONSTRAINT "si_earning_fkey" FOREIGN KEY ("earning_id") REFERENCES "earnings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_payment_records" ADD CONSTRAINT "mp_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_payment_records" ADD CONSTRAINT "mp_batch_fkey" FOREIGN KEY ("batch_id") REFERENCES "settlement_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ledger_entries" ADD CONSTRAINT "le_amount_check" CHECK ("amount_fen" > 0);
ALTER TABLE "earnings" ADD CONSTRAINT "e_amount_check" CHECK ("amount_fen" > 0);
ALTER TABLE "settlement_batches" ADD CONSTRAINT "sb_total_check" CHECK ("total_amount_fen" >= 0);
ALTER TABLE "settlement_items" ADD CONSTRAINT "si_amount_check" CHECK ("amount_fen" > 0);
ALTER TABLE "manual_payment_records" ADD CONSTRAINT "mp_amount_check" CHECK ("amount_fen" > 0);

ALTER TABLE "ledger_accounts" ENABLE ROW LEVEL SECURITY; ALTER TABLE "ledger_accounts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ledger_transactions" ENABLE ROW LEVEL SECURITY; ALTER TABLE "ledger_transactions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ledger_entries" ENABLE ROW LEVEL SECURITY; ALTER TABLE "ledger_entries" FORCE ROW LEVEL SECURITY;
ALTER TABLE "earnings" ENABLE ROW LEVEL SECURITY; ALTER TABLE "earnings" FORCE ROW LEVEL SECURITY;
ALTER TABLE "settlement_batches" ENABLE ROW LEVEL SECURITY; ALTER TABLE "settlement_batches" FORCE ROW LEVEL SECURITY;
ALTER TABLE "settlement_items" ENABLE ROW LEVEL SECURITY; ALTER TABLE "settlement_items" FORCE ROW LEVEL SECURITY;
ALTER TABLE "manual_payment_records" ENABLE ROW LEVEL SECURITY; ALTER TABLE "manual_payment_records" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_platform ON "ledger_accounts" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "ledger_transactions" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "ledger_entries" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "earnings" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "settlement_batches" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "settlement_items" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "manual_payment_records" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_runtime ON "ledger_accounts" FOR ALL TO pw_runtime USING (tenant_id::text=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id::text=current_setting('app.tenant_id',true));
CREATE POLICY tenant_isolation_runtime ON "ledger_transactions" FOR ALL TO pw_runtime USING (tenant_id::text=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id::text=current_setting('app.tenant_id',true));
CREATE POLICY tenant_isolation_runtime ON "ledger_entries" FOR ALL TO pw_runtime USING (tenant_id::text=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id::text=current_setting('app.tenant_id',true));
CREATE POLICY tenant_isolation_runtime ON "earnings" FOR ALL TO pw_runtime USING (tenant_id::text=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id::text=current_setting('app.tenant_id',true));
CREATE POLICY tenant_isolation_runtime ON "settlement_batches" FOR ALL TO pw_runtime USING (tenant_id::text=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id::text=current_setting('app.tenant_id',true));
CREATE POLICY tenant_isolation_runtime ON "settlement_items" FOR ALL TO pw_runtime USING (tenant_id::text=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id::text=current_setting('app.tenant_id',true));
CREATE POLICY tenant_isolation_runtime ON "manual_payment_records" FOR ALL TO pw_runtime USING (tenant_id::text=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id::text=current_setting('app.tenant_id',true));
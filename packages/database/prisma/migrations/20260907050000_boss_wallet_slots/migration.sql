-- Block2 P1：老板钱包 / 模拟支付 / 档位场次与结算（只新增表）。
CREATE TABLE "boss_wallets" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "customer_profile_id" UUID NOT NULL,
  "boss_no" TEXT NOT NULL,
  "balance_fen" BIGINT NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "boss_wallets_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "wallet_entries" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "customer_profile_id" UUID NOT NULL,
  "wallet_id" UUID NOT NULL,
  "tx_no" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "amount_fen" BIGINT NOT NULL,
  "balance_after_fen" BIGINT NOT NULL,
  "reference_type" TEXT,
  "reference_id" TEXT,
  "reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wallet_entries_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "payment_orders" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "customer_profile_id" UUID NOT NULL,
  "out_no" TEXT NOT NULL,
  "amount_fen" BIGINT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'mock',
  "provider_ref" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "slot_sessions" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "order_slot_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "player_id" UUID NOT NULL,
  "started_at" TIMESTAMP(3) WITH TIME ZONE,
  "ended_at" TIMESTAMP(3) WITH TIME ZONE,
  "duration_seconds" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "slot_sessions_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "slot_evidence" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "order_slot_id" UUID NOT NULL,
  "object_key" TEXT NOT NULL,
  "original_name" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "evidence_type" TEXT NOT NULL,
  "uploaded_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "slot_evidence_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "slot_earnings" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "order_slot_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "player_id" UUID NOT NULL,
  "amount_fen" BIGINT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "detail_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "slot_earnings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "boss_wallets_tenant_customer_key"
  ON "boss_wallets"("tenant_id", "customer_profile_id");
CREATE UNIQUE INDEX "boss_wallets_tenant_boss_no_key"
  ON "boss_wallets"("tenant_id", "boss_no");
CREATE UNIQUE INDEX "wallet_entries_tenant_tx_no_key"
  ON "wallet_entries"("tenant_id", "tx_no");
CREATE INDEX "wallet_entries_tenant_customer_created_idx"
  ON "wallet_entries"("tenant_id", "customer_profile_id", "created_at");
CREATE INDEX "wallet_entries_tenant_ref_idx"
  ON "wallet_entries"("tenant_id", "reference_type", "reference_id");
CREATE UNIQUE INDEX "payment_orders_tenant_out_no_key"
  ON "payment_orders"("tenant_id", "out_no");
CREATE INDEX "payment_orders_tenant_customer_status_idx"
  ON "payment_orders"("tenant_id", "customer_profile_id", "status");
CREATE UNIQUE INDEX "slot_sessions_tenant_order_slot_key"
  ON "slot_sessions"("tenant_id", "order_slot_id");
CREATE INDEX "slot_sessions_tenant_order_idx"
  ON "slot_sessions"("tenant_id", "order_id");
CREATE INDEX "slot_sessions_tenant_player_status_idx"
  ON "slot_sessions"("tenant_id", "player_id", "status");
CREATE UNIQUE INDEX "slot_evidence_object_key_key"
  ON "slot_evidence"("object_key");
CREATE INDEX "slot_evidence_tenant_session_idx"
  ON "slot_evidence"("tenant_id", "session_id");
CREATE INDEX "slot_evidence_tenant_slot_idx"
  ON "slot_evidence"("tenant_id", "order_slot_id");
CREATE UNIQUE INDEX "slot_earnings_tenant_order_slot_key"
  ON "slot_earnings"("tenant_id", "order_slot_id");
CREATE INDEX "slot_earnings_tenant_order_idx"
  ON "slot_earnings"("tenant_id", "order_id");
CREATE INDEX "slot_earnings_tenant_player_status_idx"
  ON "slot_earnings"("tenant_id", "player_id", "status");

ALTER TABLE "boss_wallets" ADD CONSTRAINT "boss_wallets_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "boss_wallets" ADD CONSTRAINT "boss_wallets_customer_fkey"
  FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "slot_sessions" ADD CONSTRAINT "slot_sessions_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "slot_evidence" ADD CONSTRAINT "slot_evidence_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "slot_earnings" ADD CONSTRAINT "slot_earnings_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "boss_wallets" ADD CONSTRAINT "boss_wallets_balance_non_negative"
  CHECK ("balance_fen" >= 0);
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_amount_positive"
  CHECK ("amount_fen" > 0);
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_balance_non_negative"
  CHECK ("balance_after_fen" >= 0);
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_amount_positive"
  CHECK ("amount_fen" > 0);
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_status_check"
  CHECK ("status" IN ('PENDING', 'SUCCESS', 'FAILED'));
ALTER TABLE "slot_sessions" ADD CONSTRAINT "slot_sessions_status_check"
  CHECK ("status" IN ('NOT_STARTED', 'STARTED', 'ENDED'));
ALTER TABLE "slot_sessions" ADD CONSTRAINT "slot_sessions_duration_positive"
  CHECK ("duration_seconds" IS NULL OR "duration_seconds" >= 0);
ALTER TABLE "slot_evidence" ADD CONSTRAINT "slot_evidence_size_positive"
  CHECK ("size_bytes" > 0);
ALTER TABLE "slot_evidence" ADD CONSTRAINT "slot_evidence_type_check"
  CHECK ("evidence_type" IN ('START', 'END'));
ALTER TABLE "slot_earnings" ADD CONSTRAINT "slot_earnings_amount_positive"
  CHECK ("amount_fen" >= 0);

ALTER TABLE "boss_wallets" ENABLE ROW LEVEL SECURITY; ALTER TABLE "boss_wallets" FORCE ROW LEVEL SECURITY;
ALTER TABLE "wallet_entries" ENABLE ROW LEVEL SECURITY; ALTER TABLE "wallet_entries" FORCE ROW LEVEL SECURITY;
ALTER TABLE "payment_orders" ENABLE ROW LEVEL SECURITY; ALTER TABLE "payment_orders" FORCE ROW LEVEL SECURITY;
ALTER TABLE "slot_sessions" ENABLE ROW LEVEL SECURITY; ALTER TABLE "slot_sessions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "slot_evidence" ENABLE ROW LEVEL SECURITY; ALTER TABLE "slot_evidence" FORCE ROW LEVEL SECURITY;
ALTER TABLE "slot_earnings" ENABLE ROW LEVEL SECURITY; ALTER TABLE "slot_earnings" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_platform ON "boss_wallets" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "wallet_entries" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "payment_orders" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "slot_sessions" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "slot_evidence" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "slot_earnings" FOR ALL TO pw USING (true) WITH CHECK (true);

CREATE POLICY tenant_isolation_runtime ON "boss_wallets" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "wallet_entries" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "payment_orders" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "slot_sessions" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "slot_evidence" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "slot_earnings" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

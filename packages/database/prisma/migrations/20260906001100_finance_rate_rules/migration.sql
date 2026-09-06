CREATE TABLE "finance_rate_rules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "platform_fee_bp" INTEGER NOT NULL DEFAULT 300,
    "store_cut_bp" INTEGER NOT NULL DEFAULT 2000,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "finance_rate_rules_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "finance_rate_rules_tenant_id_key" ON "finance_rate_rules"("tenant_id");
ALTER TABLE "finance_rate_rules" ADD CONSTRAINT "fr_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "finance_rate_rules" ADD CONSTRAINT "fr_bp_check" CHECK ("platform_fee_bp" >= 0 AND "store_cut_bp" >= 0 AND "platform_fee_bp" + "store_cut_bp" <= 10000);
ALTER TABLE "finance_rate_rules" ENABLE ROW LEVEL SECURITY; ALTER TABLE "finance_rate_rules" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_platform ON "finance_rate_rules" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_runtime ON "finance_rate_rules" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
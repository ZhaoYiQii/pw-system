CREATE TABLE "ai_runs" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "run_type" TEXT NOT NULL, "provider" TEXT NOT NULL DEFAULT 'deterministic',
  "model_version" TEXT NOT NULL, "prompt_version" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'SUCCESS',
  "requested_by" UUID, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id"));
CREATE TABLE "ai_suggestions" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "run_id" UUID NOT NULL, "suggestion_type" TEXT NOT NULL,
  "payload" JSONB NOT NULL, "confidence_bp" INTEGER NOT NULL, "status" TEXT NOT NULL DEFAULT 'SUGGESTED',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ai_suggestions_pkey" PRIMARY KEY ("id"));
CREATE INDEX "ai_runs_tenant_id_created_at_idx" ON "ai_runs"("tenant_id","created_at");
CREATE INDEX "ai_suggestions_tenant_id_run_id_idx" ON "ai_suggestions"("tenant_id","run_id");
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ais_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ais_run_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ais_conf_check" CHECK ("confidence_bp" >= 0 AND "confidence_bp" <= 10000);
ALTER TABLE "ai_runs" ENABLE ROW LEVEL SECURITY; ALTER TABLE "ai_runs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ai_suggestions" ENABLE ROW LEVEL SECURITY; ALTER TABLE "ai_suggestions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_platform ON "ai_runs" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "ai_suggestions" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_runtime ON "ai_runs" FOR ALL TO pw_runtime USING (tenant_id::text=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id::text=current_setting('app.tenant_id',true));
CREATE POLICY tenant_isolation_runtime ON "ai_suggestions" FOR ALL TO pw_runtime USING (tenant_id::text=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id::text=current_setting('app.tenant_id',true));
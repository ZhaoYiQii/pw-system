CREATE TABLE "tenant_subscriptions" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "package_code" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "starts_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, "ends_at" TIMESTAMP(3) WITH TIME ZONE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "tenant_subscriptions_pkey" PRIMARY KEY ("id"));
CREATE INDEX "tenant_subscriptions_tenant_id_status_idx" ON "tenant_subscriptions"("tenant_id","status");
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "ts_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tenant_subscriptions" ENABLE ROW LEVEL SECURITY; ALTER TABLE "tenant_subscriptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_platform ON "tenant_subscriptions" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_runtime ON "tenant_subscriptions" FOR ALL TO pw_runtime
  USING (tenant_id::text=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id::text=current_setting('app.tenant_id',true));
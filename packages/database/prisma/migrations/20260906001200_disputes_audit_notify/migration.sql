CREATE TYPE "DisputeStatus" AS ENUM ('OPEN','RESOLVED');

CREATE TABLE "disputes" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "order_id" UUID NOT NULL, "earning_id" UUID, "player_id" UUID NOT NULL,
  "customer_profile_id" UUID NOT NULL, "reason" TEXT NOT NULL, "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
  "opened_by" UUID, "resolved_by" UUID, "resolution" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "disputes_pkey" PRIMARY KEY ("id"));
CREATE TABLE "dispute_events" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "dispute_id" UUID NOT NULL, "event_type" TEXT NOT NULL,
  "from_status" TEXT, "to_status" TEXT, "actor_type" TEXT, "actor_id" UUID, "payload" JSONB NOT NULL DEFAULT '{}',
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "dispute_events_pkey" PRIMARY KEY ("id"));
CREATE TABLE "audit_logs" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "actor_type" TEXT, "actor_id" UUID, "action" TEXT NOT NULL,
  "resource_type" TEXT, "resource_id" TEXT, "summary" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id"));
CREATE TABLE "notification_deliveries" (
  "id" UUID NOT NULL, "tenant_id" UUID, "recipient_type" TEXT, "recipient_id" TEXT, "channel" TEXT NOT NULL,
  "title" TEXT, "content" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_retry_at" TIMESTAMP(3) WITH TIME ZONE, "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id"));

CREATE INDEX "disputes_tenant_id_earning_id_status_idx" ON "disputes"("tenant_id","earning_id","status");
CREATE INDEX "disputes_tenant_id_order_id_idx" ON "disputes"("tenant_id","order_id");
CREATE INDEX "dispute_events_tenant_id_dispute_id_occurred_at_idx" ON "dispute_events"("tenant_id","dispute_id","occurred_at");
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id","created_at");
CREATE INDEX "notification_deliveries_status_next_retry_at_idx" ON "notification_deliveries"("status","next_retry_at");

ALTER TABLE "disputes" ADD CONSTRAINT "d_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "disputes" ADD CONSTRAINT "d_order_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "disputes" ADD CONSTRAINT "d_player_fkey" FOREIGN KEY ("player_id") REFERENCES "player_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_events" ADD CONSTRAINT "de_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_events" ADD CONSTRAINT "de_dispute_fkey" FOREIGN KEY ("dispute_id") REFERENCES "disputes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "al_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "disputes" ENABLE ROW LEVEL SECURITY; ALTER TABLE "disputes" FORCE ROW LEVEL SECURITY;
ALTER TABLE "dispute_events" ENABLE ROW LEVEL SECURITY; ALTER TABLE "dispute_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY; ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "notification_deliveries" ENABLE ROW LEVEL SECURITY; ALTER TABLE "notification_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_platform ON "disputes" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "dispute_events" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "audit_logs" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "notification_deliveries" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_runtime ON "disputes" FOR ALL TO pw_runtime USING (tenant_id::text=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id::text=current_setting('app.tenant_id',true));
CREATE POLICY tenant_isolation_runtime ON "dispute_events" FOR ALL TO pw_runtime USING (tenant_id::text=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id::text=current_setting('app.tenant_id',true));
CREATE POLICY tenant_isolation_runtime ON "audit_logs" FOR ALL TO pw_runtime USING (tenant_id::text=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id::text=current_setting('app.tenant_id',true));
CREATE POLICY tenant_isolation_runtime ON "notification_deliveries" FOR ALL TO pw_runtime
  USING (tenant_id IS NULL OR tenant_id::text=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id IS NULL OR tenant_id::text=current_setting('app.tenant_id',true));
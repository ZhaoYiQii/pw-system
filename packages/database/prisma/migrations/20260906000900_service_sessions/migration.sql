-- Slice 7：服务场次与证据（主规格 10.3/14.1）
CREATE TYPE "SessionStatus" AS ENUM ('SCHEDULED','STARTED','ENDED','CONFIRMED','ADJUSTMENT_PENDING');
CREATE TYPE "AdjustmentStatus" AS ENUM ('PENDING','APPROVED','REJECTED');

CREATE TABLE "service_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "assignment_id" UUID,
    "scheduled_start_at" TIMESTAMP(3) WITH TIME ZONE,
    "started_at" TIMESTAMP(3) WITH TIME ZONE,
    "ended_at" TIMESTAMP(3) WITH TIME ZONE,
    "duration_seconds" INTEGER,
    "status" "SessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "service_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "session_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT,
    "actor_type" TEXT,
    "actor_id" UUID,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "session_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "session_adjustments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "original_duration_seconds" INTEGER NOT NULL,
    "requested_duration_seconds" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "AdjustmentStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by" UUID,
    "reviewed_by" UUID,
    "review_comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "session_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "evidence_assets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploaded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "evidence_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_sessions_tenant_id_order_id_key" ON "service_sessions"("tenant_id", "order_id");
CREATE INDEX "service_sessions_tenant_id_player_id_status_idx" ON "service_sessions"("tenant_id", "player_id", "status");
CREATE INDEX "session_events_tenant_id_session_id_occurred_at_idx" ON "session_events"("tenant_id", "session_id", "occurred_at");
CREATE INDEX "session_adjustments_tenant_id_session_id_status_idx" ON "session_adjustments"("tenant_id", "session_id", "status");
CREATE UNIQUE INDEX "evidence_assets_object_key_key" ON "evidence_assets"("object_key");
CREATE INDEX "evidence_assets_tenant_id_session_id_idx" ON "evidence_assets"("tenant_id", "session_id");

ALTER TABLE "service_sessions" ADD CONSTRAINT "sessions_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_sessions" ADD CONSTRAINT "sessions_order_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_sessions" ADD CONSTRAINT "sessions_player_fkey" FOREIGN KEY ("player_id") REFERENCES "player_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "session_events" ADD CONSTRAINT "sevents_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "session_events" ADD CONSTRAINT "sevents_session_fkey" FOREIGN KEY ("session_id") REFERENCES "service_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "session_adjustments" ADD CONSTRAINT "sadj_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "session_adjustments" ADD CONSTRAINT "sadj_session_fkey" FOREIGN KEY ("session_id") REFERENCES "service_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evidence_assets" ADD CONSTRAINT "ev_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evidence_assets" ADD CONSTRAINT "ev_session_fkey" FOREIGN KEY ("session_id") REFERENCES "service_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "service_sessions" ADD CONSTRAINT "sessions_duration_check" CHECK ("duration_seconds" IS NULL OR "duration_seconds" >= 0);
ALTER TABLE "session_adjustments" ADD CONSTRAINT "sadj_duration_check" CHECK ("requested_duration_seconds" > 0 AND "original_duration_seconds" >= 0);

ALTER TABLE "service_sessions" ENABLE ROW LEVEL SECURITY; ALTER TABLE "service_sessions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "session_events" ENABLE ROW LEVEL SECURITY; ALTER TABLE "session_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "session_adjustments" ENABLE ROW LEVEL SECURITY; ALTER TABLE "session_adjustments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "evidence_assets" ENABLE ROW LEVEL SECURITY; ALTER TABLE "evidence_assets" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_platform ON "service_sessions" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "session_events" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "session_adjustments" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "evidence_assets" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_runtime ON "service_sessions" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "session_events" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "session_adjustments" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "evidence_assets" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
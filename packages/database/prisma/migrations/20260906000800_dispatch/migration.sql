-- Slice 6：派单、报名、候选与选人（主规格 10.2/11.3）
CREATE TYPE "ApplicationStatus" AS ENUM ('APPLIED','SHORTLISTED','SELECTED','WITHDRAWN','REJECTED','EXPIRED');
CREATE TYPE "PublicationStatus" AS ENUM ('OPEN','CLOSED');

CREATE TABLE "dispatch_publications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'OPEN',
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3) WITH TIME ZONE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "dispatch_publications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "applications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'APPLIED',
    "player_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "assignments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "application_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dispatch_publications_tenant_id_order_id_key" ON "dispatch_publications"("tenant_id", "order_id");
CREATE INDEX "dispatch_publications_tenant_id_status_published_at_idx" ON "dispatch_publications"("tenant_id", "status", "published_at");
CREATE UNIQUE INDEX "applications_tenant_id_order_id_player_id_key" ON "applications"("tenant_id", "order_id", "player_id");
CREATE INDEX "applications_tenant_id_order_id_status_idx" ON "applications"("tenant_id", "order_id", "status");
CREATE INDEX "applications_tenant_id_player_id_status_idx" ON "applications"("tenant_id", "player_id", "status");
CREATE UNIQUE INDEX "assignments_tenant_id_order_id_key" ON "assignments"("tenant_id", "order_id");
CREATE UNIQUE INDEX "assignments_tenant_id_application_id_key" ON "assignments"("tenant_id", "application_id");
CREATE INDEX "assignments_tenant_id_player_id_idx" ON "assignments"("tenant_id", "player_id");

ALTER TABLE "dispatch_publications" ADD CONSTRAINT "pub_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispatch_publications" ADD CONSTRAINT "pub_order_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "applications" ADD CONSTRAINT "app_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "applications" ADD CONSTRAINT "app_order_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "applications" ADD CONSTRAINT "app_player_fkey" FOREIGN KEY ("player_id") REFERENCES "player_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assignments" ADD CONSTRAINT "assign_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assignments" ADD CONSTRAINT "assign_order_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assignments" ADD CONSTRAINT "assign_player_fkey" FOREIGN KEY ("player_id") REFERENCES "player_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assignments" ADD CONSTRAINT "assign_application_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS 租户级
ALTER TABLE "dispatch_publications" ENABLE ROW LEVEL SECURITY; ALTER TABLE "dispatch_publications" FORCE ROW LEVEL SECURITY;
ALTER TABLE "applications" ENABLE ROW LEVEL SECURITY; ALTER TABLE "applications" FORCE ROW LEVEL SECURITY;
ALTER TABLE "assignments" ENABLE ROW LEVEL SECURITY; ALTER TABLE "assignments" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_platform ON "dispatch_publications" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "applications" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "assignments" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_runtime ON "dispatch_publications" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "applications" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "assignments" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
-- CreateEnum
CREATE TYPE "ConfigVersionStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'CONFIG_ERROR');

-- CreateTable
CREATE TABLE "tenant_config_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "status" "ConfigVersionStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tenant_config_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_entitlements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "feature_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'platform',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "tenant_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_config_versions_tenant_id_status_idx" ON "tenant_config_versions"("tenant_id", "status");
CREATE UNIQUE INDEX "tenant_config_versions_tenant_id_version_key" ON "tenant_config_versions"("tenant_id", "version");
CREATE INDEX "tenant_entitlements_tenant_id_idx" ON "tenant_entitlements"("tenant_id");
CREATE UNIQUE INDEX "tenant_entitlements_tenant_id_feature_key_key" ON "tenant_entitlements"("tenant_id", "feature_key");

-- AddForeignKey
ALTER TABLE "tenant_config_versions" ADD CONSTRAINT "tenant_config_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tenant_entitlements" ADD CONSTRAINT "tenant_entitlements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== Slice 3 追加：RLS（租户级）=====
ALTER TABLE "tenant_config_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_config_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_entitlements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_entitlements" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_platform ON "tenant_config_versions" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "tenant_entitlements" FOR ALL TO pw USING (true) WITH CHECK (true);

CREATE POLICY tenant_isolation_runtime ON "tenant_config_versions" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "tenant_entitlements" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));


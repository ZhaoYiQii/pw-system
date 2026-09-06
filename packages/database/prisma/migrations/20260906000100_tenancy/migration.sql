-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'CONFIG_ERROR');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_domains" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "host" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "tenant_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_app_bindings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "app_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "tenant_app_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_code_key" ON "tenants"("code");

-- CreateIndex
CREATE INDEX "tenant_domains_tenant_id_idx" ON "tenant_domains"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_domains_tenant_id_host_key" ON "tenant_domains"("tenant_id", "host");

-- CreateIndex
CREATE INDEX "tenant_app_bindings_tenant_id_idx" ON "tenant_app_bindings"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_app_bindings_app_id_key" ON "tenant_app_bindings"("app_id");

-- AddForeignKey
ALTER TABLE "tenant_domains" ADD CONSTRAINT "tenant_domains_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_app_bindings" ADD CONSTRAINT "tenant_app_bindings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== Slice 1 追加：运行时角色 + RLS =====
-- 主规格 8.2：运行时角色非表 owner、无 BYPASSRLS；对租户表启用并强制 RLS；无匹配 policy 默认拒绝。
-- 角色为集群级，使用 DO 幂等创建；策略/授权为库级，随每个库的迁移执行。

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pw_runtime') THEN
    CREATE ROLE pw_runtime LOGIN PASSWORD 'pw_runtime_dev_only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- 授权：运行时角色可读平台注册表（tenants，供 host/短码解析），并可读写租户级表。
GRANT USAGE ON SCHEMA public TO pw_runtime;
GRANT SELECT ON TABLE "tenants" TO pw_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "tenant_domains", "tenant_app_bindings" TO pw_runtime;

-- 迁移角色（pw，owner）后续创建的表默认授权给运行时角色。
ALTER DEFAULT PRIVILEGES FOR ROLE pw IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pw_runtime;

-- 租户级表：启用 + 强制 RLS
ALTER TABLE "tenant_domains" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_domains" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_app_bindings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_app_bindings" FORCE ROW LEVEL SECURITY;

-- 迁移/owner 角色策略：允许平台运维（迁移）读写全部租户行；仍受 FORCE RLS 约束（显式策略，非静默绕过）。
CREATE POLICY tenant_isolation_platform ON "tenant_domains"
  FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "tenant_app_bindings"
  FOR ALL TO pw USING (true) WITH CHECK (true);

-- 运行时角色策略：tenant_id 必须等于事务内 SET LOCAL app.tenant_id；未设置时返回 '' 故默认拒绝。
CREATE POLICY tenant_isolation_runtime ON "tenant_domains"
  FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "tenant_app_bindings"
  FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

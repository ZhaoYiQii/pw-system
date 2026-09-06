-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "RoleKey" AS ENUM ('PLATFORM_SUPER_ADMIN', 'PLATFORM_SUPPORT', 'TENANT_OWNER', 'TENANT_ADMIN', 'CUSTOMER_SERVICE', 'FINANCE', 'PLAYER', 'CUSTOMER');

-- CreateTable
CREATE TABLE "platform_accounts" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "role" "RoleKey" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "platform_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_accounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "tenant_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_account_roles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "tenant_account_id" UUID NOT NULL,
    "role" "RoleKey" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tenant_account_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_sessions" (
    "id" UUID NOT NULL,
    "subject_type" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "tenant_id" UUID,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_accounts_username_key" ON "platform_accounts"("username");
CREATE INDEX "tenant_accounts_tenant_id_idx" ON "tenant_accounts"("tenant_id");
CREATE UNIQUE INDEX "tenant_accounts_tenant_id_username_key" ON "tenant_accounts"("tenant_id", "username");
CREATE INDEX "tenant_account_roles_tenant_account_id_idx" ON "tenant_account_roles"("tenant_account_id");
CREATE UNIQUE INDEX "tenant_account_roles_tenant_id_tenant_account_id_role_key" ON "tenant_account_roles"("tenant_id", "tenant_account_id", "role");
CREATE UNIQUE INDEX "refresh_sessions_token_hash_key" ON "refresh_sessions"("token_hash");
CREATE INDEX "refresh_sessions_subject_type_account_id_idx" ON "refresh_sessions"("subject_type", "account_id");
CREATE INDEX "refresh_sessions_expires_at_idx" ON "refresh_sessions"("expires_at");

-- AddForeignKey
ALTER TABLE "tenant_accounts" ADD CONSTRAINT "tenant_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tenant_account_roles" ADD CONSTRAINT "tenant_account_roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tenant_account_roles" ADD CONSTRAINT "tenant_account_roles_tenant_account_id_fkey" FOREIGN KEY ("tenant_account_id") REFERENCES "tenant_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===== Slice 2 追加：RLS 与授权 =====
ALTER TABLE "tenant_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_accounts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_account_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_account_roles" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_platform ON "tenant_accounts" FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_platform ON "tenant_account_roles" FOR ALL TO pw USING (true) WITH CHECK (true);

CREATE POLICY tenant_isolation_runtime ON "tenant_accounts" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation_runtime ON "tenant_account_roles" FOR ALL TO pw_runtime
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

-- 平台账号表不允许运行时角色访问（平台操作走平台/owner 连接串）
REVOKE ALL ON TABLE "platform_accounts" FROM pw_runtime;


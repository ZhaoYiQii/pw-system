-- P-B2b-1：平台跨租户临时授权（support 无授权时禁止读取目标门店明细/审计）
CREATE TYPE "PlatformGrantStatus" AS ENUM ('ACTIVE', 'REVOKED');

CREATE TABLE "platform_access_grants" (
    "id" UUID NOT NULL,
    "grantor_platform_account_id" UUID NOT NULL,
    "grantee_platform_account_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'read',
    "status" "PlatformGrantStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_access_grants_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "platform_access_grants_grantee_status_idx"
    ON "platform_access_grants"("grantee_platform_account_id", "status");
CREATE INDEX "platform_access_grants_tenant_status_idx"
    ON "platform_access_grants"("tenant_id", "status");
CREATE INDEX "platform_access_grants_expires_idx"
    ON "platform_access_grants"("expires_at");

ALTER TABLE "platform_access_grants"
    ADD CONSTRAINT "platform_access_grants_grantor_fkey"
    FOREIGN KEY ("grantor_platform_account_id") REFERENCES "platform_accounts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "platform_access_grants"
    ADD CONSTRAINT "platform_access_grants_grantee_fkey"
    FOREIGN KEY ("grantee_platform_account_id") REFERENCES "platform_accounts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- 平台级表：运行时租户角色无权访问
REVOKE ALL ON TABLE "platform_access_grants" FROM pw_runtime;

-- P-1：门店账号手机号字段（加密存储 + 租户内查询哈希）
ALTER TABLE "tenant_accounts"
    ADD COLUMN "phone_enc" TEXT,
    ADD COLUMN "phone_hash" TEXT;

CREATE UNIQUE INDEX "tenant_accounts_tenant_id_phone_hash_key"
    ON "tenant_accounts"("tenant_id", "phone_hash");

-- P-1：短信验证码（只保存哈希与脱敏尾号）
CREATE TABLE "phone_verification_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "phone_hash" TEXT NOT NULL,
    "phone_tail" TEXT NOT NULL,
    "scene" TEXT NOT NULL DEFAULT 'register_login',
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "phone_verification_codes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "phone_verification_codes_tenant_phone_time_idx"
    ON "phone_verification_codes"("tenant_id", "phone_hash", "created_at");

ALTER TABLE "phone_verification_codes"
    ADD CONSTRAINT "phone_verification_codes_tenant_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

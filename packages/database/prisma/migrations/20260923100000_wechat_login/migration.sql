-- S3：微信网页授权（openid 落库 + 一次性票据表）
--
-- 1) tenant_accounts 加 openid：公众号身份键，按租户唯一。
--    PG 的唯一索引允许多个 NULL，所以「没绑微信的账号」不受影响。
ALTER TABLE "tenant_accounts" ADD COLUMN "wechat_openid" TEXT;

CREATE UNIQUE INDEX "tenant_accounts_tenant_id_wechat_openid_key"
    ON "tenant_accounts"("tenant_id", "wechat_openid");

-- 2) 首次微信登录的中间态票据（已授权拿到 openid、但还没绑手机号）
CREATE TABLE "wechat_login_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "openid" TEXT NOT NULL,
    "ticket_hash" TEXT NOT NULL,
    "return_to" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_PHONE',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "wechat_login_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wechat_login_requests_ticket_hash_key"
    ON "wechat_login_requests"("ticket_hash");
CREATE INDEX "wechat_login_requests_tenant_openid_time_idx"
    ON "wechat_login_requests"("tenant_id", "openid", "created_at");
CREATE INDEX "wechat_login_requests_expires_at_idx"
    ON "wechat_login_requests"("expires_at");

ALTER TABLE "wechat_login_requests"
    ADD CONSTRAINT "wechat_login_requests_tenant_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3) 租户级表：启用 + 强制 RLS，并写两条策略（口径照 20260906000100_tenancy）。
--    显式 GRANT 是为了不依赖 ALTER DEFAULT PRIVILEGES 的 owner 假设（生产 owner 是 pw_saas，
--    pw_runtime 由 infra/docker/bootstrap-owner.sql 建好；grant-runtime.sql 亦会按策略清单补授）。
ALTER TABLE "wechat_login_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "wechat_login_requests" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_platform ON "wechat_login_requests"
    FOR ALL TO pw USING (true) WITH CHECK (true);

CREATE POLICY tenant_isolation_runtime ON "wechat_login_requests"
    FOR ALL TO pw_runtime
    USING (tenant_id::text = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "wechat_login_requests" TO pw_runtime;

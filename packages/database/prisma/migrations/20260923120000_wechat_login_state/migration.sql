-- S3c-1：微信授权 state 改为「不透明随机串 + 服务端短期记录」
--
-- 背景（按官方文档修正）：微信《网页授权》参数表要求 state 只能是 a-zA-Z0-9、最多 128 字节；
-- 原方案「签名 JWT 装 payload」約 250+ 字符且含 `-`/`_`，不满足，真实调用会失败。
-- 现在 state = 32 位十六进制随机串，tenantCode/returnTo 落这张表，单次消费、10 分钟过期。
--
-- 该表是**预认证**表：登录前按 state 哈希查行，此时还不知道租户，因此与 refresh_sessions 同口径
-- ——**故意不启用 RLS**，运行时角色可读写。租户隔离靠「业务代码校验行内 tenant_id」保证。
-- 这是有意为之，不是漏写策略（S3.5 那只修 phone_verification_codes / player_applications）。

-- 旧表是 S3a-2 按当时 B 口径（首次必须绑手机号）建的中间态表，从未写入过任何行；
-- A′ 口径下不需要它，用新表取代，避免留下名不副实的结构。
DROP TABLE IF EXISTS "wechat_login_requests";

CREATE TABLE "wechat_login_states" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "state_hash" TEXT NOT NULL,
    "return_to" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "wechat_login_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wechat_login_states_state_hash_key"
    ON "wechat_login_states"("state_hash");
CREATE INDEX "wechat_login_states_expires_at_idx"
    ON "wechat_login_states"("expires_at");

ALTER TABLE "wechat_login_states"
    ADD CONSTRAINT "wechat_login_states_tenant_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "wechat_login_states" TO pw_runtime;

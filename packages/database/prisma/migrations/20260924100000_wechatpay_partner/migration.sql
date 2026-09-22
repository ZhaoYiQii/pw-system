-- S4-0：服务商模式微信支付的数据模型
--
-- 口径（沿用仓库既有约定，并遵守 S3.5 之后的 RLS 语义）：
--   * 租户级表：ENABLE ROW LEVEL SECURITY + 两条策略，但**不 FORCE**（表 owner 全量、非 owner 受策略约束）；
--   * **预认证表**（webhook_inbox）：回调在解密前还不知道租户，故意不启用 RLS，
--     与 refresh_sessions / wechat_login_states 同口径；
--   * 金额一律整数分（amount_fen BIGINT）；时间戳用 timestamptz。

-- 1) 支付单扩展：服务商模式下的商户标识、微信侧单号、payer 标识（加密存储）、支付完成时间
ALTER TABLE "payment_orders"
    ADD COLUMN "sp_mchid" TEXT,
    ADD COLUMN "sub_mchid" TEXT,
    ADD COLUMN "prepay_id" TEXT,
    ADD COLUMN "transaction_id" TEXT,
    ADD COLUMN "payer_openid_enc" TEXT,
    ADD COLUMN "paid_at" TIMESTAMPTZ(3);

CREATE INDEX "payment_orders_tenant_transaction_idx"
    ON "payment_orders"("tenant_id", "transaction_id");

-- 2) 门店支付账户（门店作为服务商模式下的子商户）
CREATE TABLE "tenant_payment_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "sub_mchid" TEXT,
    "sub_appid" TEXT,
    "apply_no" TEXT,
    "status" TEXT NOT NULL DEFAULT 'APPLYING',
    "last_synced_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "tenant_payment_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tenant_payment_accounts_tenant_id_key"
    ON "tenant_payment_accounts"("tenant_id");
ALTER TABLE "tenant_payment_accounts"
    ADD CONSTRAINT "tenant_payment_accounts_tenant_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tenant_payment_accounts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_platform ON "tenant_payment_accounts"
    FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_runtime ON "tenant_payment_accounts"
    FOR ALL TO pw_runtime
    USING (tenant_id::text = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "tenant_payment_accounts" TO pw_runtime;

-- 3) 退款单
CREATE TABLE "payment_refunds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "payment_order_id" UUID NOT NULL,
    "out_refund_no" TEXT NOT NULL,
    "amount_fen" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "refund_id" TEXT,
    "reason" TEXT,
    "succeeded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "payment_refunds_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payment_refunds_tenant_out_refund_no_key"
    ON "payment_refunds"("tenant_id", "out_refund_no");
CREATE INDEX "payment_refunds_order_idx"
    ON "payment_refunds"("tenant_id", "payment_order_id");
ALTER TABLE "payment_refunds"
    ADD CONSTRAINT "payment_refunds_tenant_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_refunds" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_platform ON "payment_refunds"
    FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_runtime ON "payment_refunds"
    FOR ALL TO pw_runtime
    USING (tenant_id::text = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "payment_refunds" TO pw_runtime;

-- 4) 回调收件箱（**预认证表，故意不启用 RLS**）
--   为什么必须有：微信要求 5 秒内验签并应答，且最多重试 15 次。
--   先把原始报文落库再应答，进程崩溃也不会丢单；解密与入账由 worker 异步做。
CREATE TABLE "webhook_inbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" TEXT NOT NULL DEFAULT 'wechatpay_partner',
    "event_id" TEXT NOT NULL,
    "event_type" TEXT,
    "headers" JSONB NOT NULL,
    "raw_body" TEXT NOT NULL,
    "signature_verified" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webhook_inbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "webhook_inbox_provider_event_id_key"
    ON "webhook_inbox"("provider", "event_id");
CREATE INDEX "webhook_inbox_processed_at_idx" ON "webhook_inbox"("processed_at");
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "webhook_inbox" TO pw_runtime;

-- 5) 对账：账单文件与差异
CREATE TABLE "reconciliation_statements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "sub_mchid" TEXT NOT NULL,
    "bill_type" TEXT NOT NULL DEFAULT 'TRADE',
    "bill_date" DATE NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "total_fen" BIGINT NOT NULL DEFAULT 0,
    "downloaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reconciliation_statements_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "reconciliation_statements_unique"
    ON "reconciliation_statements"("tenant_id", "bill_type", "bill_date", "sub_mchid");
ALTER TABLE "reconciliation_statements"
    ADD CONSTRAINT "reconciliation_statements_tenant_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reconciliation_statements" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_platform ON "reconciliation_statements"
    FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_runtime ON "reconciliation_statements"
    FOR ALL TO pw_runtime
    USING (tenant_id::text = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "reconciliation_statements" TO pw_runtime;

CREATE TABLE "reconciliation_differences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "statement_id" UUID,
    "payment_order_id" UUID,
    "kind" TEXT NOT NULL,
    "amount_fen" BIGINT,
    "detail" TEXT,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reconciliation_differences_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "reconciliation_differences_tenant_kind_idx"
    ON "reconciliation_differences"("tenant_id", "kind", "created_at");
ALTER TABLE "reconciliation_differences"
    ADD CONSTRAINT "reconciliation_differences_tenant_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reconciliation_differences" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_platform ON "reconciliation_differences"
    FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_runtime ON "reconciliation_differences"
    FOR ALL TO pw_runtime
    USING (tenant_id::text = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "reconciliation_differences" TO pw_runtime;

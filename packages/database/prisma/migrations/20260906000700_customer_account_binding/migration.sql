-- Slice 5 追加：客户档案绑定门店账号（客户自助入口身份来源）
ALTER TABLE "customer_profiles" ADD COLUMN "tenant_account_id" UUID;
CREATE UNIQUE INDEX "customer_profiles_tenant_id_tenant_account_id_key" ON "customer_profiles"("tenant_id", "tenant_account_id");
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_tenant_account_id_fkey"
  FOREIGN KEY ("tenant_account_id") REFERENCES "tenant_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
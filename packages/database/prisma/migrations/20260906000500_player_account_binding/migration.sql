-- Slice 4 追加：陪玩档案绑定门店账号（自助端身份来源）
-- 一个 PLAYER 账号最多绑定一个陪玩档案；解绑/账号删除时置空，不删除档案。

ALTER TABLE "player_profiles" ADD COLUMN "tenant_account_id" UUID;

CREATE UNIQUE INDEX "player_profiles_tenant_id_tenant_account_id_key" ON "player_profiles"("tenant_id", "tenant_account_id");

ALTER TABLE "player_profiles" ADD CONSTRAINT "player_profiles_tenant_account_id_fkey"
  FOREIGN KEY ("tenant_account_id") REFERENCES "tenant_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
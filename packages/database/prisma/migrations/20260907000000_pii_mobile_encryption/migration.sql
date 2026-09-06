-- A5：手机号加密存储 + 租户内不可逆查询哈希。
-- 开发/测试库中的历史明文手机号在迁移时清空（业务尚未真实使用手机号；应用层将使用 AES-GCM 写入 mobile_enc）。

UPDATE customer_profiles SET mobile = NULL WHERE mobile IS NOT NULL;
UPDATE player_profiles SET mobile = NULL WHERE mobile IS NOT NULL;

ALTER TABLE customer_profiles DROP COLUMN mobile;
ALTER TABLE customer_profiles
  ADD COLUMN mobile_enc TEXT,
  ADD COLUMN mobile_hash TEXT;
ALTER TABLE customer_profiles
  ADD CONSTRAINT customer_profiles_tenant_id_mobile_hash_key UNIQUE (tenant_id, mobile_hash);

ALTER TABLE player_profiles DROP COLUMN mobile;
ALTER TABLE player_profiles
  ADD COLUMN mobile_enc TEXT,
  ADD COLUMN mobile_hash TEXT;
ALTER TABLE player_profiles
  ADD CONSTRAINT player_profiles_tenant_id_mobile_hash_key UNIQUE (tenant_id, mobile_hash);

-- 门店账号密码状态（ADR-0009 决策三 D / spec §5.2）：
--   false = 密码由系统生成（存量随机密码账号 / 手机与微信自动建号 / 管理员建号）→「设置密码」免验原密码；
--   true  = 用户本人设过 → 改密必须校验 currentPassword。
-- 默认 false 使全部存量行自动读作「初次」，无需数据回填。
--
-- 手写迁移（非 prisma migrate dev 生成）：该命令在 2026-09-26 生成的 diff 会顺带把历史手写迁移
-- 与 schema.prisma 的既有偏差（自定义 FK/索引名、id 列 DROP DEFAULT、normalized_name SET NOT NULL 等）
-- 一次性重写，与本次变更无关，故只保留本行 ALTER。同类处理见 20260922180000_slot_and_outbox_foreign_keys。
ALTER TABLE "tenant_accounts" ADD COLUMN "password_set_by_user" BOOLEAN NOT NULL DEFAULT false;

-- 首次建库引导（owner 连接执行，早于 prisma migrate deploy）。
-- 背景：迁移 20260906000100_tenancy 内含 `ALTER DEFAULT PRIVILEGES FOR ROLE pw IN SCHEMA public ...`，
-- 假定对象 owner 叫 `pw`（本地开发即如此）；生产 owner 是 `pw_saas` 时该语句会因
-- `role "pw" does not exist` 直接让迁移失败（P3018 / SQLSTATE 42704）。
--
-- 这里创建同名占位角色并把它的权限授予真实 owner，使迁移可以照常跑完。
-- 注意：占位角色不会创建对象，因此 `FOR ROLE pw` 的默认权限对 `pw_saas` 创建的表不生效，
-- 迁移后仍需按 infra/docker/grant-runtime.sql 补授权（见 runbook）。

DO $$
DECLARE
  owner_name text := current_user;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pw') THEN
    CREATE ROLE pw NOLOGIN;
  END IF;
  -- 让连接用的 owner 成为占位角色成员（幂等）
  EXECUTE format('GRANT pw TO %I', owner_name);
END
$$;

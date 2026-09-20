-- pw_runtime 运行时授权补齐（owner 连接执行；在 `prisma migrate deploy` 之后、应用启动之前；可重复执行）。
--
-- 为什么需要：
--   1) 迁移 20260906000100_tenancy 里的 `ALTER DEFAULT PRIVILEGES FOR ROLE pw IN SCHEMA public`
--      假定对象 owner 叫 `pw`；生产 owner 是 `pw_saas` 时，后续迁移新建的表拿不到这些默认权限。
--   2) 实测（P2 冒烟，fresh DB）：owner=pw 时 64/64 张带 `tenant_isolation_runtime` 策略的表对
--      pw_runtime 可读；owner=pw_saas 时只有 2/64（仅 tenancy 那两张显式授权的）。
--   RLS 策略只负责「行级隔离」，没有表级 GRANT 时运行时角色连表都读不到。
--
-- 幂等：只做 GRANT 与 ALTER DEFAULT PRIVILEGES，可反复执行。

DO $$
DECLARE
  owner_name text := current_user;
  r record;
BEGIN
  EXECUTE 'GRANT USAGE ON SCHEMA public TO pw_runtime';

  -- 现有对象：按策略清单逐个授权，避免漏表
  FOR r IN
    SELECT schemaname, tablename
    FROM pg_policies
    WHERE policyname = 'tenant_isolation_runtime'
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO pw_runtime',
      r.schemaname, r.tablename
    );
  END LOOP;

  -- 未来对象：以真实 owner 的身份设默认权限（而不是假定叫 pw）
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pw_runtime',
    owner_name
  );
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO pw_runtime',
    owner_name
  );
END
$$;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pw_runtime;

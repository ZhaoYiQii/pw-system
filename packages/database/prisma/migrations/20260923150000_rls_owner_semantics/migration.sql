-- S3.5：把租户表的 RLS 语义收敛成「owner 全量、非 owner 受策略约束」
--
-- 背景（S7 前置实验，2026-09-23，一次性库实测）：
--   现有租户表是 ENABLE + **FORCE** ROW LEVEL SECURITY，策略只 TO pw（开发 owner 名）与 TO pw_runtime。
--   FORCE 的含义是「连表 owner 也受策略约束」，而这些策略里并没有生产 owner 的角色名
--   （生产 owner 是 POSTGRES_USER，例如 pw_saas）。实测：非 super 的表 owner 读自己的
--   RLS+FORCE 表 = **0 行，静默不报错**。
--   而 owner 连接（PLATFORM_DATABASE_URL）是**故意**用来全局扫描的：
--   background/worker.ts（自动关单、自动确认）、platform-billing.service.ts（域名占用检查）、
--   auth.repository.ts（审计写入），background/bootstrap.ts:16 的注释亦写明「表 owner 全量权限」。
--   当前生产还能跑，只因为官方 postgres 镜像把 POSTGRES_USER 建成了 superuser（superuser 绕过 RLS）——
--   这是巧合，不是保证。
--
-- 本迁移改成与角色名无关的既定行为：
--   1) 所有表去掉 FORCE → 表 owner 按 PostgreSQL 默认语义绕过 RLS（无论它叫什么、是不是 super）；
--   2) 非 owner 角色（pw_runtime）照旧受 tenant_isolation_runtime 约束，租户隔离不受影响；
--   3) 顺手给两张此前连 ENABLE 都没有的表补上 RLS（phone_verification_codes / player_applications）；
--      代码审计：这两张表只被各自 service 通过 withTenantContext（runtime 连接）访问，
--      以及集成测试用 owner 连接做夹具/清理 —— owner 绕过 + runtime 带上下文，两条路都安全。

DO $$
DECLARE
  r record;
  changed int := 0;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relforcerowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', r.relname);
    changed := changed + 1;
  END LOOP;
  RAISE NOTICE 'S3.5: 去掉 FORCE ROW LEVEL SECURITY 的表数量 = %', changed;
END
$$;

-- 两张漏网表：补 ENABLE + 平台/运行时两条策略 + 显式授权（口径照 20260906000100_tenancy）
ALTER TABLE "phone_verification_codes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_platform ON "phone_verification_codes"
    FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_runtime ON "phone_verification_codes"
    FOR ALL TO pw_runtime
    USING (tenant_id::text = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE "player_applications" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_platform ON "player_applications"
    FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_runtime ON "player_applications"
    FOR ALL TO pw_runtime
    USING (tenant_id::text = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "phone_verification_codes", "player_applications" TO pw_runtime;

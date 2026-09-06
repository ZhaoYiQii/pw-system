# Slice 1 验收记录（进行中，部分完成）

- 规格版本：v1.0
- 切片：Slice 1 — 租户开通与隔离
- 状态日期：2026-09-06
- 状态：**partial（核心 DB/RLS/测试完成；API 模块/后台/移动端定位器未完成）**
- 提交：随本记录提交

## 已完成并验证

- `packages/database`：Prisma 7.10.0（prisma-client generator + @prisma/adapter-pg）；schema：tenants / tenant_domains / tenant_app_bindings。
- 迁移 `20260906000100_tenancy`：建表 + `pw_runtime` 角色（LOGIN, NOBYPASSRLS）+ `FORCE ROW LEVEL SECURITY`（tenant_domains、tenant_app_bindings）+ runtime policy（`app.tenant_id` GUC）+ owner/platform policy + 授权与默认权限。
- 开发库 `pw_saas` 与测试库 `pw_saas_test`：`prisma migrate deploy` 退出码 0。
- 源码：`createDatabaseClient(connectionString)` 与 `withTenantContext(client, tenantId, fn)`（`set_config('app.tenant_id',...)` 事务内）。
- 根命令接通：`pnpm test:tenant-isolation`、`pnpm test:integration`。
- `pnpm test:tenant-isolation`：6/6 通过（SELECT / INSERT 本租户 / INSERT 跨租户拒绝 / UPDATE 跨租户失败 / DELETE 跨租户失败 / FK 拒绝）。
- `pnpm test:integration`：2/2 通过（平台建租户+域名解析；重复编码唯一约束）。
- 回归：`pnpm typecheck`（5/5）、`pnpm lint`、`pnpm test`（3/3）、`pnpm build`（4/4）、`pnpm build:h5`、`pnpm build:weapp` 全部退出 0。

## 环境事实（证据）

- 宿主机 5432/6379/9000 被**原生 Windows PostgreSQL 等占用**，容器已重映射：postgres→5433、redis→6380、minio→9002/9003（docker-compose.yml）。
- Prisma schema engine 曾报空错误，实为连到错误库（P1000 认证失败）；改连 5433 后正常，非 SQL 问题。

## 未完成（本切片剩余，明确列出）

- API `tenancy` 模块与 `tenant-context`（NestJS）：未实施。
- 平台后台租户列表/新建/停用页面：未实施。
- 移动端 `tenant-locator` contracts/h5 adapter：未实施。
- 停用租户的 H5 统一不可用页：未实施。

## 结论

Slice 1 数据库层与租户隔离验证已 locally-verified；整体切片未完成，剩余部分继续在 Slice 1 内完成，不进入 Slice 2。

# Slice 3 验收记录（进行中，Phase A）

- 规格版本：v1.0
- 切片：Slice 3 — 门店配置、套餐与品牌主题
- 状态日期：2026-09-06
- 状态：**partial（Phase A：@pw/config-schema 完成；DB/API/UI 未完成）**

## 已完成并验证（Phase A）

- `packages/config-schema`（zod@4.5.4）：tenant-config v1 严格 schema（品牌受限 token：主色/辅色 hex、logoText≤40、borderRadius 0-24；storefront 开关）+ 默认值 + 分层合并 + 安全解析。
- 单测 5 项：默认合法；非法颜色拒绝；任意 URL/脚本/未知字段拒绝（strict）；borderRadius 越界拒绝；分层合并以 override 为准。
- unit 合计 12/12；config-schema build 退出 0；typecheck 6→7 包待全量复核。

## 未完成（记录至台账）

- DB：tenant_config_versions / tenant_entitlements（+RLS）迁移。
- API：tenant-config 模块（版本化配置存取/回滚/生效配置）、entitlements 模块（core 常开 + addon 默认关、平台开关、未授权 addon 行为 403/关闭）。
- admin：门店设置页（品牌主题 + 版本/回滚）、平台套餐/功能开关页。
- mobile：runtime-config 拉取品牌 token 并应用；无效配置门店进入 CONFIG_ERROR。
- 契约测试：tests/contract/tenant-config.spec.ts。

## Phase B（2026-09-06）

- DB 迁移 `20260906000300_tenant_config_entitlements`：tenant_config_versions / tenant_entitlements（+FORCE RLS），已应用到 pw_saas 与 pw_saas_test（prisma migrate deploy exit 0）。
- API：TenantConfigService/PrismaConfigRepository（默认配置、版本化保存、回滚、CONFIG_ERROR 失败关闭）；EntitlementsService/Repository（core 常开、addon 默认关、平台开关、addon 门禁 FeatureDisabled→403）；控制器（tenant/config 读写回滚/versions、tenant/features、tenant/addon/:key 门禁、platform/tenants/:id/entitlements 读写）。
- 集成测试 5 项（默认配置/非法配置拒绝/保存生效+版本/回滚/entitlements 门禁）；契约测试 3 项接通 `pnpm test:contract`。
- 全量：test:integration 25/25、contract 3/3、unit 12/12、typecheck 8/8、lint、build 5/5、build:h5、build:weapp 全绿。
- 剩余（台账 D）：admin 门店设置页（品牌 token/版本/回滚）、平台功能开关页、mobile runtime-config 品牌应用（运行态需 API+域名）。
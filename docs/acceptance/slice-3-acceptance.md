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

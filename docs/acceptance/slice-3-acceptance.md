# Slice 3 验收记录

- 规格版本：v1.0
- 切片：Slice 3 — 门店配置、套餐与品牌主题
- 状态日期：2026-09-06
- 状态：**complete（Phase A/B/C 全部完成并 locally-verified；运行态 E2E 按台账以反代拓扑验证）**

## Phase A：@pw/config-schema（完成）
- `packages/config-schema`（zod@4.5.4）：tenant-config v1 严格 schema（受限品牌 token）+ 默认值 + 分层合并 + 安全解析。单测通过。

## Phase B：DB + API（完成）
- 迁移 `20260906000300_tenant_config_entitlements`：tenant_config_versions / tenant_entitlements（+FORCE RLS）。
- tenant-config（版本化保存/回滚/生效配置/CONFIG_ERROR 关闭）；entitlements（core 常开、addon 默认关、平台开关、门禁 403）。
- 契约测试 `tests/contract/tenant-config.spec.ts` 3/3。

## Phase C：UI + mobile + 公开前台配置（2026-09-06 完成）
- API 公开端点 `GET /api/v1/public/storefront/config?host=`（tenant-config 模块，注入 TenancyService 按已验证域名解析；不信任客户端 tenantId；返回受限 brand token + 前台开关；INACTIVE/CONFIG_ERROR 不猜测默认值）。
- admin-web（统一 `lib/api.ts` Bearer 鉴权 + globals.css 视觉基线）：
  - 平台 `/login`、租户 `/tenants`、套餐与功能 `/packages`（核心常开 + addon 开关，真写后端 entitlement）。
  - 门店 `/store/login`、设置 `/settings`（品牌 token 表单 + 版本历史 + 回滚 + CONFIG_ERROR banner + 增值功能只读）。
- mobile runtime-config（`features/runtime-config` 解析 + `platform/{h5,weapp}/runtime-config` 适配器，`@platform-runtime-config` 别名）：
  - H5 首页动态显示品牌 token（主色卡/logo/圆角/前台开关），CONFIG_ERROR 显示门店不可用；weapp typed unsupported。
- 测试：unit 17/17（+mobile 解析 5）、integration 32/32（+storefront-config 5、config-error 持久化/回滚 2）、contract 3/3、tenant-isolation 9/9、typecheck 8/8、lint、build 5/5、build:h5、build:weapp 全绿。

## 本轮修复（演示中暴露，已修 + 测试）
1. `PermissionsGuard` 构造注入 Reflector 在生产 tsc 构建下无法解析（此前从未启动过 dist API）→ 改为即时 `new Reflector()`，去除 DI 依赖。`apps/api/src/common/auth/permissions.guard.ts`
2. CONFIG_ERROR 不持久：损坏 ACTIVE 被标记后无 ACTIVE 版本 → getEffective 回落默认值（违反“不使用猜测默认值”）→ 无 ACTIVE 但存在历史版本时持续 CONFIG_ERROR；rollback 支持从 CONFIG_ERROR 回滚。`config.service.ts` + `prisma-config.repository.ts`（测试 2 项）。
3. H5 `process.env` 在浏览器运行时未定义 → apiBase() 抛错 → 门店加载失败：tenant-locator / runtime-config h5 适配器加 `typeof process` 守卫，回退 `location.origin`（真实部署经同源反代）。`apps/mobile/src/platform/h5/*`
4. API CORS：仅当显式配置 `ADMIN_WEB_ORIGIN`/`H5_ORIGIN` 时启用（默认关闭，更安全）。`apps/api/src/main.ts`

## 运行态演示（2026-09-06，本地反代拓扑）
- 服务：API :3100（dist）、admin-web :3001（next dev）、mobile H5 静态 :10086（/api 反代 → :3100）。
- 流程截图（14 张）：平台登录 → 租户列表 → 套餐/功能开关（开启 2 个 addon）→ 门店登录 → 设置默认品牌 → H5 默认品牌 → 保存新品牌（绿色 v1）→ H5 动态生效（logo「电竞陪玩Demo店」）→ 注入损坏配置 → H5 CONFIG_ERROR 不可用 → 设置页 CONFIG_ERROR banner → 回滚恢复 v1 → H5 恢复品牌。截图保存在会话 outputs。

## 未验证/残余（记录至台账）
- H5 运行态依赖“已验证域名 + 同源反代/公网域名”拓扑；CI 不跑 integration/tenant-isolation（无 PostgreSQL service）。
- `pnpm db:seed:dev`（root 脚本）因根 `node_modules/@pw/database` 未链接而无法运行（本次演示用 apps/api 上下文临时脚本完成播种）——待修：root 增 `@pw/database` workspace 依赖或迁移脚本位置。
- Taro dev watch 缺 `@pmmmwh/react-refresh-webpack-plugin`（build:h5/weapp 不受影响）；需要 watch 时补 devDependency。
- weapp 小程序与 addon UI 联动、多域名路由仍随后续切片/上线环境验证。
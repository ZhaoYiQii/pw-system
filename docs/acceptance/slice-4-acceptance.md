# Slice 4 验收记录

- 规格版本：v1.0
- 切片：Slice 4 — 客户、陪玩与服务目录
- 状态日期：2026-09-06
- 状态：**complete（数据+API+admin UI+陪玩自助 API 完成并 locally/CI verified；mobile 自助页数据接线待 H5 登录切片，页面结构完成且双端构建通过）**

## 完成
- 迁移 `20260906000400_customers_catalog`：customer_profiles/player_profiles/games/game_regions/service_products/pricing_rules/player_skills/player_availability + FORCE RLS + DB CHECK（price>0/cost>=0/duration>0/ends>starts）。
- 迁移 `20260906000500_player_account_binding`：player_profiles.tenant_account_id（租户内唯一，账号删除置空）。
- API（HTTP 集成 6 项覆盖）：customers CRUD；players 档案/技能/可用时间（重叠行锁拒绝）；catalog 游戏/区服/产品/价格（MoneyFen 整数分，负价/浮点/重复时长被拒）；跨租户技能关联 400；service 角色越权 403；绑定 PLAYER 账号 + /tenant/player/me（仅 PLAYER 角色，非陪玩 403）。
- 修复：PermissionsGuard 升级为全局 APP_GUARD（此前仅 tenancy 生效）。
- admin UI：客户/陪玩/服务目录三页（真实 CRUD 演示 + 截图 s4-01..05）；统一 TenantNav。
- mobile：player/profile 与 player/availability 页面注册（H5/weapp 构建成功）。
- 验证：unit 17/17、integration 38/38、tenant-isolation 13/13、typecheck 8/8、lint、build、CI 全绿（含 DB service）。

## 未完成/待条件（台账）
- mobile 自助页数据接线：需 H5 登录 UI（后端 /auth/login + 自助 /tenant/player/me 已就绪）；页面当前显式占位，不做模拟成功。
- 运行态公网域名 E2E、weapp 真机。
# 商家端 UI 差距清单（用于 UI 设计补齐后直接对接后端）

- 日期：2026-09-08
- 范围：`apps/admin-web/app/(tenant)` 商家端
- 口径：以 `apps/api/src/modules`、`openapi.yaml` 实际接口、`apps/admin-web/app/(tenant)` 现有页面与 `design-demos` 原型为准
- 状态：待逐项补齐后回填

## 1. 覆盖现状

| 后端模块 / 接口组 | UI 状态 | 说明 |
| --- | --- | --- |
| orders / dispatch / game-dispatch | ✅ 已设计 | 工作台、订单台账、派单、选人、订单详情 |
| ai-assistant | ⚠️ 半覆盖 | 仅有新建订单 AI 解析弹层，缺独立 AI 助手页 |
| catalog（游戏/区服/产品/价格） | ⚠️ 占位 | 服务目录与 game-templates 未纳入统一框架 |
| customers / players | ⚠️ 占位 | 档案、技能/排班、账户账变缺详情页 |
| service-sessions / files / evidence | ❌ 缺独立 UI | 无场次台账/证据查看/调整复核 |
| finance-rules / ledger | ⚠️ 半覆盖 | 费率/试算已存在，收入账本与分账规则编辑未设计 |
| settlements | ⚠️ 半覆盖 | 应收与批次雏形存在，批次详情/复核/批准/登记支付/冲正未完整设计 |
| disputes | ⚠️ 占位 | 缺客诉详情、证据时间线、处理动作 |
| notifications | ⚠️ 占位 | 缺通知中心、模板、失败重试可视化 |
| audit | ⚠️ 占位 | 缺日志筛选/详情/导出 |
| tenant-config | ⚠️ 半覆盖 | 品牌表单存在，缺配置版本/回滚 UI |
| identity / tenant accounts | ❌ 缺失 | 员工与角色无 UI（接口也尚未开放） |
| entitlements / features | ⚠️ 半覆盖 | 仓库只读展示，缺套餐状态与权限矩阵 |
| wallet / account | ❌ 缺失 | `customers/{id}/account`、`players/{id}/account` 无对应 UI |

## 2. 待补 UI 清单

| # | 缺失 UI | 归属 | 可对接接口 | 完成 |
| --- | --- | --- | --- | --- |
| 1 | 门店概览（监控台首页） | 监控台 | 聚合接口/前端组装 | ☐ |
| 2 | AI 需求助手 | 工作台 | `/tenant/ai/parse-requirement`、`/tenant/ai/orders/*` | ☐ |
| 3 | 场次台账 + 详情时间线 | 记录台 | `/tenant/sessions/{sessionId}/events` | ☐ |
| 4 | 证据查看/核对/下载 | 记录台+详情 | `/tenant/evidence/{id}` | ☐ |
| 5 | 时长/金额调整复核 | 记录台+监控 | 场次事件、audit 联动 | ☐ |
| 6 | 收入账本 / 应收明细 | 记录台 | ledger、settlements items | ☐ |
| 7 | 结算批次详情/复核/批准/登记支付/冲正 | 记录台 | `/tenant/settlements/{id}/review|approve|pay|void|items` | ☐ |
| 8 | 财务风险（待复核/open hold/超时） | 监控台 | 结算/争议聚合 | ☐ |
| 9 | 客诉/争议详情处理 | 记录台+监控 | `/tenant/disputes`、`/disputes/{id}` | ☐ |
| 10 | 审计日志筛选/详情/导出 | 记录台 | `/tenant/audit` | ☐ |
| 11 | 通知中心 + 已读/全部已读 | 监控台 | `/tenant/notifications/*` | ☐ |
| 12 | 通知模板/通道状态/失败重试 | 门店设置+监控 | worker/outbox（部分待接口） | ☐ |
| 13 | 员工与角色 | 门店设置 | `/tenant/accounts`（后端待补） | ☐ |
| 14 | 配置版本历史/回滚 | 门店设置 | `/tenant/config/versions`、`/config/rollback` | ☐ |
| 15 | 订阅/套餐与增值功能状态 | 门店设置 | `/tenant/features`、`/tenant/addon/*` | ☐ |
| 16 | 客户/陪玩账户余额与账变 | 档案页 | `customers/{id}/account`、`players/{id}/account` | ☐ |
| 17 | 游戏模板/服务产品/定价规则编辑 | 记录台·服务目录 | `/catalog/*`、`/tenant/finance-rules/*` | ☐ |
| 18 | 五态、403、批量操作、导出等通用能力 | 全局 | — | ☐ |

## 3. 建议补齐顺序

1. 场次台账 + 证据查看 + 调整复核
2. 结算批次详情 + 收入账本 + 财务风险
3. AI 需求助手
4. 客户/陪玩账户账变与档案详情
5. 争议详情 + 通知中心 + 审计详情
6. 员工与角色（UI 先行占位）
7. 门店设置：配置版本/回滚 + 套餐状态

## 4. 完成定义

每个模块在 `merchant-console-full.html`（及后续 Next 迁移页）中有可交互的第一版 UI；导航、角色矩阵、主操作与统一模板一致；接入后端时只替换 mock 数据源。

## 5. 第二轮复核（2026-09-08）

- 顶层功能模块已全部进入 merchant-console-full.html 导航（17 项）。
- 页面级缺口仍存在：订单/档案/目录/场次/结算/争议/审计/通知/设置等模块大多只有列表与第一版页面，缺少可对接后端的详情页、证据查看、操作弹层与五态。
- 优先级 1：场次与证据（详情时间线 + 证据查看 + 调整复核）。

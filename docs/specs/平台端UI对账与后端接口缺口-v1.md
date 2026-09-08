# 平台端 UI ↔ 后端接口对账（v1）

> 状态：2026-09-08 · 对应 UI：`apps/admin-web/app/(platform)` 全部页面
> 目的：确认每个功能模块都有对应 UI 与可接线后端；未具备接口的区域全部显式“待接口”，禁止假数据。

## 对账矩阵

| 功能模块 | UI 路由 | UI 状态 | 已就绪接口 | 待补接口 |
| --- | --- | --- | --- | --- |
| 平台登录 | `/login` | 完整 | POST `/auth/login`、POST `/auth/logout`、GET `/platform/me` | 无 |
| 平台总览 | `/overview` | 完整框架 | GET `/platform/tenants`（门店总数/营业中/本月新增） | 总览聚合（待续费/健康指标） |
| 门店管理 | `/tenants` | 完整 | GET `/platform/tenants`、POST deactivate/activate | 无 |
| 门店详情 | `/tenants/[id]` | 完整框架 | GET tenants、entitlements | 店主/套餐/到期/分账/品牌补充接口 |
| 一键开店 | `/onboard` | 完整 | GET `/platform/packages`、POST `/platform/onboarding/tenants` | 无（保存草稿未设计） |
| 套餐与增值功能 | `/packages` | 完整 | GET packages/entitlements、POST entitlements/package | 无 |
| 订阅与用量 | `/subscriptions` | 页面就位，数据待接入 | 无 | 订阅列表、用量、续费 |
| 平台账号 | `/accounts` | 页面就位，仅当前账号 | GET `/platform/me` | 账号列表/CRUD/角色/临时授权 |
| 审计与访问 | `/platform/audit` | 可查单店审计 | GET `/platform/tenants/{tenantId}/audit`（需 reason） | 平台级审计列表、导出 |

## 现有平台接口（openapi.yaml，2026-09-08）

```text
GET  /api/v1/platform/me
GET  /api/v1/platform/tenants
POST /api/v1/platform/tenants/:id/deactivate
GET  /api/v1/platform/tenants/:tenantId/entitlements
POST /api/v1/platform/tenants/:tenantId/entitlements
GET  /api/v1/platform/tenants/:tenantId/audit
GET  /api/v1/platform/tenants/:tenantId/finance-rules
GET  /api/v1/platform/packages
POST /api/v1/platform/onboarding/tenants
POST /api/v1/platform/tenants/:tenantId/package
POST /api/v1/platform/tenants/:tenantId/activate
```

## 待补缺口与建议切片

### Slice P-B1（建议第一个）：运营总览 + 订阅用量 + 门店详情补充

- GET `/api/v1/platform/overview`
  - 门店总数 / 营业中 / 本月新增 / 7 天内到期订阅数
  - 平台健康：Outbox 积压、通知失败、存储用量（存储无计费数据则返回 unavailable）
- GET `/api/v1/platform/subscriptions`
  - 门店 + 套餐 + 到期时间 + 订阅状态；用量字段先以真实可查字段返回（订单量），无法统计的字段返回 `null`
- GET `/api/v1/platform/tenants/:tenantId/detail`
  - 门店基础 + 主域名 + 店主账号 + 当前套餐/到期 + 分账费率 + 品牌配置
- 对应 UI 接线：`/overview`、`/subscriptions`、`/tenants/[id]`

### Slice P-B2：平台账号

- 平台账号列表 / 创建 / 停用 / 启用 / 改角色
- 临时跨租户授权（原因、时限、目标范围，写审计）
- UI 接线：`/accounts`

### Slice P-B3：平台级审计

- GET `/api/v1/platform/audit`（跨租户，须 reason）
- 导出
- UI 接线：`/platform/audit`（汇总视图）

## 约束

- UI 层不得臆造金额、订阅状态、权限与跨租户能力；未接接口处保留“待接口/待接入”标识。
- 每个后端 Slice 单独审批：接口契约变更走 OpenAPI/生成客户端，数据库变更走迁移，涉及权限/租户边界走安全与审计门禁。

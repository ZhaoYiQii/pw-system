# S5 灰度、观测与兼容收口 Implementation Plan

> 状态：**计划草稿（待批准实施）**。S5 是通用派单模板 epic 的最后一个切片。

Goal: 用**租户级**功能开关把 v2 模板入口可控地放开，补齐关键路径的结构化日志与只读审计，产出灰度/回退 runbook，并给出旧写路径与旧列的移除评估（本片不删除）。

Architecture: 复用仓库既有的租户能力位（`entitlements`：`(tenantId, featureKey, enabled, source)` + `tenant/features` 接口）作为开关载体，**不需要新表或迁移**；服务端在 v2 入口处做租户级门禁，前端按同一开关隐藏入口；观测通过在既有结构化请求日志之外增加领域事件日志实现；审计用只读脚本统计并脱敏输出。

Tech stack: NestJS 12 + Prisma/PostgreSQL；`apps/api` 现成 `entitlements` 模块、`request-context.middleware.ts` 与结构化日志；admin-web Next 16 + TanStack Query；Vitest 3.2 + Playwright（真实 API E2E）。

Spec: 设计规格 `docs/superpowers/specs/2026-09-13-multi-game-dispatch-template-center-design.md` §16「S5：灰度、观测与收缩」、§17「发布与回退」、§18「已定边界」；执行约束见 `docs/handoffs/2026-09-16-deepseek-generic-dispatch-template-execution-guide.md` §12。

Scope and non-goals:

- 范围内：租户级开关（后端 + 前端入口）、8 类关键路径指标/结构化日志、只读审计脚本、灰度与回退 runbook、S5 验收记录与兼容收口清单。
- 非目标（需另行设计/批准）：删除旧 `positions/rankRules/copyLines` 写路径或数据库列；旧模板人工归类；契约 discriminator 的组件化根治；把开关做成进程级全局开关；任何破坏性 down migration。

Permission gates（每项需届时单独确认）：

- **P1 生成契约产物**：`corepack pnpm openapi:generate` 会改写受版本管理的 `openapi.yaml`/`openapi.json`/`packages/api-client/src/*`。
- **P2 一次性测试库**：仅 `pw_saas_s2_task2_20260916`（本地 5433）；禁止 `pw_saas`、`pw_saas_test`、`pw_shadow`、S1b 演练库与任何远程库。
- **P3 启动本地服务**：Docker postgres、API（3100）、admin dev（3005）。
- **P4 迁移**：**本计划预计零 DDL**（开关复用既有 entitlements 表）；若实施中发现必须加列，停下来单独申请。
- **P5 提交 / 推送 / 部署**：均不在本计划内，各自单独授权。

Completion evidence（S5 完成的最低证据，缺一项不得声称完成）：

- 开关：单元 + 集成为证（同租户关→v2 入口不可用且报受控码；开→可用；A 租户关闭不影响 B 租户）；
- 观测：关键路径事件的实测日志样例（含 tenantId/featureKey/结果/耗时，且不含 config、订单值、PII）；
- 审计：脚本输出样例 + 两类断言（计数正确、脱敏不输出 config/订单值/PII）；
- 文档：runbook 与 `docs/acceptance/2026-09-17-s5-rollout-observability.md`；
- 门禁：`@pw/api`/`@pw/admin-web` typecheck + build、领域/集成/契约/隔离测试、真实 API E2E 全绿。

## 1. 事实基线（已核实，实施时不得据记忆改写）

| 事实                                                                                                                                                                          | 位置                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 租户能力位已存在：`(tenantId, featureKey, enabled, source, ...)` 唯一键 `tenantId_featureKey`，并已提供 `list`/`set` 与 `GET tenant/features`、`GET tenant/addon/:featureKey` | `apps/api/src/modules/entitlements/infrastructure/prisma-entitlement.repository.ts:15-26`、`.../application/entitlements.service.ts:23-92`、`.../interface/entitlements.controller.ts:44-58` |
| **没有**装饰器式门禁（无 `RequiresFeature` 之类）                                                                                                                             | `rg RequiresFeature\|FeatureFlag` 无结果                                                                                                                                                     |
| 结构化请求日志已存在（requestId/tenantId/actorId/method/path/statusCode/durationMs）                                                                                          | `apps/api/src/common/http/request-context.middleware.ts` + 实测日志输出                                                                                                                      |
| v2 入口（S2–S4 已交付）：12 条模板 operation + 3 条 S4 operation                                                                                                              | `20e1dd5` / `cbe79e`（`generic-game-template.controller.ts`、`game-dispatch-template-order.controller.ts`）                                                                                  |
| 旧 v1 写路径仍在：`game-template.controller.ts`（字段/岗位/段位/复制文案）与旧列                                                                                              | `apps/api/src/modules/game-dispatch/interface/game-template.controller.ts`                                                                                                                   |
| 本机端口事实                                                                                                                                                                  | 3000 被无关服务占用；API 用 3100、admin 用 3005，admin 必须以 `localhost:3005` 访问                                                                                                          |

## 2. 实施地图（文件 → 责任 → Task）

| 文件                                                                                          | 责任                                                                          | Task |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---- |
| `apps/api/src/common/auth/feature-gate.ts`（新，+ spec）                                      | 租户能力位读取与门禁辅助（受控错误、缓存策略）                                | 1    |
| `apps/api/src/modules/entitlements/*`（改/补）                                                | 暴露 `gameDispatchTemplateV2` 常量的读写与校验                                | 1    |
| `apps/api/src/modules/game-dispatch/interface/*.controller.ts`（改）                          | 在 v2 入口（模板 12 条 + S4 3 条）统一做租户级门禁                            | 1    |
| `apps/api/src/modules/game-dispatch/domain/errors.ts`（改）                                   | 新增受控错误码 `TEMPLATE_FEATURE_DISABLED`                                    | 1    |
| `apps/api/src/openapi/schemas.ts`（改）                                                       | 错误码枚举加新码（加性）                                                      | 1    |
| `apps/admin-web/app/_lib/merchant-console/feature-flags.ts`（新，+ spec）                     | 前端读 `tenant/features` 并决定 v2 入口是否显示                               | 1    |
| `apps/admin-web/.../modules.ts` / `module-views.tsx`（改）                                    | 模板管理与新建派单入口按开关隐藏（关闭时给只读说明）                          | 1    |
| `apps/api/src/modules/game-dispatch/application/game-template-observability.ts`（新，+ spec） | 8 类关键事件的领域日志/计数封装（统一字段、脱敏）                             | 2    |
| 上述两个 controller 与 S4 service（改）                                                       | 在列表、保存草稿、发布、创建派单处发出事件                                    | 2    |
| `scripts/audit-template-v2.mjs`（新）                                                         | 只读审计：未归类 / 无生效版本 / 重名 / 孤立关联 / NEEDS_REVIEW 计数，脱敏输出 | 3    |
| `docs/runbooks/template-v2-rollout.md`（新）                                                  | 灰度顺序、开关步骤、回退、验证清单                                            | 4    |
| `docs/acceptance/2026-09-17-s5-rollout-observability.md`（新）                                | S5 验收记录 + 兼容收口清单                                                    | 5    |
| `tests/integration/template-v2-feature-gate.spec.ts`（新）                                    | 开关的租户级隔离与入口门禁                                                    | 1    |
| `tests/integration/template-v2-observability.spec.ts`（新）                                   | 关键事件日志字段与脱敏断言                                                    | 2    |
| `tests/tenant-isolation/template-v2-feature-gate.spec.ts`（新）                               | A 租户关闭不影响 B 租户                                                       | 1    |

## 3. Task 0（只读预检）

- [ ] 复核 §1 每一行（含 entitlements 唯一键、`list/set` 行为、控制器路由）。
- [ ] 记录基线门禁：`corepack pnpm --filter @pw/api typecheck`、`--filter @pw/admin-web typecheck`、admin 单元套件、领域/集成/隔离/契约四套。
- [ ] 盘点 v1 写路径与旧列的实际使用点（写清单，供 Task 5 的兼容收口评估）。
- [ ] 确认"零 DDL"结论：若发现开关必须新增列，停下来报告并申请。
- [ ] 输出结论给人的确认；未确认前不进入 Task 1。

Verification: 上述命令退出码与输出被记录；文件零改动（`git status` 与开始时一致）。

## 4. Task 1 租户级功能开关 `gameDispatchTemplateV2`

Objective: 开关按租户生效，控制 v2 后端入口与前端入口；关闭时给受控错误与只读说明，不影响已存在数据。覆盖规格 §16-S5 第一条、§17。

Interfaces produced：

- 常量 `GAME_DISPATCH_TEMPLATE_V2_FEATURE = "gameDispatchTemplateV2"`（后端与前端各一处，值必须一致，写进 Task 1 的测试断言）。
- 受控错误码 `TEMPLATE_FEATURE_DISABLED`（403）。
- 门禁辅助：`assertFeatureEnabled(tenantId, featureKey)`；失败抛受控错误，不泄露其他租户的开关状态。

Steps：

- [ ] 先写失败集成用例：关闭该租户开关后，模板列表/草稿/发布/创建派单返回 403 `TEMPLATE_FEATURE_DISABLED`；打开后恢复 200/201。
- [ ] 先写失败隔离用例：A 租户关闭、B 租户开启时，B 的 v2 入口仍然可用（开关必须租户级）。
- [ ] 在 `feature-gate.ts` 实现读取（走 `EntitlementsService`/仓储），并加短 TTL 缓存避免每次请求打库（缓存键含 tenantId + featureKey）。
- [ ] 在 v2 两个 controller 统一接入（12 条模板 operation + 3 条 S4 operation），不改 v1 路由行为。
- [ ] 契约：错误码枚举加 `TEMPLATE_FEATURE_DISABLED`；P1 重新生成契约与客户端。
- [ ] 前端：读 `tenant/features`，`gameDispatchTemplateV2` 关闭时隐藏模板管理与新建派单的 v2 入口，并给出"该门店尚未开通通用模板"的只读说明（不伪造数据）。
- [ ] 跑单元/集成/隔离/契约四套测试。

Focused verification:

- `corepack pnpm --filter @pw/api typecheck` → 0
- `vitest run --config tests/vitest.integration.config.ts tests/integration/template-v2-feature-gate.spec.ts` → 0
- `vitest run --config tests/vitest.tenant-isolation.config.ts tests/tenant-isolation/template-v2-feature-gate.spec.ts` → 0
- `corepack pnpm --filter @pw/admin-web typecheck` → 0；admin 单元套件 → 0

Rollback: 关闭该租户的开关即停用 v2 入口；草稿、版本、订单快照全部保留；零 DDL。

## 5. Task 2 关键路径的结构化日志与指标

Objective: 8 类关键事件可观测且脱敏。覆盖规格 §16-S5 第二条、§17 观测清单。

事件清单（每条含 `tenantId`、`event`、`outcome`、`durationMs`，失败含受控 `code`）：

1. `template.list`（列表延迟）
2. `template.draft_save_failed`（草稿保存失败）
3. `template.revision_conflict`（409）
4. `template.publish_failed`（发布失败）
5. `template.validation_issue`（校验问题，含 issue code 与 path）
6. `template.document_failed`（订单文案生成失败）
7. `template.order_create_failed`（创建派单失败）
8. `template.version_mismatch`（版本不匹配）

Steps：

- [ ] 先写失败用例：触发上述事件后断言日志中出现对应 `event` 与 `code`，且**不包含** config、订单值、客户姓名/手机号等 PII。
- [ ] 实现 `game-template-observability.ts`（统一字段构造 + 脱敏白名单），复用既有 Logger。
- [ ] 在列表、保存草稿、发布、创建派单、订单文案路径接入（不改业务结果，只加观测）。
- [ ] 补一条"高基数保护"：事件字段只允许固定枚举与 id，不写入用户输入文本。

Focused verification: 集成与单元用例 0；日志样例人工核对一次并贴进验收记录。

Rollback: 移除观测调用即回到现状（纯附加，无数据影响）。

## 6. Task 3 只读审计脚本

Objective: 一屏看清 v2 数据健康度，且不泄露 config/订单值/PII。覆盖规格 §16-S5 第三条。

Steps：

- [ ] 先写失败用例：构造未归类、无生效版本、重名、孤立关联、`NEEDS_REVIEW` 各一例，断言计数正确且输出不含 config/订单值/PII。
- [ ] 新建 `scripts/audit-template-v2.mjs`：库名守卫（只允许一次性测试库）、纯只读 SQL、输出 JSON 计数与样例 id（不输出内容）。
- [ ] 在验收记录中附一次真实输出样例。

Focused verification: `node scripts/audit-template-v2.mjs`（对一次性库）→ 0，输出计数与构造数据一致；`git diff` 无数据写入。

Rollback: 删除脚本即回到现状（只读，无副作用）。

## 7. Task 4 灰度与回退 runbook

Objective: 让别人能照着开/关，不需要读代码。覆盖规格 §17。

Steps：

- [ ] 新建 `docs/runbooks/template-v2-rollout.md`：灰度顺序（开发租户 → 测试租户 → 按租户扩大）、每步的开关命令与验证清单、观测看什么、回退步骤（只关开关）、回退后必须核对的计数（草稿/版本/订单快照不变）。
- [ ] 明确禁止项：回退不得删除版本或改写订单；不得执行破坏性 down migration。
- [ ] 在验收记录里链接 runbook 并标注"未做真实生产演练"（除非另行授权）。

Focused verification: 文档可执行性由 Task 1 的开关命令与审计脚本组合复核一次（本地。

## 8. Task 5 S5 验收记录与兼容收口清单

Objective: 收口记录 + 旧路径移除的前置条件。覆盖规格 §18。

Steps：

- [ ] 写 `docs/acceptance/2026-09-17-s5-rollout-observability.md`：命令与退出码、开关证据、日志样例、审计输出、runbook 链接、未验证项。
- [ ] 输出"旧写路径与旧列移除评估"：列出 v1 写路径与 `positions/rankRules/copyLines` 的实际引用点与迁移前置条件，明确**S5 不删除**。
- [ ] 把 S5 与 S4 的 E2E 合并跑一次（真实 API）作为收口证据。

## 9. 执行顺序与并行边界

1. Task 0 → Task 1 必须串行（Task 1 定义开关与错误码）。
2. Task 2、Task 3 依赖 Task 1 的门禁语义，但彼此可并行（不同文件）。
3. Task 4 依赖 Task 1 的命令与 Task 3 的脚本。
4. Task 5 最后执行。
5. 每个 Task 结束必须报告：改动文件、命令与退出码、未验证项。

## 10. 停止点与后续

- 本计划只覆盖 S5；批准后才实施。
- 实施前需要一次明确授权，包含：允许修改的文件范围、允许使用的测试库、是否允许生成 OpenAPI 产物、是否允许启动本地服务、是否需要 DDL（预计不需要）。
- 完成后本 epic（S1–S5）即收口；旧的写路径与列的移除、契约 discriminator 组件化根治，都需要各自的新设计与批准。

# S4 多游戏新建派单与订单快照 Implementation Plan

> 状态：**已完成**（2026-09-17 回写）。验收记录：`docs/acceptance/2026-09-17-s4-new-order-snapshot.md`；提交：`2cebe70`。

Goal: 让门店按某个游戏「已发布的模板版本」创建派单——锁定 `templateVersionId`、服务端按发布快照校验并计算人数与价格、把配置与值写入订单快照，并用幂等键保证一次创建意图只产生一个订单。

Architecture: 后端在既有 `game-dispatch` 模块内新增两条 v2 链路（读取发布表单、创建派单），复用 S1b/S2 已交付的领域件 `game-template-config-v2` / `game-template-values` / `game-template-calculations` / `game-template-document`，旧 `POST /game-dispatch/orders` 与旧模板表保持只读兼容、语义不变。前端把 `new-order-view.tsx` 的三阶段弹窗重写为新栈（TanStack Query + Tailwind/shadcn），表单值只在弹窗会话内缓存，幂等键按「一次创建意图」生成与复用。

Tech stack: NestJS 12 + Prisma + PostgreSQL 18 + Zod（API 边界）；OpenAPI 由 Nest Swagger 生成、客户端由 `@hey-api/openapi-ts` 0.99 生成；admin-web Next 16.3 + TanStack Query 5 + Tailwind v4/shadcn；Vitest 3.2 + Playwright 1.63（`admin` 项目）。

Spec: `docs/superpowers/specs/2026-09-13-multi-game-dispatch-template-center-design.md`（§4 权限、§8.2 新建派单、§8.3 契约与幂等、§10 交互、§11 数据流与异常、§14 测试策略、§15 验收 2/4/10/11/12/13/16、§16 S4、§17 发布与回退、§18 已定边界）；执行约束见 `docs/handoffs/2026-09-16-deepseek-generic-dispatch-template-execution-guide.md` §11。

Scope and non-goals:

- 范围内：该游戏生效模板的选取（默认优先）、发布配置表单读取、锁定版本创建派单、服务端人数与价格计算、订单快照写入、幂等创建、三阶段弹窗与会话缓存、切换模板告警、订单详情按快照生成自动文案与复制。
- 非目标（属 S5 或需单独设计）：租户级功能开关与灰度指标、回退 runbook、旧 `positions/rankRules/copyLines` 写路径与数据库列的移除、旧模板人工归类、`game=unclassified` 的契约表达、契约 `discriminator` 修复。

Permission gates（每一项都需要届时单独确认，计划本身不授权）：

- P1 生成契约产物：`corepack pnpm openapi:generate` 会改写受版本管理的 `openapi.yaml`、`openapi.json`、`packages/api-client/src/*`。
- P2 一次性测试库：仅 `pw_saas_s2_task2_20260916`（本地 127.0.0.1:5433）；禁止 `pw_saas`、`pw_saas_test`、`pw_shadow`、S1b 演练库与任何远程库。
- P3 启动本地服务：Docker `postgres` 容器、API 进程、admin dev 进程（会写库，仅限 P2 的库）。
- P4 数据库迁移：**本计划默认零 DDL**（见 D-2）；若确认要独立存储计算值，新增列与迁移是新的独立授权点，未批准不得执行。
- P5 提交 / 推送 / 部署：不在本计划内，需各自单独授权。

Completion evidence（S4 完成的最低证据，缺一项不得声称完成）：

- `corepack pnpm --filter @pw/api typecheck` 退出码 0；
- 领域、集成、租户隔离、契约四类测试命令与通过数量；
- `corepack pnpm --filter @pw/admin-web typecheck` 与 `build` 退出码 0；
- Playwright 真实 API 多游戏主路径（`-g "S4 新建派单"`）通过；
- 验收记录 `docs/acceptance/2026-09-16-s4-new-order-snapshot.md` 记录真实命令、退出码、库与夹具、未验证项。

## 1. 事实基线（已核实，实施时不得据记忆改写）

| 事实                                                                                                                                                                      | 位置                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 现有 `POST /game-dispatch/orders`、`/customer/orders` 在契约里**无 body、响应为 `unknown`**                                                                               | `packages/api-client/src/types.gen.ts:8492-8511`                                                                                                                                                           |
| 现有 `createDraft` 读**当前**模板（fields/positions/rankRules/sections），无版本锁定、无 v2 计算、不读幂等键                                                              | `apps/api/src/modules/game-dispatch/application/game-dispatch.service.ts:104-296`                                                                                                                          |
| 现有路由与错误映射                                                                                                                                                        | `apps/api/src/modules/game-dispatch/interface/game-dispatch.controller.ts:56-93`；边界 Zod 在 `apps/api/src/common/validation/api-validation-rules.ts:465`                                                 |
| 幂等模型与既有写法                                                                                                                                                        | `packages/database/prisma/schema.prisma:549-561`（唯一键 `[tenantId, idempotencyKey, operation]`）；`apps/api/src/modules/orders/infrastructure/prisma-orders.repository.ts:226-290`                       |
| 快照与订单列**已存在**：`GameDispatchTemplateSnapshot.configJson/schemaVersion/templateVersionId`、`GameDispatchOrder.gameId/templateVersionId/snapshotId/formValuesJson` | `packages/database/prisma/schema.prisma:1148-1195`                                                                                                                                                         |
| v2 领域件（S1b/S2 交付，含各自 spec）                                                                                                                                     | `apps/api/src/modules/game-dispatch/domain/game-template-config-v2.ts`、`game-template-values.ts`、`game-template-calculations.ts`、`game-template-document.ts`                                            |
| OpenAPI 已有 header 参数先例                                                                                                                                              | `openapi.yaml:3148-3170`（`x-file-name`，源自控制器 `@Headers("x-file-name")`，见 `apps/api/src/modules/game-dispatch/interface/slot-session.controller.ts:154`）                                          |
| 前端现用旧模板接口与旧创建 body，且可被 mock 替身                                                                                                                         | `apps/admin-web/app/_lib/merchant-console/new-order-view.tsx:199-259`                                                                                                                                      |
| 前端页面入口                                                                                                                                                              | `apps/admin-web/app/(tenant)/merchant-console/dispatch/{new/page.tsx,page.tsx,[orderId]/page.tsx}` 与 `_lib/merchant-console/{new-order-view.tsx,new-order-dialog.tsx,order-detail.tsx,dispatch-view.tsx}` |
| 测试配置文件名                                                                                                                                                            | `tests/vitest.integration.config.ts`、`tests/vitest.tenant-isolation.config.ts`、`tests/vitest.contract.config.ts`                                                                                         |
| 本机端口事实                                                                                                                                                              | 3000 被无关服务占用，S2/S3 实施一律用 API `3100` + admin `3005`（`NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:3100`），admin 必须以 `localhost:3005` 访问                                                      |

## 2. 需要你先定的两件事（Task 1 开始前）

### D-1 路径命名冲突（必须你定，不能由我猜）

设计规格 §8.2 写的路径是 `GET /api/games/:gameId/dispatch-templates`、`GET /api/game-dispatch-template-versions/:versionId/form`、`POST /api/game-dispatch-orders`；仓库既有约定是 `/api/v1/tenant/<module>/...`（例：`POST /api/v1/tenant/game-dispatch/orders`，`apps/api/src/modules/game-dispatch/interface/game-dispatch.controller.ts:58`）。两份事实冲突，按仓库规则停下请你决定。

**推荐（沿用仓库前缀，新增而不改语义）**：

- `GET /api/v1/tenant/game-dispatch-templates/published?gameId=<uuid>` → 该游戏未归档且有生效版本的模板摘要（`templateId/name/description/versionId/versionNo/isDefault/lastUsedAt`）。
- `GET /api/v1/tenant/game-dispatch-templates/versions/{versionId}/form` → `templateId/gameId/versionId/versionNo/config`。
- `POST /api/v1/tenant/game-dispatch/template-orders`（header `Idempotency-Key`）→ `orderId/dispatchOrderId/templateVersionId/staffingSummary/priceAdjustmentFen/document`。
- 扩展既有 `GET /api/v1/tenant/game-dispatch/orders/{orderId}`：新增 v2 `document`（`schemaVersion/rows/plainText/generatedFromSnapshotAt`），**不删除、不改类型**已有字段。

若你要求与规格字面一致（`/api/games/...` 前缀），那是一次契约前缀变更，需要连同既有 12 条模板 operation 一起重新设计，我会另出方案。

### D-2 计算值是否独立落库（影响是否触发迁移授权）

`priceAdjustmentFen` 与 `staffingSummary` 在 `game_dispatch_orders` 没有对应列（已核实 `schema.prisma:1173-1195`）。两个选项：

- **方案 A（推荐，零 DDL）**：只持久化 `templateVersionId` + `snapshotId` + `formValuesJson` + 快照 `configJson/schemaVersion`；人数与价格在读取时按发布快照确定性重算（发布配置已含 `documentRendererVersion`）。验收记录里写明「计算值不独立存储」这一边界。
- 方案 B（需迁移授权）：给 `game_dispatch_orders` 增列持久化计算值，用于审计与免重算。属新的 DDL + 迁移，需单独批准。

## 3. 实施地图（文件 → 责任 → 所属 Task）

| 文件                                                                                                          | 责任                                                                        | Task    |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------- |
| `apps/api/src/modules/game-dispatch/domain/game-template-published-read.ts`（新建，+ spec）                   | 生效模板筛选与排序（默认优先、`lastUsedAt` 兜底）、发布配置读取的纯函数     | 1       |
| `apps/api/src/modules/game-dispatch/interface/generic-game-template.controller.ts`（改）                      | 新增 `published` 与 `versions/{versionId}/form` 两个只读 operation          | 1       |
| `apps/api/src/modules/game-dispatch/application/generic-game-template.service.ts`（改）                       | 上述两个 operation 的应用服务方法（租户收敛）                               | 1       |
| `apps/api/src/openapi/schemas.ts`（改）                                                                       | 新 operation 的请求/响应 schema 与 `Idempotency-Key` header 声明            | 1、2、3 |
| `apps/api/src/common/validation/api-validation-rules.ts`（改）                                                | 新路由的 Zod 边界（含 header 校验与 `values` 结构上限）                     | 1、2、3 |
| `apps/api/src/modules/game-dispatch/domain/game-template-order-draft.ts`（新建，+ spec）                      | 纯函数：按发布快照校验 `values`、算人数、算价格调整、生成 `SnapshotPayload` | 2       |
| `apps/api/src/modules/game-dispatch/application/game-dispatch-template-order.service.ts`（新建）              | v2 创建派单：租户/归属校验 → 版本锁定 → 事务写入订单+派单+快照+幂等+审计    | 2       |
| `apps/api/src/modules/game-dispatch/interface/game-dispatch-template-order.controller.ts`（新建）             | `POST /game-dispatch/template-orders`（读 `Idempotency-Key`）               | 2       |
| `apps/api/src/modules/game-dispatch/infrastructure/prisma-game-dispatch-template-order.repository.ts`（新建） | 事务实现（`IdempotencyRecord` 复用、快照写入、`lastUsedAt` 更新）           | 2       |
| `apps/api/src/modules/game-dispatch/application/game-dispatch.service.ts`（改 `view`）                        | 订单详情按快照产出 v2 `document`                                            | 3       |
| `tests/integration/game-dispatch-template-order.spec.ts`（新建）                                              | 主路径、幂等（相同/不同请求体）、归档后拒绝、版本不匹配                     | 2       |
| `tests/tenant-isolation/game-dispatch-template-order.spec.ts`（新建）                                         | 跨租户读写拒绝                                                              | 2、3    |
| `tests/contract/game-dispatch-template-order-v2.spec.ts`（新建）                                              | 契约形状、`Idempotency-Key` 为 header 参数、金额为十进制字符串分            | 2、3    |
| `apps/admin-web/app/_lib/merchant-console/new-order-template-flow.ts`（新建，+ spec）                         | 纯逻辑：阶段状态机、模板切换缓存、幂等键生命周期、错误码映射                | 4       |
| `apps/admin-web/app/_lib/merchant-console/template-order-api.ts`（新建，+ spec）                              | v2 调用封装（复用 S3 `template-api.ts` 的装配与错误模型）                   | 4       |
| `apps/admin-web/app/_lib/merchant-console/new-order-view.tsx`（重写）                                         | 三阶段弹窗（客户+游戏 → 模板 → 表单）与新栈数据请求                         | 4       |
| `apps/admin-web/app/_lib/merchant-console/new-order-dialog.tsx`（改/重写）                                    | 弹窗结构、焦点管理与空状态                                                  | 4       |
| `apps/admin-web/app/_lib/merchant-console/order-detail.tsx`（改）                                             | 按订单快照渲染自动文案 + 复制按钮                                           | 5       |
| `tests/e2e/merchant-console-admin.spec.ts`（改）                                                              | 新增 `test.describe("S4 新建派单主路径（真实本地 API）")`                   | 6       |
| `work/s4-e2e-seed.mjs`（新建）                                                                                | 一次性夹具（同库守卫 + 门店/账号/游戏，模板由用例经真实 API 创建并发布）    | 6       |
| `docs/acceptance/2026-09-16-s4-new-order-snapshot.md`（新建）                                                 | S4 验收记录                                                                 | 6       |

## 4. Task 0（只读预检）

Objective: 在不改动任何文件的前提下确认基线可执行，并锁定 D-1/D-2。

- [x] 复核 §1 事实表的每一行（逐条读文件/行号），确认无漂移。
- [x] 跑基线门禁并记录退出码：`corepack pnpm --filter @pw/api typecheck`、`corepack pnpm --filter @pw/admin-web typecheck`、`corepack pnpm --filter @pw/api-client build`。
- [x] 跑既有相关测试确认基线绿：`& '.\node_modules\.bin\vitest.cmd' run --config vitest.config.ts apps/api/src/modules/game-dispatch/domain`、`& '.\node_modules\.bin\vitest.cmd' run --config tests/vitest.integration.config.ts tests/integration/game-dispatch-flow.spec.ts`。
- [x] 确认一次性测试库存在且空白夹具可用：`node work/s3-e2e-seed.mjs seed` 后 `select count(*) from game_dispatch_templates`（只读查询）。
- [x] 输出 D-1、D-2 的待定结论给人的确认；未确认前不进入 Task 1。

Verification: 上述命令的退出码与输出被记录；文件零改动（`git status` 与开始时一致）。

Rollback: 无副作用；如启动过服务需停止进程并清理夹具。

## 5. Task 1 生效模板选取与发布表单读取

Objective: 门店能拿到「该游戏可派单的模板」和「某个发布版本的表单配置」，且不泄露其他租户数据。覆盖 §8.2 前两条、§10 阶段一/二、§15 验收 2。

Preconditions / gates: 需要 P1（生成契约）与 P2（测试库）确认；需要 D-1 已定。

Interfaces produced（共享给 Task 2/4）：

- `PublishedTemplateSummary { templateId: string; name: string; description: string | null; versionId: string; versionNo: number; isDefault: boolean; lastUsedAt: string | null }`
- `PublishedTemplateForm { templateId: string; gameId: string | null; versionId: string; versionNo: number; config: PublishedConfigV2 }`
- 生成客户端函数名固定为 `genericGameTemplatePublishedList` 与 `genericGameTemplateVersionForm`。

Steps:

- [x] 先写失败用例：`apps/api/src/modules/game-dispatch/domain/game-template-published-read.spec.ts`，断言默认模板排首位、无默认时按 `lastUsedAt` 倒序、`archived`/无 `activeVersionId` 的模板被排除。
- [x] 先写失败集成用例：`tests/integration/game-dispatch-template-order.spec.ts` 中「未实现时返回 404」的骨架，随后在 Task 2 扩充为完整用例（本 Task 只保留列表与表单读取两条）。
- [x] 在 `apps/api/src/openapi/schemas.ts` 增加两个 operation 的响应 schema（只读，无请求体；`gameId` 为 uuid query）。
- [x] 在 `apps/api/src/common/validation/api-validation-rules.ts` 增加：
      `GET /api/v1/tenant/game-dispatch-templates/published`（query：`gameId` uuid 必填）与
      `GET /api/v1/tenant/game-dispatch-templates/versions/:versionId/form`（path：`versionId` uuid）。
- [x] 在 `generic-game-template.controller.ts` 增加两个方法，权限沿用模板读权限 `gameTemplate.view`，插入 `@TenantScope()`。
- [x] 在 `generic-game-template.service.ts` 增加两个方法，租户来源一律 `req.principal.tenantId`，实例查询首参 `tenantId`。
- [x] 运行 `corepack pnpm openapi:generate`（P1）并确认新函数出现在 `packages/api-client/src/sdk.gen.ts`、header/参数形状正确。
- [x] 跑集成与契约测试，确认跨租户 404/403 与「未归档且有生效版本」筛选生效。

Focused verification:

- `corepack pnpm --filter @pw/api typecheck` → 0
- `& '.\node_modules\.bin\vitest.cmd' run --config vitest.config.ts apps/api/src/modules/game-dispatch/domain` → 新增 spec 通过
- `& '.\node_modules\.bin\vitest.cmd' run --config tests/vitest.integration.config.ts tests/integration/game-dispatch-template-order.spec.ts` → 读取两条通过
- 手工证据：`GET .../published?gameId=<uuid>` 对「有默认模板」与「无默认模板」两个夹具返回顺序正确

Rollback: 删除两个 operation 的注册即回到现状；无数据写入、无 DDL。

## 6. Task 2 锁定版本创建派单（服务端计算 + 快照 + 幂等）

Objective: 用 `gameId + templateId + templateVersionId + values + Idempotency-Key` 创建一个锁定该发布版本的派单，人数与价格由服务端按快照计算。覆盖 §8.2 第三条、§8.3 幂等与错误码、§11.1/11.2、§15 验收 4/10。

Preconditions / gates: P1、P2、P3；依赖 Task 1 的 `PublishedTemplateForm` 与 D-2 结论（默认方案 A）。

Interfaces produced：

- `CreateTemplateOrderInput { gameId: string; templateId: string; templateVersionId: string; customerProfileId: string; values: Record<string, unknown>; desiredStartAt?: string | null; durationMinutes?: number }`
- `CreateTemplateOrderResult { orderId: string; dispatchOrderId: string; templateVersionId: string; staffingSummary: { total: number; rows: { label: string; count: number }[] }; priceAdjustmentFen: string; document: { schemaVersion: 2; rows: ...; plainText: string } }`
- 错误码复用既有：`TEMPLATE_VERSION_UNAVAILABLE`、`TEMPLATE_COMPONENT_INVALID`、`TEMPLATE_BINDING_INVALID`、`TEMPLATE_PRICE_RULE_INVALID`、`TEMPLATE_ARCHIVED`。

Steps:

- [x] 先写领域失败用例 `game-template-order-draft.spec.ts`：按发布快照拒绝未声明组件/未知 stableKey/类型不符/越界数组；`NOTE` 不接收值；人数取 `staffingSource`（FIXED / NUMBER_FIELD / REPEATABLE_TABLE_SUM）；价格调整取选项加价整数分求和；客户端传入的最终人数/价格字段一律忽略或 422。
- [x] 先写集成失败用例：同 key 同请求返回原结果；同 key 不同请求 422；处理中重复 409；归档模板创建被拒（`TEMPLATE_ARCHIVED`）；版本不属于该模板或不可用（`TEMPLATE_VERSION_UNAVAILABLE`）。
- [x] 在 `schemas.ts` 增加 `POST /api/v1/tenant/game-dispatch/template-orders` 的 body/响应 schema，并在该 operation 上声明 header 参数 `Idempotency-Key`（必填，8–100 字符），生成后确认 `openapi.yaml` 出现 `in: header`、`sdk.gen.ts` 出现对应参数。
- [x] 在 `api-validation-rules.ts` 增加该路由的 `body`（严格对象，未知字段拒绝）与 header 校验。
- [x] 新建 `game-template-order-draft.ts`：纯函数产出 `{ values, staffingSummary, priceAdjustmentFen, snapshot }`，不触碰 Prisma/Nest。
- [x] 新建 `prisma-game-dispatch-template-order.repository.ts`：单事务内 `lockTemplate`（按模板行锁）→ 校验 `activeVersionId === templateVersionId` → 写 `orders`（`processType: "GAME_DISPATCH"`）→ 写 `game_dispatch_orders`（`gameId/templateVersionId/snapshotId/formValuesJson`）→ 写 `game_dispatch_template_snapshots`（`configJson` + `schemaVersion: 2`）→ 写 `IdempotencyRecord`（`operation: "create-template-order"`）→ 写审计。
- [x] 新建 `game-dispatch-template-order.service.ts` 与控制器；控制器用 `@Headers("idempotency-key")` 读取并做非空校验，权限用 `gameDispatch.manage`。
- [x] 幂等语义按 §8.3 实现：命中同 key 且请求体哈希一致 → 返回首次结果；哈希不一致 → 422；`in_flight` → 409。
- [x] 更新订单可用模板的 `lastUsedAt`（与事务同源），供 Task 1 的排序使用。
- [x] 跑领域、集成、租户隔离、契约四类测试。

Focused verification:

- `& '.\node_modules\.bin\vitest.cmd' run --config vitest.config.ts apps/api/src/modules/game-dispatch/domain` → 0
- `& '.\node_modules\.bin\vitest.cmd' run --config tests/vitest.integration.config.ts tests/integration/game-dispatch-template-order.spec.ts` → 0（含幂等三态与归档拒绝）
- `& '.\node_modules\.bin\vitest.cmd' run --config tests/vitest.tenant-isolation.config.ts tests/tenant-isolation/game-dispatch-template-order.spec.ts` → 0
- `& '.\node_modules\.bin\vitest.cmd' run --config tests/vitest.contract.config.ts tests/contract/game-dispatch-template-order-v2.spec.ts` → 0
- 手工证据：同一 `Idempotency-Key` 连发两次，`game_dispatch_orders` 只增加 1 行（`select count(*)`）

Rollback: 关闭该 operation 的注册即可停止新入口；已写入的订单与快照保留（规格 §17：回退不删版本、不改写已创建订单）；零 DDL。

## 7. Task 3 订单详情按快照产出自动文案

Objective: 订单详情读自己的快照与值生成结构化表格与纯文本，不读当前模板。覆盖 §8.2 最后一条、§11.1 历史订单、§15 验收 11/12。

Preconditions / gates: P2；依赖 Task 2 的写入形状与 `game-template-document` 领域件。

Steps:

- [x] 先写失败集成用例：创建订单后，即使把模板改名/再发布 v2，订单详情的 `document` 仍与创建时一致（字节级断言 `plainText`）。
- [x] 在 `game-dispatch.service.ts` 的 `view` 路径上，对 `schemaVersion === 2` 的快照调用 `game-template-document` 渲染，产出 `document: { schemaVersion, rows, plainText, generatedFromSnapshotAt }`；`schemaVersion !== 2` 保持旧结构不变。
- [x] 在 `schemas.ts` 扩展既有 `GET /api/v1/tenant/game-dispatch/orders/{orderId}` 响应：**新增** `document` 字段，旧字段原样保留。
- [x] 契约测试断言：新字段存在、旧字段未被移除或改类型、响应不含内部 `semanticRole` 或数据库列名。
- [x] 跑集成、契约、租户隔离测试。

Focused verification:

- `& '.\node_modules\.bin\vitest.cmd' run --config tests/vitest.integration.config.ts tests/integration/game-dispatch-flow.spec.ts` → 0（旧链路不回归）
- 新增用例通过；`corepack pnpm openapi:check` 的真实状态被如实记录（若产物未提交则为非 0，必须写明原因）

Rollback: 移除 `document` 字段的产出即回到现状；无数据变更、无 DDL。

## 8. Task 4 前端三阶段弹窗（新栈）

Objective: 门店在弹窗内完成「客户+游戏 → 模板 → 表单 → 创建」，含默认模板优先、切换告警与会话缓存、服务端计算展示、幂等键生命周期与空状态。覆盖 §10、§11.2、§15 验收 2/10/13/16。

Preconditions / gates: P2、P3；依赖 Task 1/2 的契约与生成客户端；`pw-frontend-ui` 判型后按该环节唯一 skill 执行（S3 同类页面的判型结论是模式 B → `vercel-react-best-practices`；进入该环节时重新判型并记录）。

Steps:

- [x] 先写失败单测 `new-order-template-flow.spec.ts`：阶段推进/回退、切换模板时 `confirmDiscard` 语义、会话缓存按 `templateVersionId` 存取、切回恢复、成功或重置后换新幂等键、重试复用同键、错误码 → 用户文案映射（`TEMPLATE_ARCHIVED`/`TEMPLATE_VERSION_UNAVAILABLE`/409/422）。
- [x] 新建 `template-order-api.ts`，复用 S3 `template-api.ts` 的 client 装配模式（`configureTemplateClient` 已存在，勿重复装配）。
- [x] 重写 `new-order-view.tsx`：TanStack Query 取客户、游戏、`published` 模板、版本表单；不再调用 `/api/v1/tenant/game-templates` 旧接口。
- [x] 按发布快照渲染普通字段、说明与可重复表格；渲染逻辑复用 S3 的 `template-form-renderer.tsx` 与 `form-layout.ts`，不得另写一套。
- [x] 展示服务端返回的 `staffingSummary` 与 `priceAdjustmentFen`（元换算仅用于展示）；前端不得计算或提交最终人数/价格。
- [x] 弹窗行为：提交中禁用创建按钮；表单值与客户信息不写入 URL 与 `localStorage`；无已发布模板时给空状态与带 `gameId` 的模板管理入口。
- [x] 更新 `new-order-dialog.tsx` 的结构与焦点管理（打开/关闭焦点返回、Esc 关闭、`aria-live` 校验播报）。
- [x] 保留旧 mock 用例可运行的边界：既有 `openMockedNewOrder` 相关用例若因接口变化失效，按新契约调整断言，不得删除覆盖。

Focused verification:

- `& '.\node_modules\.bin\vitest.cmd' run --config vitest.config.ts apps/admin-web/app/_lib/merchant-console` → 0
- `corepack pnpm --filter @pw/admin-web typecheck` → 0
- `corepack pnpm --filter @pw/admin-web build` → 0
- Playwright：`& '.\node_modules\.bin\playwright.cmd' test --project=admin tests/e2e/merchant-console-admin.spec.ts -g "S4 新建派单"` → 0（Task 6 建立用例后回填）

Rollback: 页面保留旧入口开关（不删旧组件导出），必要时切回旧实现；无数据边界变更。

## 9. Task 5 订单详情自动文案与复制

Objective: 详情页展示快照生成的文案表格与纯文本，复制内容只来自订单快照。覆盖 §10 最后一条、§15 验收 11。

Steps:

- [x] 先写失败用例：`template-document-preview.spec.ts` 已有渲染器，新增「订单快照 → 行/纯文本」的映射单测（含未知旧组件的安全占位）。
- [x] 改 `order-detail.tsx`：优先渲染服务端 `document`；无 `document`（旧订单）时回退旧字段，不报错。
- [x] 增加「复制派单文案」按钮，复制失败走提示分支；文案不进入 URL。
- [x] 无障碍：复制按钮有可访问名称，复制结果通过 `aria-live` 播报。

Focused verification:

- 单测 0；`corepack pnpm --filter @pw/admin-web typecheck` 0；`build` 0
- Playwright 详情断言纳入 Task 6 主路径

Rollback: 关闭按钮即回到只读展示；无数据变更。

## 10. Task 6 E2E 主路径与验收记录

Objective: 用真实本地 API 证明多游戏主路径可用，并产出 S4 验收记录。覆盖 §14 端到端要求与 handoff §11「不能用 mock API 宣称完成联调」。

Preconditions / gates: P2、P3；全部前序 Task 通过。

Steps:

- [x] 新建 `work/s4-e2e-seed.mjs`：沿用 `work/s3-e2e-seed.mjs` 的库名守卫（只允许 `pw_saas_s2_task2_20260916`），创建门店 `s4e2e`、账号、两个游戏；模板与发布版本由**用例经真实 API** 创建，不在夹具里复制领域逻辑。
- [x] 在 `merchant-console-admin.spec.ts` 增加 `test.describe("S4 新建派单主路径（真实本地 API）")`：
      ① 用真实 API 建两个游戏各一个模板并发布；
      ② 新建派单：选客户与游戏 A → 只看到 A 的模板 → 默认模板排首位 → 按快照渲染表单 → 填可重复表格与选项 → 创建成功；
      ③ 断言服务端返回人数与价格调整，且与快照配置一致；
      ④ 同一意图连点两次只产生一个订单（幂等）；
      ⑤ 模板归档后再创建被拒且保留用户输入；
      ⑥ 订单详情文案与创建时一致（改名/再发布后仍不变）。
- [x] 写 `docs/acceptance/2026-09-16-s4-new-order-snapshot.md`：真实命令与退出码、测试库与夹具、契约 operation 清单（含 `Idempotency-Key`）、未验证项与降级（无视觉回归、无真机触控、D-2 方案 A 的计算值不独立存储、S5 才做开关与灰度）。
- [x] 收尾：`node work/s4-e2e-seed.mjs clean`、停止 API/admin 进程、确认端口释放与库内无残留。

Focused verification:

- `& '.\node_modules\.bin\playwright.cmd' test --project=admin tests/e2e/merchant-console-admin.spec.ts -g "S4 新建派单"` → 0
- 数据库只读核对：`game_dispatch_orders` 行数、快照 `config_json -> 'schemaVersion'` = 2、`idempotency_records` 计数与请求意图一致

Rollback: 删除夹具租户；关闭 v2 入口即停止使用；已创建订单保留。

## 11. 执行顺序与并行边界

1. Task 0 → D-1/D-2 确认 → Task 1 → Task 2 → Task 3 必须串行（同模块且共享契约产物）。
2. Task 4 依赖 Task 1/2；Task 5 依赖 Task 3；两者都改 admin 的 dispatch 相关组件与同一份 E2E 文件，**不得并行**。
3. Task 6 必须在前序全部有证据后执行。
4. 每个 Task 结束必须报告：改动文件、命令与退出码、未验证项；不得把「代码已改」表述为「已通过」。

## 12. 停止点与后续

- 本计划只覆盖 S4；S5（开关、指标、灰度与兼容收口）需要新的计划与授权。
- 计划获批后才进入实施；实施前需要一次明确的授权，包含：允许修改的文件范围、允许使用的测试库、是否允许生成 OpenAPI 产物、是否允许启动本地服务、是否需要 DDL。
- D-1 未定或 D-2 选择方案 B 时，Task 1/2 不得开始。

# ADR-0005：订单状态机收编（表对齐现实 + 接入强制 + 迁移事件统一）

- 状态：**草稿（待批准）** —— 批准前只做只读核对，不改任何状态迁移行为。
- 日期：2026-09-21
- 关联：设计规格主规格 10.1 / 11.3；ADR-0002（CLASSIC 冻结）；ADR-0003 / ADR-0004（算价模型）

## 背景（2026-09-21 只读核对）

`apps/api/src/modules/orders/domain/order-state-machine.ts` 定义了集中迁移表与
`assertOrderTransition`，但**全仓没有任何调用点**；真正的状态迁移散落在各模块里，
且与那张表不一致：

| 模块 / 位置 | 实际迁移 |
| --- | --- |
| `orders/infrastructure/prisma-orders.repository.ts`（确认 / 取消） | → `CONFIRMED`、→ `CANCELLED` |
| `dispatch/infrastructure/prisma-dispatch.repository.ts`（经典派单发布 / 选人） | → `DISPATCHING`、→ `ASSIGNED` |
| `service-sessions/infrastructure/prisma-sessions.repository.ts`（经典场次） | → `READY`、→ `IN_PROGRESS`（两处）、→ `PENDING_CONFIRMATION`（条件：必须已是 `IN_PROGRESS`） |
| `game-dispatch/application/game-dispatch.service.ts`（game-dispatch 主线） | → `DISPATCHING`（发布、释放名额）、→ `ASSIGNED`（选人）、→ `IN_PROGRESS`（开始服务）、→ `PENDING_CONFIRMATION`（结束服务）、→ `COMPLETED`（确认结算） |
| `background/worker.ts`（无人报名自动关单） | `DISPATCHING` → `CANCELLED`（system actor，条件更新） |
| `ledger/infrastructure/prisma-ledger.repository.ts`（经典核算闭环） | → `COMPLETED` |

与冻结表的三处实质分歧（表里没有、代码里在做）：

1. **`DRAFT → DISPATCHING`**：game-dispatch 的 `publish` 允许 `DRAFT`/`CONFIRMED` 直接发布（跳过 `CONFIRMED`）；
2. **`ASSIGNED → IN_PROGRESS`**：game-dispatch 的 `startSlot` 直接从 `ASSIGNED` 开始服务（经典路径才经过 `READY`）；
3. **`ASSIGNED → DISPATCHING`**：商家「释放名额」（Task 4）把订单退回报名阶段。

另有两处**迁移事件缺失**（表要求状态可追溯，但这两步只更新了订单状态、没写 `order_events`）：
`game-dispatch.service.ts` 的 `startSlot`（→ `IN_PROGRESS`）与 `endSlot`（→ `PENDING_CONFIRMATION`）。

## 约束

- 订单状态与金额路径耦合：迁移错误会直接影响结算口径（ADR-0004）与老板钱包扣费。
- 并发语义不得放松：现有实现依赖**条件更新 / 行锁**保证「关单与报名只有一方成功」。
- 三端（admin-web、移动端老板/陪玩）都有状态文案映射，强制后新增的 409 必须有可解释的文案。
- 历史订单的既有状态不回写；本 ADR 只约束之后的迁移。

## 候选方案

| 方案 | 做法 | 取舍 |
| --- | --- | --- |
| **A（建议）** | 表对齐现实（补 3 条实际迁移）→ 补两处缺失的 `order_events` → 再按模块逐步接入 `assertOrderTransition` | 一步一变、可回退；先做「无行为变化」的两步，再做会引入 409 的强制 |
| B | 保持现状，只在本 ADR 登记差异 | 零风险，但"两套真相"会随每个新切片继续扩大 |
| C | 重新设计状态集（例如合并 `READY`、拆 `PENDING_CONFIRMATION`） | 会动经典流程与三端文案，超出本轮收益 |

选 A。

## 待批准项（4 条，附建议）

1. **表与现实的边界 —— 建议 A**：`ORDER_TRANSITIONS` 补 `DRAFT → DISPATCHING`、`ASSIGNED → IN_PROGRESS`、`ASSIGNED → DISPATCHING`；`READY` 保留为**经典流程的可选中间态**（`ASSIGNED → READY → IN_PROGRESS`），不要求 game-dispatch 走它。
2. **接入强制的顺序 —— 建议 A（两步走）**：
   第一步（无行为变化）：表对齐 + 补事件 + 新增只读核对用例（对每一条实际迁移断言表内合法）；
   第二步（会变行为）：在 `orders` 仓库、`service-sessions` 仓库、`game-dispatch` 服务与 worker 关单处接入 `assertOrderTransition`，把表外迁移统一转成 409 `ORDER_STATE_CONFLICT`，并跑通全套门禁。
3. **迁移事件统一 —— 建议 A**：所有订单状态迁移都必须写 `order_events`（补 `startSlot` / `endSlot` 两处；`actorType` 用 `tenant_account` / `system` 区分），审计沿用既有 `audit_logs`，不新建事件表。
4. **前端文案与错误语义 —— 建议 A**：`CANCELLED` / `COMPLETED` / 退回 `DISPATCHING` 的文案集中在既有映射表（`apps/admin-web/app/_lib/merchant-console/merchant-api.ts` 的 `STATUS_TEXT`、移动端 `ORDER_STATUS` 映射），强制后新增的 409 文案由后端 `message` 直出，保持"服务端为准"。

## 影响面（若按建议落地）

- 代码：`orders/domain/order-state-machine.ts`（表）、`orders` / `service-sessions` / `game-dispatch` 三处迁移点、`background/worker.ts`、以及两处补 `order_events`。
- 用例：`tests/integration/order-state-machine.spec.ts`（现有断言基于冻结表，需按新表更新）、`game-dispatch-flow.spec.ts`、`slot-report.spec.ts`、`order-auto-close.spec.ts`、`outbox-worker-tick.spec.ts`、`ledger-invariants.spec.ts`；E2E `pricing-slot-report` 的状态文案断言（「人数已足够」「已释放名额…」等）不受影响，但需复跑确认。
- 契约：无新增 operation；若第二步把错误码显式化（409 + 文案），`openapi` 无需变更。

## 迁移方式（批准后按此实现，两个切片）

1. **切片一（表对齐 + 事件补齐，无行为变化）**
   - 扩充 `ORDER_TRANSITIONS` 三条实际迁移并加注释说明来源；
   - `startSlot` / `endSlot` 补写 `order_events`（`GAME_DISPATCH_SESSION_STARTED` / `..._ENDED` 或沿用现有命名约定）；
   - 新增 `tests/integration/order-state-machine-table.spec.ts`：逐条断言「代码里发生的迁移 ⊆ 表」。
2. **切片二（接入强制）**
   - 在四处迁移点接入 `assertOrderTransition`，表外迁移 → 409；
   - 更新受影响用例，跑全套门禁 + 两个 E2E project；
   - 走查复验（派单详情 / 场次详情 / 移动端服务页的状态文案）。

## 回滚方式

- 切片一只加迁移与事件：回退代码即恢复（新增的事件行保留，无副作用）。
- 切片二回退即取消强制，回到"直接更新订单状态"的现状；历史状态不回写。

## 验证证据（落地时补齐）

- 表对齐用例的实际输出与退出码；
- 接入强制后的集成 / 租户隔离 / 契约 / 单测结果，以及两个 E2E project 的复跑；
- 走查截图（状态文案与 409 提示）。

## 批准记录

- 待批准（2026-09-21 起草）。批准时请逐条确认上面 4 个待批准项，或指出要调整的选项。

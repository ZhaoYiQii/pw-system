# P3 收口 Implementation Plan

Goal: 落地已批准的 4 项 P3 决策——报名/关单窗口统一（D4）、报单审批时长对照展示（D2）、陪玩违约只读台账（D3）、固定价最小版（D1）。

Architecture: D4 把「报名窗口」抽成 game-dispatch 领域层的纯函数配置源，服务与 worker 共用；D2 只改 admin-web 展示层（后端字段已存在）；D3 在既有 `player_breach_records` 与列表端点上加筛选/分页，前端走既有导航注册表；D1 在既有 `assign` 流程上增加可选固定价，落既有 `order_slots.unit_price_fen` 快照 + `audit_logs`，不改表结构。

Tech stack: Node 24.19.0、pnpm 10.34.5（corepack）、NestJS、Prisma 7 + `@prisma/adapter-pg`、PostgreSQL 18、Vitest 3、Playwright、Next.js（admin-web，Tailwind v4）。

Spec: `docs/superpowers/specs/2026-09-21-p3-fixed-price-and-ops-closeout-design.md`（用户 2026-09-21「按现有规格走」）；固定价另有 `docs/adr/0006-fixed-price-minimal.md`（已批准）。

Scope and non-goals: 只做上述四项。**不做**：固定价的规则库/批量形态、时长自动判定与标记列、违约撤销/申诉/封禁与 CSV 导出、报名窗口门店级自助配置、平台抽成、CLASSIC 冻结流程改造、结算公式与账本结构改动。

**本计划不含任何数据库迁移**（四项都不新增表/列）；因此没有迁移与回滚门禁。

Permission gates（每一步都需单独授权）：

- 在本地一次性测试库（`pw_saas_s2_task2_20260916`）跑集成/E2E 夹具（`work/s5c-walkthrough-seed.mjs`）与清理；
- 创建分支、提交、推送；
- 安装依赖或 Playwright 浏览器；
- 启动/停止本机容器与服务（E2E 三件套）。

Completion evidence（每片必须给出）：

- 该片「先红」的失败证据（新用例在改动前失败的实际输出）；
- 聚焦验证命令的实际输出与退出码；
- `corepack pnpm lint`、`corepack pnpm typecheck`、`node node_modules/prettier/bin/prettier.cjs --check .` 的退出码；
- 涉及契约的片：`corepack pnpm openapi:check`；
- 涉及 UI 的片：对应 Playwright project 的通过结果与基线。

## 项目约束（沿用规格，逐条照抄）

- 金额一律 bigint 分，禁止浮点；尾差归陪玩（`splitSettlement`）。
- 每个租户资源必须在服务端绑定 `TenantContext`，禁止信任客户端提交的 `tenantId`。
- API 契约来自 OpenAPI，生成客户端不得手工修改。
- 状态变化、金额调整、结算与外部副作用必须满足幂等、事务、并发与审计要求。
- 移动端业务代码必须同时面向 H5 与 weapp（本计划不涉及移动端改动）。
- 前端新页面一律用新栈（Tailwind v4 token + shadcn 风格组件 + TanStack Query）。

## Task 1（Slice 1）：D4 报名窗口统一

Spec: §7（含行为变更：默认关单窗口 5 → 10 分钟）。

Objective: 报名窗口与关单窗口来自同一配置源，两处硬编码 10 分钟消失。

Files:

- 新增 `apps/api/src/modules/game-dispatch/domain/dispatch-window.ts`
- 新增 `apps/api/src/modules/game-dispatch/domain/dispatch-window.spec.ts`
- 改 `apps/api/src/modules/game-dispatch/application/game-dispatch.service.ts`（`publish` 的轮次创建、`releaseSlot` 的重新开放轮次）
- 改 `apps/api/src/background/bootstrap.ts`（关单窗口默认值取同一函数）
- 改 `apps/api/src/background/worker.ts`（`autoCloseUnstaffedOrders` 的注释「默认 5 分钟」改为默认取报名窗口）
- 改 `tests/integration/order-auto-close.spec.ts`（文档注释与依赖默认值的断言）
- 改 `.env.example`、`infra/docker/env.prod.example`、`infra/docker/docker-compose.prod.yml`（新增 `DISPATCH_ROUND_WINDOW_MS`）
- 改 `docs/runbooks/env-inventory.md`（新增变量、更新关单窗口默认值口径）
- 改 `docs/specs/算价模型-设计规格-v0.1.md` §3.5 一行（「默认 5 分钟」指向 P3 规格的新口径，避免两份真相）

Interfaces（新增，供 Task 1 内部与 worker 使用）:

- `export const DEFAULT_ROUND_WINDOW_MS = 600_000;`
- `export const MIN_ROUND_WINDOW_MS = 60_000;` / `export const MAX_ROUND_WINDOW_MS = 7_200_000;`
- `export function resolveRoundWindowMs(env: NodeJS.ProcessEnv): number`（缺省/非法/越界 → 默认值）
- `export function resolveNoApplicationTimeoutMs(env: NodeJS.ProcessEnv): number`（未配置 → `resolveRoundWindowMs`；显式 `0` → 0（关闭）；非法/负数 → 视为未配置）

Steps:

- [ ] 先写 `dispatch-window.spec.ts`：缺省=600000、合法值生效、越界回退、非数字回退、`0` 语义、以及 `resolveNoApplicationTimeoutMs` 未配置时等于报名窗口。
- [ ] 跑 `corepack pnpm test` 确认新用例失败（红）。
- [ ] 实现 `dispatch-window.ts` 使用例转绿。
- [ ] 在 `game-dispatch.service.ts` 两处 `closesAt` 改用 `resolveRoundWindowMs(process.env)`；保持其余行为不变（轮次号、状态、审计都不动）。
- [ ] 在 `bootstrap.ts` 用 `resolveNoApplicationTimeoutMs(process.env)` 取代 `?? 5 * 60 * 1000` 兜底。
- [ ] 更新 `order-auto-close.spec.ts`：把「默认 5 分钟」表述改为「默认与报名窗口一致」；用例继续显式注入短窗口，不依赖默认值。
- [ ] 集成验证：窗口内报名成功；把 `DISPATCH_ROUND_WINDOW_MS` 注入短值（如 2000ms）时，超窗报名被拒（409）；无人报名在短窗口后由 tick 关单（system actor + `order_events` + 审计 + Outbox）。
- [ ] 同步 4 个配置/文档文件（见 Files）。

Verification:

- `corepack pnpm test`（新单测通过）
- `node node_modules/vitest/vitest.mjs run --config tests/vitest.integration.config.ts tests/integration/order-auto-close.spec.ts tests/integration/game-dispatch-flow.spec.ts`
- `corepack pnpm lint`、`corepack pnpm typecheck`、`prettier --check .`

Rollback: 回退代码与新增 env（默认回到 5 分钟语义）——本片无持久化副作用。

## Task 2（Slice 2）：D2 报单审批「时长对照」

Spec: §5。

Objective: 审批界面显示申报时长 vs 证据计时（含阈值高亮），不改变结算与审批结果。

Files:

- 新增 `apps/admin-web/app/_lib/merchant-console/duration-gap.ts`（纯函数）
- 新增 `apps/admin-web/app/_lib/merchant-console/duration-gap.spec.ts`
- 改 `apps/admin-web/app/_lib/merchant-console/record-detail-view.tsx`（「报单审批」区块，含 `session.reportStatus` / 「申报 / 核定时长」定义处）

Interfaces:

- `export function durationGap(declaredMinutes: number, durationSeconds: number | null): { deltaMinutes: number | null; tone: "ok" | "warn" | "unknown" }`（`durationSeconds === null` → tone `unknown`）
- 阈值常量：`export const GAP_ABS_MINUTES = 10;` / `export const GAP_RATIO = 0.15;`
- 判定：`tone = "warn"` 当且仅当 `durationSeconds !== null && Math.abs(deltaMinutes) > Math.max(GAP_ABS_MINUTES, GAP_RATIO * declaredMinutes)`。

Steps:

- [ ] 先写 `duration-gap.spec.ts`：正好 10 分钟（不 warn）、10.1 分钟（warn）、正好 15%（不 warn）、15% 以上（warn）、`durationSeconds=null`（unknown）、`declaredMinutes=0` 保护（unknown 或 ok，用例写死为 unknown）。
- [ ] 跑 `corepack pnpm test` 确认失败（红）。
- [ ] 实现 `duration-gap.ts`。
- [ ] 在报单审批视图渲染对照区（申报 / 证据 / 差值 + warn 文案「与证据计时差异较大，请重点核对开始/结束截图」），样式沿用现有 token；不新增后端调用。
- [ ] E2E：在 `tests/e2e/pricing-slot-report.spec.ts`（project `pricing-slot-report`）的审批用例中断言对照区文案存在；如引入新视觉元素则补基线截图。

Verification:

- `corepack pnpm test`（新单测）
- `corepack pnpm --filter @pw/admin-web typecheck`
- `corepack pnpm build`（Next 构建通过）
- E2E（需先跑夹具）：`node node_modules/@playwright/test/cli.js test --project=pricing-slot-report`

Rollback: 回退前端文件；无数据影响。

## Task 3（Slice 3）：D3 陪玩违约只读台账页

Spec: §6。

Objective: 商家端可跨订单查违约台账（时间/陪玩/订单筛选 + offset 分页），只读、可点进订单。

Files:

- 改 `apps/api/src/modules/game-dispatch/application/player-breach.service.ts`（`list` 增加 `from`/`to`/`offset`；响应仍为 `{ data: [...] }`，**不返回总数**）
- 改 `apps/api/src/modules/game-dispatch/interface/game-dispatch.controller.ts`（`GET player-breaches` 增加 `from`/`to`/`offset` query 与 `@ApiQuery` 声明；非法日期或 `from > to` → 400）
- `apps/api/src/openapi/schemas.ts` **不改**（response 复用既有 `playerBreachItemSchema`）
- 新增 `tests/integration/player-breach-ledger.spec.ts`
- 改 `apps/admin-web/app/_lib/merchant-console/modules.ts`（新增 module `breaches`）
- 改 `apps/admin-web/app/_lib/merchant-console/module-view.tsx`（新增视图分支：筛选栏 + 台账表 + 分页）
- 改 `apps/admin-web/app/_lib/merchant-console/merchant-api.ts`（新增 `PlayerBreachRow` 类型；请求直接用既有 `apiFetch`，不新增封装层）
- 改 `tests/e2e/merchant-console-admin.spec.ts`（新增台账页用例与基线，project `admin`）

Interfaces:

- 契约：`GET /api/v1/tenant/game-dispatch/player-breaches?from&to&playerId&orderId&offset&limit`
- 校验：非法 `from`/`to` 或 `from > to` → 400；`offset < 0` → 400；`limit` 越界取 1..100（默认 20）。
- 响应：仍为 `{ data: [...] }`。

Steps:

- [ ] 先写 `player-breach-ledger.spec.ts`：造 3 条不同陪玩/时间的违约记录；断言时间范围筛选、陪玩筛选、订单筛选、`offset` 分页、非法日期 400、租户隔离（他店记录不可见）。
- [ ] 跑聚焦集成命令确认失败（红）。
- [ ] 实现 service/controller 的筛选与分页，跑至绿。
- [ ] `corepack pnpm openapi:check` 同步产物（新增 query 参数）。
- [ ] 前端：注册 module + 视图（筛选、表格、分页、跳订单），保持新栈约定（TanStack Query）。
- [ ] 单测：若有纯逻辑（筛选参数序列化/分页计算）加 `apps/admin-web/app/_lib/merchant-console/*.spec.ts`。
- [ ] E2E：台账页筛选与分页 + 视觉基线。

Verification:

- 聚焦集成命令（上面同一套 env）与 `corepack pnpm test:tenant-isolation`
- `corepack pnpm test:contract`、`corepack pnpm openapi:check`
- `corepack pnpm --filter @pw/admin-web typecheck`、`corepack pnpm build`
- E2E：`--project=admin`（需夹具）

Rollback: 回退前后端与本片用例；只读功能，无数据影响。

## Task 4（Slice 4）：D1 固定价最小版

Spec: §4；ADR: `docs/adr/0006-fixed-price-minimal.md`。

Objective: 商家端选人时可选填本单固定价，覆盖该档位单价（跳过加价），带审计与余额口径一致。

Files:

- 改 `apps/api/src/modules/game-dispatch/application/game-dispatch.service.ts`（`assign`：解析/校验 `fixedPrices`、快照写入、余额预估改用固定价、审计）
- 改 `apps/api/src/modules/game-dispatch/interface/game-dispatch.controller.ts`（商家端 assignment 读取并传入 `fixedPrices`；老板端端端点保持只读 `applicationIds`）
- 改 `apps/api/src/openapi/schemas.ts`（新增 `assignmentBodySchema`，含 `applicationIds` 必填与 `fixedPrices` 可选）
- 新增 `tests/integration/slot-fixed-price.spec.ts`
- 改 `apps/admin-web/app/_lib/merchant-console/`（选人界面新增固定价输入 + 二次确认；展示已填固定价）
- 改 `tests/e2e/pricing-slot-report.spec.ts`（派单详情填固定价 → 单价显示固定价，含基线）

Interfaces:

- 入参：`fixedPrices?: { applicationId: string; unitPriceFen: string }[]`
- 校验：整数分（正则 `^[0-9]+$`）、`1..1000000`；不在本次 `applicationIds` → 400；`applicationId` 不属该单或非 `APPLIED` → 409。
- 语义：命中固定价 → `order_slots.unit_price_fen = 固定价`（跳过加价；低于底价允许）；未命中 → 走既有 `resolveUnitPriceFen`。
- 审计：`game_dispatch.slot_fixed_price`（`resourceType="slot"`，summary 含 `from → to` 与可选理由）。

Steps:

- [ ] 先写 `slot-fixed-price.spec.ts`：填固定价后 `unitPriceFen` 快照与视图一致；结算金额 = 固定价 × 申报分钟 / 60 向上取整；余额按固定价判定（不足时受控失败）；低于底价被接受且审计含 from/to；越界 400；`fixedPrices` 含未选中报名 400；老板端传 `fixedPrices` 被忽略（单价仍为算法价）；陪玩端不可调用（403）。
- [ ] 跑聚焦集成命令确认失败（红）。
- [ ] 实现 service 侧固定价解析/校验/快照/余额/审计，跑至绿。
- [ ] controller 传参 + `assignmentBodySchema`；`corepack pnpm openapi:check` 同步。
- [ ] 前端：选人界面输入固定价（含「低于底价」二次确认），显示已填固定价。
- [ ] E2E：派单详情填固定价并校验单价展示（含基线）。

Verification:

- 聚焦集成命令 + `corepack pnpm test:tenant-isolation`（确认固定价不破坏租户隔离）
- `corepack pnpm test:contract` + `corepack pnpm openapi:check`
- `corepack pnpm lint`、`corepack pnpm typecheck`、`prettier --check .`、`corepack pnpm build`
- E2E：`--project=pricing-slot-report`

Rollback: 回退代码；已产生的固定价快照保留在 `order_slots.unit_price_fen`（历史事实，无需清洗）。

## 执行顺序与提交

- 顺序固定为 Task 1 → 2 → 3 → 4（每片可独立评审、独立验收）。
- 每个 Task 完成后按仓库约定单独提交（**提交/推送为独立授权动作**，每片提交前会先给出准确文件范围与提交信息）。
- 本计划不含迁移、不含部署、不含远端数据库操作。

# 算价模型 Implementation Plan

Goal: 让订单定价以"陪玩×游戏底价 + 按游戏绑定的加价规则"为唯一权威，并让陪玩以报单（申报时长 + 截图证据）结算，产出老板支出 / 陪玩实收 / 门店毛利三个口径。

Architecture: 定价收敛到 `game-dispatch` 主线的规则库（`game_pricing_rules` + `player_game_prices`），`game-dispatch.service.ts` 与模板下单共用同一个纯函数定价器；报单与证据挂在 `order_slots`/`slot_sessions`/`slot_evidence` 既有链路上，账本继续走 `SlotEarning` → `LedgerEntry` → `SettlementBatch`。

Tech stack: Node 24.19.0、pnpm 10.34.5（corepack）、NestJS、Prisma 7 + `@prisma/adapter-pg`、PostgreSQL 18、Vitest 3、Playwright、Next.js（admin-web，Tailwind v4）、Taro 4 + React 18.3.1（mobile）。

Spec: `docs/specs/算价模型-设计规格-v0.1.md`；决策记录 `docs/adr/0003-order-pricing-model.md`（2026-09-20 已批准）。

Scope and non-goals: 本计划实现底价、加价规则库、报单时长与证据、报名/锁定/违约、自动关单、展示口径。**不做**：固定价（FIXED）规则、时长与证据的自动比对标记（两者均为已登记的后续项）、平台抽成（置 0）、真实支付渠道、CLASSIC 旧流程改造。

Permission gates（每一步都需单独授权）：

- 在本地一次性测试库（`pw_saas_s2_task2_20260916`）执行迁移与 seed；在任何其它数据库执行迁移；
- 创建分支、提交、推送、开 PR；
- 安装依赖或 Playwright 浏览器；
- 触碰 `docs/acceptance/*` 之外的验收证据文件。

Completion evidence: 每个 Task 结束需给出该 Task 的失败测试（先红后绿）、聚焦验证命令的实际输出与退出码、以及 `corepack pnpm lint`、`corepack pnpm typecheck`、`node node_modules/prettier/bin/prettier.cjs --check .` 的结果；涉及契约与生成物的 Task 还要有 `corepack pnpm openapi:check`。

## 项目级约束（抄自规格，逐条遵守）

- 金额一律整数分（bigint），禁止浮点；除法向上取整沿用 `(price * minutes + 59) / 60`。
- 每个租户资源必须服务端绑定 `TenantContext`，禁止信任客户端 `tenantId`。
- 单价与金额必须以**快照**落在订单侧（`order_slots.unit_price_fen` 等），事后改规则不得回写历史订单。
- 租户隔离：规则库读写按租户过滤；陪玩只能读到自己的定价结果。
- CLASSIC 旧流程按 ADR-0002 冻结，本计划只作用于 game-dispatch 主线。
- 迁移必须是**增量**的：不删除 `game_dispatch_template_snapshots.rank_rules_json` 与模板字段选项的 `add_price_fen`，只降级为 legacy 只读。

## Task 1：定价规则库与读路径切换

Objective：新增陪玩×游戏底价与按游戏加价规则库，并让"选人计价"与"模板下单计价"共用同一规则来源（覆盖规格 §3.1–§3.2、§5 迁移、ADR 决策 1–3）。

Files：

- 修改 `packages/database/prisma/schema.prisma`：新增 `PlayerGamePrice`、`GamePricingRule`、`GamePricingRuleItem`（`kind` 本版只写入 `SURCHARGE`）。
- 新增 `packages/database/prisma/migrations/20260920120000_order_pricing_rules/migration.sql`。
- 新增 `apps/api/src/modules/game-dispatch/domain/game-pricing.ts` + `game-pricing.spec.ts`：纯函数 `resolveUnitPriceFen({ gameBaseFen, fallbackBaseFen, rankLabel, ruleItems })`。
- 新增 `apps/api/src/modules/game-dispatch/infrastructure/prisma-game-pricing.repository.ts`：租户内读写底价与规则。
- 新增 `apps/api/src/modules/game-dispatch/interface/pricing-rules.controller.ts`：`GET/PUT /api/v1/tenant/game-pricing/games/:gameId`、`GET/PUT /api/v1/tenant/game-pricing/players/:playerId/games/:gameId/base`。
- 修改 `apps/api/src/modules/game-dispatch/application/game-dispatch.service.ts`：把 `snapshot.rankRulesJson` 定价（当前 ~1013–1023、1043–1068 行）替换为调用 `resolveUnitPriceFen`。
- 修改 `apps/api/src/modules/game-dispatch/domain/game-template-order-draft.ts`：模板下单不再用字段选项 `addPriceFen` 影响单价（改为规则库结果）。
- 修改 `apps/api/src/common/validation/api-validation-rules.ts`、`apps/api/src/openapi/schemas.ts`。
- 新增 `scripts/migrate-pricing-rules.mjs`：幂等迁移脚本，把各模板快照 `rank_rules_json` 与字段选项 `add_price_fen` 归并成该游戏的 `SURCHARGE` 规则项，输出冲突报告。

Pre-change evidence（先红）：先写 `game-pricing.spec.ts`，断言"规则库命中决定单价""字段选项 `addPriceFen` 不再改变单价""同游戏规则隔离、跨游戏不串"，此时应失败。

Steps：

- [ ] 写 `game-pricing.spec.ts` 的失败用例并运行，记录红色输出。
- [ ] 在 schema 增加三个模型与迁移 SQL；`corepack pnpm --filter @pw/database exec prisma generate`。
- [ ] 实现 `game-pricing.ts` 纯函数（无固定价分支，保留 `kind` 判定的扩展位）。
- [ ] 实现 `prisma-game-pricing.repository.ts` 与 `pricing-rules.controller.ts`；补 Zod 校验与 OpenAPI schema。
- [ ] 切换 `game-dispatch.service.ts` 与 `game-template-order-draft.ts` 的定价来源。
- [ ] 写 `scripts/migrate-pricing-rules.mjs`，并在本地一次性测试库上干跑（只读报告），确认冲突项清单。
- [ ] 补集成用例 `tests/integration/order-pricing.spec.ts`：规则命中计价、无底价拒绝、历史订单金额不随规则变化。
- [ ] 补契约用例 `tests/contract/order-pricing.spec.ts`。

Focused verification：`node node_modules/vitest/vitest.mjs run apps/api/src/modules/game-dispatch/domain/game-pricing.spec.ts`；四个环境变量下 `node node_modules/vitest/vitest.mjs run --config tests/vitest.integration.config.ts tests/integration/order-pricing.spec.ts`；`--config tests/vitest.contract.config.ts`；`corepack pnpm openapi:check`。

Rollback：迁移只新增表与列，不删字段；回退代码即恢复旧的 `rankRulesJson` 读路径；已写入的规则数据保留（可重复迁移，脚本幂等）。

## Task 2：商家端维护界面（底价 + 规则库）

Objective：店主/管理员能在界面上维护"每陪玩每游戏底价"与"每游戏加价规则"（覆盖规格 §7 前端、§3.4 权限）。

Files：

- 新增 `apps/admin-web/app/_lib/merchant-console/pricing-rules-view.tsx`（规则库表格：段位 + 加价额，金额用分字符串）。
- 修改 `apps/admin-web/app/_lib/merchant-console/merchant-api.ts`（新增三个调用的封装）。
- 修改 `apps/admin-web/app/_lib/merchant-console/modules.ts`（登记模块与权限）。
- 修改 `tests/e2e/merchant-console-admin.spec.ts`：新增"改加价 → 报名单价随之变化"用例与视觉基线。

Pre-change evidence：先补 E2E 用例（规则编辑后单价变化），在当前版本应失败。

Steps：

- [ ] 写失败 E2E 用例并记录红色。
- [ ] 实现 `pricing-rules-view.tsx`（仅店主/管理员可写，其它角色只读）。
- [ ] 接入 `merchant-api.ts` 与 `modules.ts`。
- [ ] 生成视觉基线（`--update-snapshots` 一次），随后用不带更新的复跑验证稳定。

Focused verification：`corepack pnpm test:e2e`（需本地 API + admin dev server，属独立动作）；`corepack pnpm --filter @pw/admin-web typecheck`。

Rollback：纯前端新增页面，回退提交即消失，不影响数据。

## Task 3：报单（申报时长 + 截图证据）与客服审批

Objective：陪玩结束服务后提交报单（总时长 + 开始/结束截图），客服审批时可人工核查并修正时长（覆盖规格 §3.3、§9 第 4–6 条）。

Files：

- 修改 `packages/database/prisma/schema.prisma`：`SlotSession.declaredDurationMinutes`（申报时长）+ 新迁移 SQL。
- 新增 `apps/api/src/modules/game-dispatch/interface/slot-report.controller.ts`：提交报单、审批（通过/修正时长）。
- 修改 `apps/api/src/modules/game-dispatch/application/*`：核算改用申报时长；修正时长写审计事件。
- 新增证据用途标识（复用 `SlotEvidence`，见规格 §9 第 4 条）。
- 修改 `apps/mobile/src/pages/player/order-hall/index.tsx`：报单表单（时长 + 两张截图上传）。
- 修改 `apps/admin-web/app/_lib/merchant-console/record-detail-view.tsx`（或订单详情对应视图）：审批入口与截图预览。
- 补 `tests/integration/slot-report.spec.ts`。

Pre-change evidence：先写集成用例"报单前不产生 `SlotEarning`；报单审批后按申报时长产生金额"，当前应失败。

Steps：

- [ ] 写失败集成用例并记录红色。
- [ ] 加 schema 字段与迁移 SQL。
- [ ] 实现报单/审批接口与审计事件；复用 `SlotEvidence` 保存截图。
- [ ] 核算改为使用申报时长；`SlotSession.durationSeconds` 仅作对照，不做自动比对（本版不做）。
- [ ] 陪玩端报单表单与截图上传；商家端审批与截图预览。

Focused verification：集成用例（四个环境变量）；`corepack pnpm --filter @pw/mobile typecheck`；`corepack pnpm build:h5` 与 `build:weapp`。

Rollback：schema 只加可空列；回退代码即回到证据计时口径，历史报单数据保留。

## Task 4：报名/锁定/违约与无人报名自动关单

Objective：陪玩可自助报名与取消（未选中前）；选中后不可自助取消；放鸽子由商家记违约并通知老板；无人报名默认 5 分钟自动关单（覆盖规格 §3.5、§6、§9 第 3 条）。

Files：

- 修改 `apps/api/src/modules/game-dispatch/application/game-dispatch.service.ts`：选中后自助取消返回受控 409；释放名额动作。
- 修改 `apps/api/src/modules/game-dispatch/interface/game-dispatch.controller.ts`：取消/释放名额路由语义。
- 新增 `packages/database/prisma/schema.prisma` → `PlayerBreachRecord` + 迁移 SQL。
- 新增 `apps/api/src/modules/game-dispatch/application/player-breach.service.ts`（记录违约 + 触发通知）。
- 修改 `apps/api/src/background/worker.ts`：新增"无人报名超时自动关单"tick（窗口可配置）。
- 修改 `apps/mobile/src/pages/player/order-hall/index.tsx`：报名 / 取消报名两个按钮。
- 补 `tests/integration/order-application-rules.spec.ts`、`tests/integration/order-auto-close.spec.ts`。

Pre-change evidence：先写用例"选中后自助取消返回 409""无人报名 5 分钟后订单自动关闭"，当前应失败。

Steps：

- [ ] 写失败集成用例并记录红色。
- [ ] 选中锁定规则与释放名额实现。
- [ ] 违约记录模型、服务与通知接线。
- [ ] worker 自动关单规则 + 可配置窗口（默认 5 分钟）。
- [ ] 陪玩端报名/取消按钮与状态提示。

Focused verification：两个集成用例；并发关单/报名用例（参照 `tests/integration/game-dispatch-template-v2-concurrency.spec.ts` 的写法）；`corepack pnpm typecheck`。

Rollback：worker 规则可通过配置关闭；违约记录表只增不改。

## Task 5：展示口径与门禁收口

Objective：报名详情显示单价（老板与陪玩同一数字）、报单后显示实收、商家端显示支出与门店毛利；并完成契约与三端收口（覆盖规格 §3.4、§8）。

Files：

- 修改 `apps/api/src/modules/game-dispatch/interface/*`（报名详情返回单价；报单后返回实收；商家端返回支出/抽成/毛利）。
- 修改 `apps/mobile/src/pages/player/order-hall/index.tsx` 与 `apps/mobile/src/pages/customer/game-order/index.tsx`。
- 修改 `apps/admin-web/app/_lib/merchant-console/` 对应订单/工作台视图。
- 重生成 `openapi.json`、`openapi.yaml`、`packages/api-client/src/*`。

Pre-change evidence：先补契约断言（报名详情含单价字段、报单响应含实收字段）与 E2E 断言。

Steps：

- [ ] 补契约与 E2E 失败断言并记录红色。
- [ ] API 返回字段实现（单价 / 实收 / 门店毛利）。
- [ ] 三端展示接入（老板端、陪玩端、商家端）。
- [ ] `corepack pnpm openapi:check` 重生成并提交生成物。
- [ ] 跑全套门禁：`lint` / `typecheck` / `prettier --check` / 单测 / 集成 / 租户隔离 / 契约 / 三端构建。

Focused verification：`corepack pnpm lint && corepack pnpm typecheck`；`node node_modules/prettier/bin/prettier.cjs --check .`；`corepack pnpm openapi:check`；`corepack pnpm build && corepack pnpm build:h5 && corepack pnpm build:weapp`。

Rollback：纯展示与契约字段增量，回退提交即可；生成物随代码回退。

## 执行顺序与并行边界

- 顺序：Task 1 → Task 2（依赖 Task 1 的接口）→ Task 3 → Task 4 → Task 5。Task 3 与 Task 4 在数据模型上互不依赖，可在 Task 1 完成后并行，但同一时间只允许一个 workflow owner。
- 每个 Task 结束后停止，报告证据，等待下一个 Task 的批准（仓库规矩：一次只实施一个 Slice）。
- 不做超出 Task 范围的重构；发现越界必须停下来说明原因。

## 自检

1. 规格 §3.1–§3.5 与 §9 六条逐条映射到 Task 1–5；非目标（固定价、智能核验、平台费、CLASSIC 改造）在计划中显式排除。
2. 未使用任何占位词；每个 Task 都有失败证据、聚焦验证命令与回滚方式。
3. 引用的文件与命令均已对照仓库：`schema.prisma`、`game-dispatch.service.ts`、`game-template-order-draft.ts`、`worker.ts`、`merchant-api.ts`、`order-hall/index.tsx`、`record-detail-view.tsx`、`scripts/`、`tests/*` 均存在；命令取自 `package.json` 与 `.github/workflows/ci.yml`。
4. 授权边界：迁移、seed、提交、推送、安装浏览器等均单列为 permission gate，本计划不授权执行。
5. 持久副作用（迁移、规则数据、违约记录）都有回滚说明；历史订单快照不回写。

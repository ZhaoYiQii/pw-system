# Dispatch Template Form Designer Implementation Plan

Goal: 让门店用可视化设计器自定义派单表单（模块分区 + 行列布局 + 命名 + 必填），并让"新建派单"改为弹窗表单、订单中心下新增三级菜单"模板管理"。

Architecture: 模板新增结构化"分区"（`game_dispatch_template_sections`），字段表增加 `section_id / col_span / row_break_before`，下单快照固化分区与列宽；前端新增纯函数渲染器 `layoutTemplateForm`，新建派单表单抽成可复用组件同时服务弹窗与既有路由。

Tech stack: NestJS 12 + Prisma + PostgreSQL RLS；Next.js 16 + Tailwind v4（`mc-*` token）+ shadcn 风格组件 + TanStack Query；Vitest 3.2.7 + Playwright 1.63.0。

Spec: `docs/specs/派单模板表单设计器-设计规格-v0.1.md`（用户 2026-09-12 批准）

Scope: `packages/database/prisma/**`、`apps/api/src/modules/game-dispatch/**`、`apps/api/src/common/validation/api-validation-rules.ts`、`openapi.yaml|json`、`packages/api-client/src/**`、`apps/admin-web/app/_lib/merchant-console/**`、`apps/admin-web/app/(tenant)/merchant-console/**`、`tests/integration/**`、`tests/e2e/merchant-console-admin.spec.ts`

Non-goals: 不改订单/派单/场次/结算状态机；不做自由画布拖拽；不做平台级模板市场；不引入乐观锁；不动移动端 H5 表单。

Permission gates: 本地产品代码写入已由用户在当前对话批准。**执行数据库迁移、生成 OpenAPI 后的客户端写入、Git 提交/推送、部署仍需单独授权**；上次已获授权的动作不自动沿用。

Completion evidence: 定向 integration 全绿 + `openapi:check` 无差异 + admin/api typecheck 与 admin build 通过 + Playwright 三条用例通过 + 手工走查截图。

## 项目约束

- TypeScript strict；不得使用 any 或忽略类型。
- 金额、租户绑定、权限、业务状态机不动；模板读写继续要求 `gameDispatch.manage` 与 `TenantContext`。
- 快照必须固化分区与列宽，禁止让模板改动回溯影响历史订单。
- 迁移必须 additive；老模板自动落成"默认模块 + 单列"。
- admin 新功能一律新栈（Tailwind v4 + `components/ui/*` + TanStack Query），不得引入旧 `.card/.btn/.data-table`。

---

## Task 1（S1）：后端分区与列宽模型

- [ ] 迁移 `20260912090000_dispatch_template_sections`：建 `game_dispatch_template_sections`（含 RLS 授权）；`game_dispatch_template_fields` 加 `section_id/col_span/row_break_before`；`game_dispatch_template_snapshots` 加 `sections_json`；回填老模板默认分区。
- [ ] `schema.prisma` 同步模型与索引。
- [ ] `domain/game-template.ts` 增加 `TemplateSectionInput/View` 与字段新属性；服务层实现分区 CRUD 语义、默认分区回落、跨列/列数校验、快照写入。
- [ ] `prisma-game-template.repository.ts` 读写分区与列宽。
- [ ] `interface/game-template.controller.ts` 响应/请求体扩展。
- [ ] `api-validation-rules.ts` 登记新字段校验。
- [ ] 集成测试：分区 CRUD、字段挂分区、越界 400、重名 400、默认分区、快照含分区、跨租户隔离。
- [ ] `pnpm openapi:generate` 更新契约与生成客户端（写入生成文件属需授权动作，执行前单独确认）。

Verification:

```text
corepack pnpm --filter @pw/api typecheck
corepack pnpm test:integration -- tests/integration/game-dispatch-template.spec.ts tests/integration/<新增分区用例>.spec.ts
corepack pnpm openapi:check
corepack pnpm db:migrate:check
```

Rollback: 回退本 Slice 的文件增量；数据库侧删列 + 删表（迁移为 additive，无破坏性变更）。

## Task 2（S2）：前端渲染器与新建派单弹窗

- [ ] `layoutTemplateForm` 纯函数 + 单测（分组、排序、装箱、`rowBreakBefore`、停用过滤、无分区回落、窄屏单列）。
- [ ] 抽取 `NewOrderForm`（字段渲染 + 校验 + 提交），保持行为不变。
- [ ] `NewOrderDialog` 弹窗 + 入口替换（工作台、订单中心列表、AI 带入）；`/merchant-console/dispatch/new` 保留整页渲染与 `?templateId=` 预选。
- [ ] 弹窗内必填拦截、失败保留输入、成功后关闭并刷新列表。

Verification:

```text
corepack pnpm vitest run apps/admin-web/app/_lib/merchant-console/<layout spec>.spec.ts
corepack pnpm --filter @pw/admin-web typecheck
```

Rollback: 回退新增组件与入口改动；旧路由行为不变，可独立回退。

## Task 3（S3）：模板管理页

- [ ] 新路由 `/merchant-console/dispatch/templates`（静态段优先于 `[module]`）。
- [ ] 左侧模板列表（新建/复制/启停/删除），右侧编辑器（模块增删改改列数排序启用、字段命名/类型/必填/选项/占位/跨列/另起一行/排序/删除）。
- [ ] "预览"复用 `layoutTemplateForm`；列数下调时收敛越界 `colSpan` 并提示。
- [ ] 保存失败保留编辑态；未保存离开确认。

Verification:

```text
corepack pnpm --filter @pw/admin-web typecheck
corepack pnpm --filter @pw/admin-web build
```

Rollback: 删除新路由与编辑器组件，恢复入口为旧编辑器链接。

## Task 4（S4）：三级导航

- [ ] `modules.ts`：`dispatch` 升级为可展开分组，children = 派单工作台 / 模板管理；角色可见性沿用现有矩阵。
- [ ] `merchant-shell.tsx`：二级分组展开状态 + `aria-expanded`/`aria-controls`。
- [ ] `merchant-console.css`：`.mc-nav-group*` 样式，移动抽屉行为不回归。
- [ ] 更新 `modules.spec.ts` 断言（域/模块计数与角色可见性）。

Verification:

```text
corepack pnpm vitest run apps/admin-web/app/_lib/merchant-console/modules.spec.ts
corepack pnpm --filter @pw/admin-web typecheck
```

Rollback: 回退导航注册表与样式增量，菜单恢复二级结构。

## Task 5（S5）：端到端验收

- [ ] Playwright：①"新建派单"打开弹窗且不跳转；②模板管理新增模块/字段/列数/必填并保存；③弹窗按新布局渲染且必填拦截生效。
- [ ] owner 与受限角色走查菜单与权限；窄屏检查；控制台无阻断错误。

Verification:

```text
corepack pnpm test:e2e
```

Rollback: 无数据库副作用；回退 E2E 与本 Slice 前端改动。

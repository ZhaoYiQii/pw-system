# 模板编辑器原语化重写 Implementation Plan

Goal: 把商家端「内容设计」Tab 从「配置后端模型」改造成「用原语自由搭表单」，并删除全部预设入口。
Architecture: 只改视图层。状态与修改操作沿用 `template-draft-state.ts` 既有 API；预览复用 `TemplateDraftRenderer`；校验复用 `collectDraftIssues`。零后端改动、零契约变更、零数据库迁移。
Tech stack: Next.js 16 App Router + React 19 + Tailwind v4 + 仓库内 shadcn 风格组件；TypeScript strict；Vitest 3.2（纯函数单测）；Playwright（E2E）。
Spec: `docs/specs/派单模板表单设计器-设计规格-v0.2.md`
Scope and non-goals:

- 范围内：`template-editor-content.tsx` 重写、新增纯函数层、编辑器内嵌预览、受影响 E2E 用例迁移、门禁与验收记录。
- 非目标：后端与 OpenAPI 契约；数据库迁移；下单渲染与订单快照；业务绑定与计算 Tab；发布设置与版本 Tab；`insertPreset` / `DraftPreset` 的函数级删除（独立清理任务）。
  Permission gates（各自单独确认）：写仓库文件；启动本地服务与 Docker；使用授权的一次性测试库跑 E2E；提交 / 推送 / 部署。
  Completion evidence: `typecheck` 退出码 0；`build` 退出码 0；`template-editor-meta.spec.ts` 全绿；`template-draft-state.spec.ts` 与 `template-binding.spec.ts`、`template-a11y.spec.ts` 全绿；受影响 E2E 用例更新后的文本 diff。未跑 E2E 时必须标为未验证。

## 1. 事实基线（本计划已逐条核实）

| 事实                                                                                                                                                                                                                                                                                                                                                     | 位置                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TemplateEditorContent` 唯一调用方                                                                                                                                                                                                                                                                                                                       | `template-manager-view.tsx:972-976`（props：`draft` / `onChange` / `onNotice`）                                                                         |
| 编辑器的 props 接口                                                                                                                                                                                                                                                                                                                                      | `template-editor-content.tsx:73-77`                                                                                                                     |
| 模型操作已齐备（22 个导出，含 `addComponent`/`updateComponent`/`moveComponent`/`removeComponent`/`toggleComponentEnabled`/`addSection`/`updateSection`/`moveSection`/`removeSection`/`addTableColumn`/`removeTableColumn`/`updateTableColumn`/`setComponentOptions`/`addDefaultRow`/`removeDefaultRow`/`guardRemoveComponent`/`guardRemoveTableColumn`） | `template-draft-state.ts`                                                                                                                               |
| 问题模型                                                                                                                                                                                                                                                                                                                                                 | `collectDraftIssues(config): DraftIssue[]` 与 `DraftIssue` 在 `template-binding.ts:221` / `:27`                                                         |
| 预览渲染器                                                                                                                                                                                                                                                                                                                                               | `TemplateDraftRenderer({ sections, components, includeDisabled?, className? })` 在 `template-form-renderer.tsx:158-166`                                 |
| 订单文案草稿预览                                                                                                                                                                                                                                                                                                                                         | `previewTemplateDocument(config: DraftConfigV2): PreviewDocument` 在 `template-document-preview.ts:411`                                                 |
| 无障碍助手                                                                                                                                                                                                                                                                                                                                               | `focusSelectorAfterMove` / `announceOrderChange` / `announceIssue` / `componentOrderIsStable` 在 `template-a11y.ts`                                     |
| 预设调用点                                                                                                                                                                                                                                                                                                                                               | `insertPreset` 在 `template-editor-content.tsx:24,125-126`、`template-draft-state.ts:615`                                                               |
| admin 可用脚本                                                                                                                                                                                                                                                                                                                                           | 仅 `dev` / `build` / `typecheck`；单元测试走根 `vitest.config.ts`                                                                                       |
| E2E 受影响用例                                                                                                                                                                                                                                                                                                                                           | `tests/e2e/merchant-console-admin.spec.ts` 的 `S3 模板管理主路径` 三条（414 / 479 / 528），依赖 `+ 新分区`、`aria-label="组件名称"`、「岗位与人数」预设 |

## 2. 实施地图

| 文件                                                                           | 责任                                 | Task |
| ------------------------------------------------------------------------------ | ------------------------------------ | ---- |
| `apps/admin-web/app/_lib/merchant-console/template-editor-meta.ts`（新）       | 标签、属性摘要、问题数、算价占用判定 | 1    |
| `apps/admin-web/app/_lib/merchant-console/template-editor-meta.spec.ts`（新）  | 上者单测                             | 1    |
| `apps/admin-web/app/_lib/merchant-console/template-editor-content.tsx`（重写） | 内容设计 Tab 视图                    | 2、3 |
| `apps/admin-web/app/_lib/merchant-console/template-manager-view.tsx`（小改）   | 移除重复的草稿预览块                 | 3    |
| `tests/e2e/merchant-console-admin.spec.ts`（改）                               | 三条 S3 用例迁移到新 UI              | 4    |
| `docs/acceptance/2026-09-18-template-editor-primitive-redesign.md`（新）       | 验收记录                             | 5    |

## 3. Task 1 视图纯函数层

Objective: 把标签、摘要、问题数、占用判定从视图中抽出并单测。覆盖规格 D-13 / D-15 / D-18 / D-19。

Interfaces produced（`template-editor-meta.ts`）：

- `FIELD_TYPE_LABELS: Record<DraftFieldTypeV2, string>`（单行文本 / 多行文本 / 数字 / 金额 / 日期时间 / 单选 / 多选）
- `TABLE_COLUMN_TYPE_LABELS: Record<DraftTableColumnTypeV2, string>`（文本 / 数字 / 金额 / 单选）
- `COMPONENT_KIND_LABELS: Record<DraftComponentV2["kind"], string>`（字段 / 表格 / 说明）
- `BINDING_OPTIONS: ReadonlyArray<{ role: DraftSemanticRoleV2 | null; label: string }>`（不用 / 人数 / 时长 → `null` / `"STAFFING_COUNT"` / `"DURATION_MINUTES"`）
- `componentSummary(config: DraftConfigV2, stableKey: string): string`
- `issueCountByComponent(config: DraftConfigV2): ReadonlyMap<string, number>`
- `bindingOwner(config: DraftConfigV2, role: DraftSemanticRoleV2, exceptStableKey: string): string | null`

Steps：

- [ ] 先写失败用例 `template-editor-meta.spec.ts`：`componentSummary` 对单选三分支（2 个选项 / 1 项加价）返回 `"单选 · 3 个选项 · 1 项加价"`；对表格返回 `"3 列 · 默认 1 行"`；对说明返回截断文本。
- [ ] 先写失败用例：`issueCountByComponent` 只统计 `collectDraftIssues` 中带 `componentKey` 的问题，且不把区块级问题算到组件上。
- [ ] 先写失败用例：`bindingOwner` 排除 `exceptStableKey` 自身；停用组件不参与占用。
- [ ] 实现四个映射表与三个函数，全部为纯函数，不 import React、不读 DOM。

Focused verification: `corepack pnpm test -- apps/admin-web/app/_lib/merchant-console/template-editor-meta.spec.ts` → 退出码 0。
Rollback: 删除两个新文件，无副作用。

## 4. Task 2 编辑器视图重写

Objective: 用「行 + 展开属性面板」替换现有编辑器，删除全部预设与工程概念暴露。覆盖规格 D-13 / D-14 / D-15 / D-16 / D-19。

Files: `template-editor-content.tsx`（重写；props 保持 `{ draft, onChange, onNotice }` 不变）。

Steps：

- [ ] 工具条改为四个动作：`+ 新建字段` / `+ 新建表格` / `+ 新建说明` / `+ 新建分组`，分别调用 `addComponent`（`kind` 取 `FIELD` / `REPEATABLE_TABLE` / `NOTE`）与 `addSection`；一律创建空白项（`label: ""`）。
- [ ] 删除 `insertPreset` / `DraftPreset` 的 import 与 `applyPreset`、「参考预设」按钮与预设文案。
- [ ] 行渲染：编号（复用 `layoutV2Rows` 顺序，保证与预览同号）、`COMPONENT_KIND_LABELS` 类型列、名称按钮、`componentSummary` 摘要、`issueCountByComponent` 问题徽标、必填 / 算价绑定徽标；工具区为必填切换（`updateComponent({ required })`）、复制（`addComponent` 后 `updateComponent` 覆盖标签）、停用（`toggleComponentEnabled`）、删除（`guardRemoveComponent` 通过后 `removeComponent`）。
- [ ] 属性面板（选中行后在该行下方渲染）：名称（`updateComponent({ label })`）、类型（`updateComponent({ fieldType })`，仅 FIELD）、选项编辑（`setComponentOptions`，每项含 `priceDeltaFen`）、占位与说明（`updateComponent({ description })` 与字段 placeholder 走既有补丁）、算价绑定（`updateComponent({ semanticRole })`，占用项置灰并提供 `bindingOwner` 提示）、表格列增删改（`addTableColumn` / `updateTableColumn` / `removeTableColumn`，列被引用时以 `guardRemoveTableColumn` 拦截）、默认行（`addDefaultRow` / `removeDefaultRow`）、说明文本（`updateComponent({ text })`）、占宽（`updateComponent({ colSpan })` 1 或 2）。
- [ ] 分组头：折叠、改名（`updateSection({ label })`）、每行 1–4 循环（`updateSection({ columns })`）、删除（`removeSection`）。
- [ ] 无障碍：名称按钮 `aria-expanded`；必填 / 停用按钮 `aria-pressed`；上移/下移或拖动后调用 `focusSelectorAfterMove` 把焦点放回同一按钮，消息走 `announceOrderChange`。
- [ ] 移除旧文案：`fieldKey: xxx` 常显、「选项（加价与元换算在 S3 Task 4 接入）」、`SEMANTIC_ROLE_LABELS` 下拉暴露。
- [ ] 键盘排序保留 `Alt + ↑ / ↓`，与既有 `template-a11y` 行为一致。

Focused verification: `corepack pnpm --filter @pw/admin-web typecheck` → 0；`corepack pnpm --filter @pw/admin-web build` → 0。
Rollback: `git checkout -- apps/admin-web/app/_lib/merchant-console/template-editor-content.tsx`（该文件当前为已提交状态，回滚无数据影响）。

## 5. Task 3 编辑器内嵌预览与去重

Objective: 预览与编辑器并排，且只保留一处预览。覆盖规格 D-16 / D-17。

Steps：

- [ ] 在 `template-editor-content.tsx` 右侧渲染 `<TemplateDraftRenderer sections={draft.sections} components={draft.components} />`；窄屏（`< 1180px`）改为上下堆叠，沿用 Tailwind 断点。
- [ ] 增加「订单文案」切换：调用 `previewTemplateDocument(draft)`，用返回的 `plainText` 渲染只读文本块。
- [ ] 增加「手机宽度」切换：仅切换预览容器宽度，不改数据。
- [ ] 删除 `template-manager-view.tsx` 中 content Tab 下重复的「草稿预览」块（约 972–983 行），避免两处预览。

Focused verification: `typecheck` → 0；`build` → 0；手工走查时确认页面上只剩一处预览。
Rollback: 恢复 `template-manager-view.tsx` 的预览块与 `template-editor-content.tsx`。

## 6. Task 4 受影响 E2E 用例迁移

Objective: 让依赖旧编辑器选择器的三条 S3 用例匹配新 UI。覆盖规格 D-13 / D-14。

Steps：

- [ ] `tests/e2e/merchant-console-admin.spec.ts:414` 用例改为：`+ 新建分组` → `+ 新建表格` → 属性面板填列名 → 算价绑定选「人数」→ `保存草稿` → `发布` → `归档`；断言改为新 DOM 的 `aria-label`。
- [ ] `:479` 并发冲突用例：把「新增内容」的写法换成新 UI 动作，语义保持（本地草稿保留 + 409 提示）。
- [ ] `:528` 键盘用例：把「区块上移」改为新 UI 的上移/下移入口，断言焦点仍在同一按钮上。
- [ ] 全仓 `rg '"+ 新分区"|组件名称|参考预设'` 确认无残留引用。

Focused verification: `corepack pnpm test:e2e --grep "S3 模板管理"` → 需 Docker（PG 5433 / Redis 6380 / MinIO）、本地 API 与 admin dev、以及授权的一次性测试库；**未获授权或环境未就绪时不执行，并在验收记录中标记未验证**。
Rollback: 恢复该 spec 文件的 diff。

## 7. Task 5 验收记录与门禁

Objective: 留下可复核的证据。覆盖规格第 7 节。

Steps：

- [ ] 新建 `docs/acceptance/2026-09-18-template-editor-primitive-redesign.md`：改动文件、命令与退出码、用例数量、未验证项。
- [ ] 运行 `corepack pnpm --filter @pw/admin-web typecheck` 与 `build`。
- [ ] 运行 admin 单元套件：`corepack pnpm test -- apps/admin-web/app/_lib/merchant-console`。
- [ ] 运行 `corepack pnpm lint`（仅限本次改动文件）。
- [ ] 逐条列出未验证：E2E 是否执行、手工走查是否完成、视觉基线是否建立。

Focused verification: 上述命令的退出码与摘要写入验收记录。
Rollback: 删除验收记录文件。

## 8. 执行顺序与并行边界

1. Task 1 → Task 2 串行（Task 2 依赖 Task 1 的接口）。
2. Task 3 紧随 Task 2（同一文件）。
3. Task 4 依赖 Task 2、3 的最终 DOM。Task 5 最后。
4. 每个 Task 结束报告：改动文件、命令与退出码、未验证项。

## 9. 自检

- 规格第 2 节 D-13 至 D-19 全部映射到 Task 1–4；第 9 节三项非目标在「Scope and non-goals」中列明。
- 无 TBD / TODO；所有类型、函数、命令均已在仓库中核实存在。
- 每个 Task 都有聚焦验证命令与回滚方式；无步骤隐含安装依赖、提交、推送、迁移或部署授权。

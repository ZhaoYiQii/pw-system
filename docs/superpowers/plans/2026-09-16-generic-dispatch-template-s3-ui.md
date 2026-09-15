# Generic Dispatch Template S3 UI Implementation Plan

Goal: 在 `apps/admin-web` 用 S2 生成客户端与 TanStack Query 交付正式的多游戏模板管理界面（列表 + 三标签编辑器 + 发布与版本历史），替换现有基于 v1 `/game-templates` 的临时实现。

Architecture: 数据层统一走 `@pw/api-client` 的 `genericGameTemplate*` 12 个 operation；页面用 URL 保存筛选/选中模板/编辑标签；草稿编辑是纯函数状态模型（按 stableKey 操作），渲染层复用同一表单渲染器与布局计算；发布/版本走服务端契约，409 保留本地草稿。

Tech stack: Next.js 16.3.4、React 19.2.8、TypeScript 5.9 strict、Tailwind v4、TanStack Query 5.102.8、`components/ui/*`（badge/button/card/input/table）、lucide-react、Vitest 3.2.7、Playwright 1.63（msedge channel）。

Spec: `docs/superpowers/specs/2026-09-13-multi-game-dispatch-template-center-design.md`（§9 交互、§11 数据流与异常、§13 安全与性能、§14 测试策略、§15 验收标准、§16 S3 切片）

Scope and non-goals:

- 范围内：`apps/admin-web` 的模板管理列表、编辑器（内容设计 / 业务绑定与计算 / 发布设置与版本历史）、参考预设、自动文案预览、草稿保存与发布、版本历史与恢复、默认/归档/取消归档/删除、键盘与无障碍、管理端 Playwright 主路径。
- 非目标：S4 新建派单交互改造、移动端、其他商家控制台页面迁移、删除或改写旧 `/api/v1/tenant/game-templates`、任何数据库/迁移/契约生成物改动、把 `work/prototypes/s3-template-center` 的任何文件搬进生产代码、恢复 copyLines 编辑器。

Permission gates（每一项都需要届时单独授权，计划本身不授权）：

1. 依赖安装：`apps/admin-web/package.json` 增加 `@pw/api-client: workspace:*` 并执行 `pnpm install`。
2. 启动本地服务：API（默认 3000，`DATABASE_URL` 指向已授权一次性测试库）与 admin dev（3005）；属于「启动服务」动作。
3. Playwright 运行：使用 msedge channel 的真实浏览器执行。
4. 提交/推送/部署：本计划全程不做，需另行授权。
5. 工具限制：`docs/acceptance/` 目录 `apply_patch` 无写权限（S2 Task 5 已用探针确认），写验收文档时需要一次获批的直接写入。

Completion evidence（S3 最低证据，缺一不可）：

- 组件/布局单元测试（Vitest，位于 `apps/admin-web/app/_lib/merchant-console/**/*.spec.ts`，被根 `vitest.config.ts` 收录）；
- `corepack pnpm --filter @pw/admin-web typecheck`；
- 定向 ESLint 与 Prettier；
- `corepack pnpm --filter @pw/admin-web build`（生产构建）；
- 连接**真实本地 S2 API**的 Playwright 管理主路径（不得用 mock 代替联调）；
- 键盘排序、409 冲突、归档等异常场景的自动化断言；截图只能辅助，不能替代行为测试。

## 从规格逐字继承的约束

- 新模板必须选择游戏，旧模板明确显示“未归类”。
- 保存草稿不改变线上表单；发布后新表单才切换版本。
- 字段改名不影响基于语义角色的业务规则。
- 编辑器不再固定显示岗位席位、段位加价或复制文案模块；岗位与人数、选择项加价仅作为可编辑参考预设插入。
- 区块和组件均有独立启用开关；禁用后配置保留，重新启用后恢复，删除必须为单独操作。
- 人数来源通过 stableKey 与语义角色显式绑定，禁止按显示名称或 fieldKey 猜测。
- 任意选择字段可以配置选项价格调整；金额一律十进制字符串分，禁止浮点。
- 旧修订保存返回 409，不覆盖其他管理员的修改；切换模板不会无提示丢失值。
- 归档不破坏历史订单；只有未发布且未引用模板可硬删除。
- Owner/Admin 默认可管理和发布，客服默认只能查看。
- 客服（`CUSTOMER_SERVICE` → `CS`）在 UI 上不得出现保存/发布/复制/设默认/归档/取消归档/删除入口；服务端仍是唯一权威。
- 模板列表使用摘要和分页，不在列表阶段加载完整详情（Lazy 详情）。
- 通用说明按纯文本显示，不支持 HTML/脚本/任意表达式。
- 编辑器隐藏旧的复制文案（copyLines）配置且不提供编辑入口，只展示按当前草稿生成的自动文案预览。
- 无法无歧义绑定的旧价格规则必须显式提示「需要人工确认」，未处理前禁止发布。

## 现状事实（2026-09-16 核对）

| 事实                  | 证据                                                                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S2 契约与客户端已就绪 | `openapi.json` 含 12 个 `genericGameTemplate*` operation；`packages/api-client/src/index.ts` 已导出对应函数与类型                                                                   |
| 客户端运行时未装配    | `packages/api-client/package.json` 无 `main`/`types`/`exports`；`apps/admin-web/package.json` 无 `@pw/api-client` 依赖；`next.config.ts` 无 `transpilePackages`                     |
| 现有模板页面基于 v1   | `template-manager-view.tsx`（1881 行）调用 `/api/v1/tenant/game-templates`，使用 `apps/admin-web/app/_lib/api.ts` 的 `apiFetch`，120 处 `mc-*` 类，未使用 `components/ui`           |
| 页面已挂路由          | `app/(tenant)/merchant-console/dispatch/templates/page.tsx` → `ModuleGate moduleId="dispatch"`；`modules.ts` 已有 `dispatch-templates` 导航项                                       |
| 可复用纯逻辑          | `form-layout.ts`（+`form-layout.spec.ts`）、`template-form-renderer.tsx`、`new-order-dialog.tsx`（`McDialog`）、`role-context.tsx`                                                  |
| 测试入口              | 根 `vitest.config.ts` 收录 `apps/admin-web/app/_lib/merchant-console/**/*.spec.ts`；Playwright 项目 `admin` 覆盖 `tests/e2e/merchant-console-admin.spec.ts`（baseURL 3005，msedge） |
| 角色映射              | `role-context.tsx` 将 `TENANT_OWNER/ADMIN → OWNER/ADMIN`、`CUSTOMER_SERVICE → CS`；`module-gate.tsx` 只做导航级隐藏，真实授权在服务端                                               |

## Task 0：只读预检与现状核对

Objective: 不改任何文件，确认 S3 起点、能力与阻塞项。

Steps:

- [ ] 重新读取 `docs/acceptance/2026-09-15-s2-template-management-api.md`，确认 S2 仍为 `locally-verified`。
- [ ] 运行 `corepack pnpm --filter @pw/api-client typecheck`，确认生成客户端源码类型可用。
- [ ] 只读核对 `template-manager-view.tsx` 当前使用的 endpoint 清单，产出「v1 调用 ↔ v2 operation」映射表。
- [ ] 检查 3000/3005 端口占用、Docker/Postgres 状态、测试库 `pw_saas_s2_task2_20260916` 是否可连（不写入）。
- [ ] 记录 `work/prototypes/s3-template-center` 的结构作为交互参考，并明确不复用其代码。
- [ ] 若发现 S2 证据缺失、客户端不可用或 admin 工作树与计划假设冲突，停止并报告，不进入 Task 1。

Focused verification:

- `corepack pnpm --filter @pw/api-client typecheck`（预期退出码 0）
- `git status --porcelain`（记录与本计划重叠的用户改动，不清理）

Recovery: 无写入，无需回退。

## Task 1：装配生成客户端与模板 API 层

Objective: 让 admin 能以类型安全方式调用 12 个 v2 operation，并把服务端错误统一成前端可判别的结构。

Files:

- Modify `apps/admin-web/package.json`（新增 `"@pw/api-client": "workspace:*"`）
- Modify `packages/api-client/package.json`（新增 `main`/`types`/`exports`，使 workspace 消费方可解析；不触碰生成文件）
- Modify `apps/admin-web/next.config.ts`（`transpilePackages: ["@pw/api-client"]`）
- Modify `apps/admin-web/tsconfig.json`（`paths` 增加 `"@pw/api-client": ["../../packages/api-client/src/index.ts"]`、`"@pw/api-client/client": ["../../packages/api-client/src/client.gen.ts"]`）
- Create `apps/admin-web/app/_lib/merchant-console/template-api.ts`
- Create `apps/admin-web/app/_lib/merchant-console/template-api.spec.ts`

Interfaces:

- `configureTemplateClient(input: { origin: string; getToken: () => string | null }): void`：调用生成单例的 `client.setConfig({ baseUrl, headers })`，每次请求实时读取 token。
- `fetchTemplateList(query: TemplateListQuery): Promise<GenericGameTemplateListResponse>`；`fetchTemplateDraft(id)`；`saveTemplateDraft(id, body)`；`publishTemplate(id, body)`；`restoreTemplate(id, body)`；`copyTemplate(id, body)`；`setDefaultTemplate(id, body)`；`archiveTemplate(id, body)`；`unarchiveTemplate(id, body)`；`deleteTemplate(id, expectedRevision)`；`fetchTemplateVersions(id, { cursor, limit })`。
- `export type TemplateErrorCode = "TEMPLATE_CURSOR_INVALID" | "TEMPLATE_NOT_FOUND" | "TEMPLATE_REVISION_CONFLICT" | "TEMPLATE_ARCHIVED" | "TEMPLATE_NAME_CONFLICT" | "TEMPLATE_DELETE_RESTRICTED" | "TEMPLATE_VERSION_UNAVAILABLE" | "TEMPLATE_COMPONENT_INVALID" | "TEMPLATE_BINDING_INVALID" | "TEMPLATE_PRICE_RULE_INVALID" | "TEMPLATE_LEGACY_REVIEW_REQUIRED"`（定义在 `template-api.ts`）。
- `toTemplateApiError(error: unknown): { code: TemplateErrorCode | "UNKNOWN"; message: string; details?: unknown; status?: number }`：识别上表全部受控码，未知错误回退 `UNKNOWN` 并保留原始 message。
- 生成类型的 query 参数是 **string**（`GenericGameTemplateListData.query.limit?: string`、DELETE 的 `expectedRevision: string`），封装层负责 number → string 转换，不把 number 直接塞进 query。
- admin 侧在 `template-draft-state.ts` 定义 `DraftConfigV2`/`TemplateComponentV2`/`TemplateSectionV2`/`StaffingSourceV2`/`TemplateConfigIssue` 的镜像类型；在 `template-api.spec.ts` 用生成的 `GenericGameTemplateSaveDraftData["body"]["config"]` 做编译期 `satisfies` 断言，防镜像与契约漂移。

Steps:

- [ ] 先写 `template-api.spec.ts`：断言 `toTemplateApiError` 对 409/422/404 载荷的映射、未知错误回退、列表 query 参数组装（`gameId/status/q/sort/cursor/limit` 只透传非空值）。
- [ ] 运行红测：`& '.\node_modules\.bin\vitest.cmd' run apps/admin-web/app/_lib/merchant-console/template-api.spec.ts`，确认因缺少实现而失败。
- [ ] 增加依赖并安装（**权限点 1**）。
- [ ] 配置 `transpilePackages` 与 `paths`，并把 `./client` 单例配置抽到 `configureTemplateClient`。
- [ ] 实现 12 个薄封装：只做参数透传 + 错误归一，不在前端复制业务规则、不判断角色。
- [ ] 在 `template-manager-view.tsx` 的模块加载路径调用 `configureTemplateClient` 一次（`NEXT_PUBLIC_API_ORIGIN` 作为 origin，token 复用 `api.ts` 的 `getAccessToken`）。
- [ ] 保留 `merchant-api.ts` 中其它模块使用的类型与函数；仅移除模板页面专属的 v1 调用（其它模块仍依赖 `TemplateRow` 等类型时保持导出）。

Focused verification:

- `& '.\node_modules\.bin\vitest.cmd' run apps/admin-web/app/_lib/merchant-console/template-api.spec.ts`（退出码 0，全部通过）
- `corepack pnpm --filter @pw/admin-web typecheck`（退出码 0）
- `& '.\node_modules\.bin\eslint.cmd' apps/admin-web/app/_lib/merchant-console/template-api.ts apps/admin-web/app/_lib/merchant-console/template-api.spec.ts`

Recovery: 移除依赖与封装文件即可回到 `apiFetch` 直连状态；不改任何服务端代码。

## Task 2：列表、筛选与 URL 状态

Objective: 交付按游戏/状态/搜索/排序的摘要列表与游标分页，并把筛选、选中模板、编辑标签写入 URL。

Files:

- Create `apps/admin-web/app/_lib/merchant-console/template-list-state.ts`
- Create `apps/admin-web/app/_lib/merchant-console/template-list-state.spec.ts`
- Modify `apps/admin-web/app/_lib/merchant-console/template-manager-view.tsx`（列表区与页面骨架）
- Modify `apps/admin-web/app/(tenant)/merchant-console/dispatch/templates/page.tsx`（仅当需要传递初始 URL 状态时）

Interfaces:

- `parseTemplateListSearch(search: string): TemplateListSearch`，`buildTemplateListSearch(next: TemplateListSearch): string`（`game`、`status`、`q`、`sort`、`id`、`tab` 六个键，未归类使用 `game=unclassified`，不得写入客户隐私或表单值）。
- `toListQuery(search: TemplateListSearch): TemplateListQuery`（`game=unclassified` → 传入未归类语义；`sort` 白名单）。

Steps:

- [ ] 先写 `template-list-state.spec.ts`：往返解析、非法值回退默认（`sort=UPDATED_DESC`）、URL 不含表单值、`tab` 仅允许 `content|binding|release`。
- [ ] 用 TanStack Query 的 `useInfiniteQuery` 接 `fetchTemplateList`，`nextCursor` 驱动「加载更多」；筛选变化时重置分页。
- [ ] 列表卡片展示：模板名、状态（含 `UNPUBLISHED_CHANGES`、`ARCHIVED`）、线上版本号、草稿更新时间、编辑人、最近使用、默认标记；`game.id === ""` 显示「未归类」。
- [ ] 页面状态：loading 骨架、空态（含「新建模板」入口）、错误态（可重试）、403 无权态（复用 `ModuleGate` 语义，不复用其文案）。
- [ ] 角色门禁：`useMerchantRole()` 为 `CS` 时隐藏「新建模板」与列表内的写操作入口，只保留筛选与查看；服务端 403 仍要能正确显示（UI 隐藏不等于授权）。
- [ ] 「新建模板」对话框：游戏必选（租户游戏列表）、名称必填，调用 `fetchTemplateCreate` 后跳到 `?id=<newId>&tab=content`。
- [ ] 键盘可达：筛选控件有 label，列表项可 Tab 聚焦并 Enter 选中，焦点在 URL 变化后保持在触发元素。
- [ ] 切换到模板/游戏前若存在未保存修改，弹出确认（调用 Task 3 的 `isDirty`）。
- [ ] 存在未保存修改时，浏览器刷新/关闭触发 `beforeunload` 提示（仅在 dirty 状态注册监听）。

Focused verification:

- `& '.\node_modules\.bin\vitest.cmd' run apps/admin-web/app/_lib/merchant-console/template-list-state.spec.ts`
- `corepack pnpm --filter @pw/admin-web typecheck`
- 手动：刷新带 `?game=...&status=...&id=...&tab=binding` 的链接可恢复状态（记入验收文档）

Recovery: 列表区可单独回退到 v1 渲染而不影响编辑器（同一文件内分块提交）。

## Task 3：三标签编辑器与草稿状态模型

Objective: 交付「内容设计」标签：任意区块与组件增删改、参考预设、独立启用开关、空位添加、预览与布局一致。

Files:

- Create `apps/admin-web/app/_lib/merchant-console/template-draft-state.ts`
- Create `apps/admin-web/app/_lib/merchant-console/template-draft-state.spec.ts`
- Modify `apps/admin-web/app/_lib/merchant-console/template-form-renderer.tsx`（支持 v2 的 FIELD/REPEATABLE_TABLE/NOTE）
- Modify `apps/admin-web/app/_lib/merchant-console/form-layout.ts`（新增 v2 布局规则并保持既有导出兼容）
- Modify `apps/admin-web/app/_lib/merchant-console/template-manager-view.tsx`（三标签外壳与内容设计面板）

Interfaces（全部为纯函数，输入输出均为 `DraftConfigV2` 子集）：

- `addSection(config, { label, columns })`、`removeSection(config, sectionKey)`、`moveSection(config, sectionKey, direction)`
- `addComponent(config, kind, sectionKey)`、`removeComponent(config, stableKey)`、`toggleComponentEnabled(config, stableKey, enabled)`、`moveComponent(config, stableKey, direction)`
- `insertPreset(config, sectionKey, preset: "STAFFING_TABLE" | "OPTION_PRICE")`：生成普通组件（不保留预设身份）
- `addTableColumn(config, componentKey)`、`removeTableColumn(config, componentKey, columnKey)`、`addDefaultRow(config, componentKey)`、`removeDefaultRow(config, componentKey, index)`
- `referencedComponentKeys(config): Set<string>`（`staffingSource` 引用）、`guardRemoveComponent(config, stableKey): { ok: true } | { ok: false; reason: string }`
- `isDirty(saved: DraftConfigV2 | null, draft: DraftConfigV2): boolean`（规范化比较）
- `layoutV2Rows(config: DraftConfigV2): Array<{ sectionKey: string; rows: Array<{ components: TemplateComponentV2[]; widthUsed: number }> }>`（按区块列数、组件 `colSpan`、`rowBreakBefore` 计算行）
- `columnSpanLabel(columns: number, colSpan: number): string`（按真实列数返回「整行」「半宽」或「n 分之 m」，不写死文案）

Steps:

- [ ] 先写 `template-draft-state.spec.ts`：新增两到五个区块、插入两个预设后可按普通组件编辑、禁用保留配置、删除被 `staffingSource` 引用的组件被阻止、stableKey 全局唯一、移动顺序稳定（含键盘同路径）。
- [ ] 实现状态模型（不可变更新，禁止原地修改；stableKey 用 `newStableKey()` 生成且不与现有键冲突）。
- [ ] 扩展 `TemplateFormRenderer`：按 `enabled` 决定渲染，禁用组件在编辑器内弱化显示（预览默认跳过禁用项，需与 `form-layout.ts` 规则一致）。
- [ ] 编辑器外壳：三标签（内容设计 / 业务绑定与计算 / 发布设置与版本历史），标签切换写入 URL `tab`。
- [ ] 编辑器内不出现 copyLines 编辑入口（旧字段既不展示也不提交）；自动文案预览放在内容设计预览区与发布标签。
- [ ] 内容设计：区块卡片（列数、启用、删除、上移/下移）、组件卡片（启用开关、必填、另起一行、列宽）、网格空位「添加内容」（普通字段 / 可重复表格 / 说明 / 新分区 / 参考预设）。
- [ ] 可重复表格：增删列、列类型、默认行增删。

Focused verification:

- `& '.\node_modules\.bin\vitest.cmd' run apps/admin-web/app/_lib/merchant-console/template-draft-state.spec.ts apps/admin-web/app/_lib/merchant-console/form-layout.spec.ts`
- `corepack pnpm --filter @pw/admin-web typecheck`

Recovery: 状态模型与渲染器均为新增纯逻辑，删除两文件并恢复 `template-manager-view.tsx` 的该段即可回退。

## Task 4：业务绑定与计算标签

Objective: 交付人数来源绑定、选项价格调整、引用保护与结构化校验错误定位。

Files:

- Create `apps/admin-web/app/_lib/merchant-console/template-binding.ts`
- Create `apps/admin-web/app/_lib/merchant-console/template-binding.spec.ts`
- Modify `apps/admin-web/app/_lib/merchant-console/template-manager-view.tsx`（绑定标签面板）

Interfaces:

- `staffingCandidates(config): Array<{ componentKey: string; label: string; kind: "NUMBER_FIELD" | "REPEATABLE_TABLE_SUM"; columnKey?: string }>`：只返回启用区块中的启用组件（与 `validateDraftConfigV2` 的判定一致）。
- `setStaffingSource(config, source: StaffingSourceV2)`、`setOptionPrice(config, componentKey, optionValue, priceDeltaFen: string)`、`formatFenToYuan(priceDeltaFen: string): string`（仅展示，不参与计算）。
- `mapIssuesToLocation(issues: TemplateConfigIssue[]): { tab: "content" | "binding"; sectionKey?: string; componentKey?: string; message: string }[]`

Steps:

- [ ] 先写 `template-binding.spec.ts`：候选过滤、禁用组件不可被引用、非数字字段不可作为人数来源、价格必须是十进制字符串（拒绝 `1.5`/`1000` number）、issue → 位置映射。
- [ ] 实现绑定面板：人数来源三选一（固定人数 / 数字字段 / 表格列汇总）+ stableKey 选择器（显示 label 与 stableKey，不显示 fieldKey 作为业务键）。
- [ ] 选项价格：每个选项独立开关 + 分值输入（十进制字符串）+ 元显示；不允许负值与前导零。
- [ ] 删除/禁用被引用组件时给出可定位提示并阻止（禁用允许但立即产生可见校验错误，未修复不可发布）。
- [ ] 校验错误通过 `aria-live` 宣告，并定位到标签 + 区块 + 字段（含焦点移动）。

Focused verification:

- `& '.\node_modules\.bin\vitest.cmd' run apps/admin-web/app/_lib/merchant-console/template-binding.spec.ts`
- `corepack pnpm --filter @pw/admin-web typecheck`

Recovery: 绑定面板为独立新增模块；回退只影响该标签渲染。

## Task 5：保存、发布、版本历史与 409 处理

Objective: 交付发布设置与版本历史标签，以及草稿/发布分离、冲突保留、次级生命周期操作。

Files:

- Create `apps/admin-web/app/_lib/merchant-console/template-document-preview.ts`
- Create `apps/admin-web/app/_lib/merchant-console/template-document-preview.spec.ts`
- Modify `apps/admin-web/app/_lib/merchant-console/template-manager-view.tsx`（发布标签、次级菜单、冲突对话框）

Interfaces:

- `previewDocument(config: DraftConfigV2, values?: TemplateValueSample): { table: Array<{ label: string; value: string }>; text: string }`
  —— 纯前端镜像服务端 `game-template-document.ts` 的规则（只输出纯文本、上限与转义一致）；测试用与 `apps/api/src/modules/game-dispatch/domain/game-template-document.spec.ts` 相同的工作示例，作为跨包一致性证据，并注明「服务端仍是唯一事实源」。
- 保存/发布调用：`saveTemplateDraft(id, { expectedRevision, config })`、`publishTemplate(id, { expectedRevision, changeNote })`、`restoreTemplate(id, { versionId, expectedRevision })`、`setDefaultTemplate` / `archiveTemplate` / `unarchiveTemplate` / `deleteTemplate`。

Steps:

- [ ] 先写 `template-document-preview.spec.ts`：固定人数、数字字段人数、表格汇总人数三种来源的文案表格与纯文本；未知旧组件输出安全占位。
- [ ] 实现镜像渲染器（不使用 `dangerouslySetInnerHTML`，说明文本按纯文本渲染）。
- [ ] 保存草稿：`expectedRevision` 取服务端最新 revision，成功后刷新详情并提示；不改变线上版本展示。
- [ ] 预览草稿：用当前草稿 + 表单渲染器渲染，并展示自动文案表格示例（Task 5 的镜像渲染器）。
- [ ] 发布：调用 `publishTemplate`；`TEMPLATE_*_INVALID` / `TEMPLATE_LEGACY_REVIEW_REQUIRED` 展示 `details.issues` 并定位；成功后刷新版本历史。
- [ ] 版本历史：`fetchTemplateVersions` 游标分页，显示 `versionNo/schemaVersion/发布时间/发布人/备注/是否生效`；`sourceVersionId` 恢复后发布时回传。
- [ ] 状态栏常驻显示：线上版本号、草稿 `revision`、最后编辑人、是否存在未发布改动、`lastUsedAt`；`status` 与 `hasUnpublishedChanges` 取自接口，不在前端猜测。
- [ ] `TEMPLATE_LEGACY_REVIEW_REQUIRED` 时给出「需要人工确认的旧价格规则」提示块，并说明修复路径（绑定或移除后重试发布）。
- [ ] 次级菜单：复制（目标游戏 + 新名称）、设默认、归档、取消归档、删除（删除二次确认，`TEMPLATE_DELETE_RESTRICTED` 时引导归档）。
- [ ] `CS` 角色下保存/发布/复制/设默认/归档/取消归档/删除入口全部不渲染；只保留查看与版本历史。
- [ ] 409 冲突：保留本地草稿，提供「重新加载服务端」与「复制我的内容」两个动作，并显示 `currentEditor/currentUpdatedAt`；不自动覆盖。
- [ ] 归档态：`save/publish/default` 按钮禁用并解释原因；历史与详情仍可读。

Focused verification:

- `& '.\node_modules\.bin\vitest.cmd' run apps/admin-web/app/_lib/merchant-console/template-document-preview.spec.ts`
- `corepack pnpm --filter @pw/admin-web typecheck`

Recovery: 发布标签可单独隐藏（`tab=release` 不可达）而不影响草稿编辑；服务端已发布版本不受影响。

## Task 6：无障碍、键盘与组件测试收口

Objective: 让键盘路径与屏幕阅读器路径与鼠标路径等价。

Files:

- Create `apps/admin-web/app/_lib/merchant-console/template-a11y.spec.ts`
- Modify `apps/admin-web/app/_lib/merchant-console/template-manager-view.tsx`

Steps:

- [ ] 排序按钮同时支持鼠标与键盘，键盘上下移动结果与拖动一致（断言顺序数组相等）。
- [ ] 对话框/抽屉关闭后焦点回到触发元素；`McDialog` 复用现有实现时补充焦点回归断言。
- [ ] 校验错误用 `aria-live="polite"` 宣告，错误项与控件通过 `aria-describedby` 关联。
- [ ] 页面提供 skip link、landmark（`main`）与唯一 `h1`；表单控件有 label。
- [ ] 纯逻辑断言写入 `template-a11y.spec.ts`（顺序等价、焦点目标计算、aria 文案生成）。

Focused verification:

- `& '.\node_modules\.bin\vitest.cmd' run apps/admin-web/app/_lib/merchant-console`
- `corepack pnpm --filter @pw/admin-web typecheck`

Recovery: 无障碍改动为增量属性与焦点管理，可逐条回退。

## Task 7：管理主路径 E2E、构建与验收

Objective: 用真实本地 S2 API 证明主路径与异常路径可用，并完成 S3 验收记录。

Files:

- Modify `tests/e2e/merchant-console-admin.spec.ts`
- Create `docs/acceptance/2026-09-16-s3-template-manager-ui.md`

Preconditions（权限点 2）：

- API 运行在 3000，`DATABASE_URL`/`PLATFORM_DATABASE_URL`/`PW_TEST_*` 指向 `pw_saas_s2_task2_20260916`，`PAYMENT_PROVIDER=mock`，`SESSION_SECRET` 为测试值；
- admin dev/build 运行在 3005，`NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:3000`；
- 使用已存在的测试门店账号登录（不得写入真实租户数据）。

Steps:

- [ ] 先写失败用例：模板列表按游戏筛选 → 新建模板 → 添加 2 个区块 → 插入「岗位与人数」预设 → 禁用后重新启用 → 保存草稿（revision 递增）→ 预览自动文案表格 → 发布 → 版本历史出现 v1 → 再次保存草稿出现 `UNPUBLISHED_CHANGES` → 归档 → 取消归档。
- [ ] 增加冲突用例：两个浏览器上下文对同一模板保存，第二个必须看到 409 对话框且本地草稿仍在。
- [ ] 增加键盘用例：仅用键盘完成排序与保存。
- [ ] 运行 `corepack pnpm --filter @pw/admin-web build`（生产构建）。
- [ ] 运行 Playwright `admin` 项目（msedge channel，headless）。
- [ ] 写 `docs/acceptance/2026-09-16-s3-template-manager-ui.md`：真实命令与退出码、测试库与租户、契约 operation 清单、未验证项与降级（例如未做视觉回归、未做深色模式、未做真机触控）。

Focused verification:

- `corepack pnpm --filter @pw/admin-web typecheck`（退出码 0）
- `corepack pnpm --filter @pw/admin-web build`（退出码 0）
- `& '.\node_modules\.bin\playwright.cmd' test --project=admin tests/e2e/merchant-console-admin.spec.ts`（退出码 0）

Recovery: E2E 使用唯一测试门店夹具并按 tenant 清理；界面可回退到列表只读态（隐藏编辑与发布入口）。

## 执行顺序与并行边界

1. Task 0 → Task 1 必须串行（Task 1 定义后续全部任务的类型与调用入口）。
2. Task 2 依赖 Task 1；Task 3 依赖 Task 1（`DraftConfigV2` 镜像类型）；Task 4 依赖 Task 3（stableKey 编辑能力）；Task 5 依赖 Task 3 与 Task 4（校验定位）；Task 6 依赖 Task 2–5 的组件结构。
3. Task 2/3/4/5/6 都要改 `template-manager-view.tsx`，**不得并行**；若需并行，只能并行「纯逻辑文件 + 其 spec」（如 Task 3 的 `template-draft-state.ts` 与 Task 5 的 `template-document-preview.ts`），合并时以 Task 3 的模型为准。
4. Task 7 只能在前序任务各自证据通过后执行；`docs/acceptance/` 写入需要一次获批的直接写入（工具限制）。
5. 每个 Task 结束时必须在报告中标注：改动文件、命令与退出码、未验证项；不得把"代码已改"表述为"已通过"。

## 停止点与后续

- 本计划只覆盖 S3。S4（新建派单交互与订单快照）与 S5（灰度观测与兼容收口）各自需要新的计划与授权。
- 计划获批后，实施阶段按 `pw-frontend-ui` 判定为**模式 B（admin 新栈实现）**，唯一对应技能为 `vercel-react-best-practices`（`C:\Users\Listener\.codex\skills\react-best-practices\SKILL.md`）；若你要求先做视觉方向调整，则先进入模式 A（`frontend-design`），两阶段不得并行。

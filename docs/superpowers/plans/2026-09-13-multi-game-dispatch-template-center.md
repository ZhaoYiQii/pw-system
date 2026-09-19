# Multi-game Dispatch Template Center v2 Implementation Plan

Goal: 将订单中心升级为按游戏管理模板、草稿与发布分离、派单锁定不可变版本且历史订单可追溯的完整流程。

Architecture: 复用现有 Game，GameDispatchTemplate 保存可编辑草稿，GameDispatchTemplateVersion 保存不可变发布快照，GameDispatchOrder 与 GameDispatchTemplateSnapshot记录创建时版本。现有 API 在兼容期保留，v2 接口按游戏、状态和游标返回摘要，admin-web 使用 TanStack Query 和共享表单渲染器完成管理与派单。

Tech stack: Node.js 24.19.0、Corepack pnpm 10.34.5、TypeScript 5.9 strict、NestJS 12、Prisma 7.10、PostgreSQL 18、Next.js 16.3、React 19.2、TanStack Query 5、Tailwind v4、Vitest 3.2、Playwright 1.63。

Spec: docs/superpowers/specs/2026-09-13-multi-game-dispatch-template-center-design.md

Scope and non-goals: 实现规格中的游戏归属、草稿/发布、版本、语义角色、权限、管理界面、新建派单和兼容迁移；不实现跨租户模板市场、模板继承、像素级画布、计价引擎重构、订单状态机重构、支付重构、移动端编辑器、旧模板自动猜游戏或历史订单改写。

Permission gates: 生成迁移文件和本地代码已由“批准规格 开始实施”授权；执行任何数据库迁移、启动会改变数据的服务、安装依赖、创建分支、提交、推送、部署、远程数据库修改或生产回退都需要届时单独确认。

Completion evidence: 每个切片运行定向 Vitest、受影响包 typecheck、ESLint 和 Prettier；API 切片运行 integration、tenant-isolation、contract 与 openapi:check；UI 切片运行持久 Playwright；最终运行根级 typecheck、lint、format:check、test、test:integration、test:tenant-isolation、test:contract、openapi:check、admin build，并在得到授权后运行 db:migrate:check 与迁移测试。

## 项目状态与约束

- 当前分支 master，基线提交 97bcc4c；工作树已有大量用户未提交改动。
- 本功能与 packages/database/prisma/schema.prisma、game-dispatch 模块、admin-web 商家控制台和 E2E 的既有未提交改动重叠。实施必须以当前工作树为基线，只做定向补丁，不回滚、不覆盖、不格式化无关文件。
- 使用 corepack pnpm，避免系统 pnpm 11.19.0 偏离 packageManager 10.34.5。
- 当前 Docker 访问能力在沙箱中不可用；需要集成测试时先做只读复核，执行本地测试库迁移仍须单独授权。
- API 契约以 openapi.yaml、openapi.json 和 packages/api-client/src 的生成结果为准，不手改生成客户端。
- 新 admin 功能使用 Tailwind v4、components/ui 和 TanStack Query；被改到的旧页面需要一次迁移完成，不能新旧栈混用。
- TypeScript strict；禁止 any、忽略类型、吞异常或空实现。
- 租户资源必须由服务端绑定 TenantContext，不能信任客户端 tenantId。
- 金额继续使用整数分或 MoneyFen，不引入浮点金额。

## 从批准规格逐字继承的边界

- 草稿保存与发布严格分离。
- 客服默认不可编辑或发布模板。
- 旧模板在人工归类前保持“未归类”。
- 每个游戏最多一个默认模板。
- 历史恢复先生成草稿，不直接上线。
- 已发布或已被引用的模板不可硬删除。
- 当前没有遗留的产品级开放决策；实施中若出现超出本规格的行为或数据边界变化，必须返回设计阶段复核。

## Slice S1：领域模型与兼容底座

Objective: 建立游戏归属、模板生命周期、语义角色和不可变发布版本的数据与领域基础，不切换现有 API/UI 的运行路径。

Spec coverage: 第 5、6、7、12、13、14、15 节中的领域模型、数据库、迁移兼容、租户隔离和基础测试。

Files:

- Modify packages/database/prisma/schema.prisma
  - 扩展 GameDispatchTemplate、GameDispatchTemplateField、GameDispatchTemplateSnapshot、GameDispatchOrder。
  - 新增 GameDispatchTemplateStatus 枚举和 GameDispatchTemplateVersion 模型。
- Create packages/database/prisma/migrations/20260913100000_multi_game_template_versions/migration.sql
  - 做 expand-compatible 变更、旧模板版本 1 回填、索引、外键、CHECK 和 RLS；不删除表、列或业务数据。
- Modify apps/api/src/modules/game-dispatch/domain/game-template.ts
  - 新增 GameTemplateStatus、GameTemplateSemanticRole、GameTemplateVersionConfig、GameTemplateSummary 和修订字段。
- Create apps/api/src/modules/game-dispatch/domain/game-template-lifecycle.ts
  - 纯领域函数：语义角色唯一性、发布快照组装、归档恢复状态、修订比较。
- Create apps/api/src/modules/game-dispatch/domain/game-template-lifecycle.spec.ts
  - 领域红绿测试，不依赖数据库。
- Create tests/integration/game-dispatch-template-migration.spec.ts
  - 迁移后版本回填、未归类、默认唯一、RLS 和外键检查；仅在获准迁移测试库后执行。

Interfaces produced:

- GameTemplateStatus = DRAFT | PUBLISHED | ARCHIVED。
- GAME_TEMPLATE_SEMANTIC_ROLES 和 GameTemplateSemanticRole。
- PublishedGameTemplateConfigV1，固定 schemaVersion 为 1。
- assertUniqueSemanticRoles(fields)。
- assertExpectedRevision(expected, actual)。
- nextStatusAfterUnarchive(activeVersionId)。
- 数据库 GameDispatchTemplateVersion 及 templateId + versionNo 唯一约束。

Preconditions and gates:

- 以现有 20260912090000_dispatch_template_sections 迁移及当前 schema 为基础。
- 不执行 migrate:deploy、migrate:dev、seed 或任何数据库写入。
- Prisma generate 只更新本地生成客户端，不连接数据库。

Steps:

- [ ] 在 game-template-lifecycle.spec.ts 写失败测试：非 CUSTOM 语义角色重复被拒绝，CUSTOM 可重复，旧 revision 被拒绝，取消归档状态由 activeVersionId 决定。
- [ ] 在 game-template.ts 定义状态、语义角色、发布配置和摘要类型。
- [ ] 在 game-template-lifecycle.ts 实现使领域测试转绿的最小纯函数。
- [ ] 在 schema.prisma 增加可空 gameId、description、status、activeVersionId、revision、isDefault、lastUsedAt、createdBy、updatedBy、archivedAt、normalizedName 和 semanticRole。
- [ ] 新增 GameDispatchTemplateVersion；为 templateId、tenantId、gameId、activeVersionId 等外键访问路径建立索引。
- [ ] 在 GameDispatchTemplateSnapshot 与 GameDispatchOrder 增加可空 templateVersionId 和 gameId，保持旧写路径兼容。
- [ ] 编写 expand-compatible SQL：建枚举/表/列/索引/RLS；生成 normalizedName；用“已归类模板按 tenantId + gameId + normalizedName 唯一、未归类模板按原有 tenantId + name 语义唯一”的两个部分索引替换旧全局 tenantId + name 唯一索引；为每个旧模板生成 versionNo=1、schemaVersion=1 的 config_json；旧 gameId 保持 NULL。
- [ ] SQL 先建版本行再回填 active_version_id；旧 enabled=true 模板回填为 PUBLISHED，enabled=false 模板回填为 ARCHIVED 并设置 archivedAt；不修改旧订单快照。
- [ ] 在迁移测试文件声明回填、RLS、唯一约束和跨租户外键预期，不在未授权时运行。

Verification:

- corepack pnpm vitest run apps/api/src/modules/game-dispatch/domain/game-template-lifecycle.spec.ts
  - 预期：新增领域用例全部通过。
- corepack pnpm --filter @pw/database generate
  - 预期：Prisma schema 校验并成功生成客户端。
- corepack pnpm --filter @pw/database typecheck
  - 预期：退出码 0。
- corepack pnpm --filter @pw/api typecheck
  - 预期：退出码 0。
- corepack pnpm exec eslint apps/api/src/modules/game-dispatch/domain/game-template.ts apps/api/src/modules/game-dispatch/domain/game-template-lifecycle.ts apps/api/src/modules/game-dispatch/domain/game-template-lifecycle.spec.ts
  - 预期：退出码 0。
- corepack pnpm exec prettier --check apps/api/src/modules/game-dispatch/domain/game-template.ts apps/api/src/modules/game-dispatch/domain/game-template-lifecycle.ts apps/api/src/modules/game-dispatch/domain/game-template-lifecycle.spec.ts tests/integration/game-dispatch-template-migration.spec.ts
  - 预期：退出码 0。
- git diff --check -- packages/database/prisma/schema.prisma packages/database/prisma/migrations/20260913100000_multi_game_template_versions/migration.sql
  - 预期：退出码 0；SQL 语法与约束由获准后的测试库迁移演练验证。
- 经数据库迁移授权后：corepack pnpm test:integration -- game-dispatch-template-migration
  - 预期：旧模板版本 1、未归类、唯一约束、RLS 与外键用例通过。

Recovery:

- 未执行数据库迁移时，删除本切片新增迁移目录并反向移除本切片 schema/domain 增量即可恢复；不得触碰 20260912090000 迁移。
- 若已获准在测试库执行迁移，恢复方式是重建一次性测试库；不对共享或生产数据库执行 down migration。

## Slice S2：模板管理 API 与权限

Objective: 提供摘要列表、草稿保存、发布、版本历史、恢复、复制、默认和归档 API，并保留旧接口兼容读路径。

Spec coverage: 第 4、7、8、12、13、15 节中的权限、生命周期、API、安全、审计和性能。

Files:

- Modify apps/api/src/modules/identity-access/domain/roles.ts
  - 增加 gameDispatch.create、gameTemplate.view、gameTemplate.edit、gameTemplate.publish、gameTemplate.archive，并调整默认角色矩阵。
- Modify apps/api/src/common/validation/api-validation-rules.ts
  - 为 v2 查询与请求体增加严格 Zod 边界验证。
- Modify apps/api/src/modules/game-dispatch/domain/errors.ts
  - 增加修订冲突、发布校验、已归档和受限删除错误。
- Modify apps/api/src/modules/game-dispatch/domain/game-template.ts
  - 定义输入、摘要、详情、分页、版本历史和结构化验证错误。
- Modify apps/api/src/modules/game-dispatch/application/game-template.service.ts
  - 实现权限无关的用例编排与发布校验。
- Modify apps/api/src/modules/game-dispatch/infrastructure/prisma-game-template.repository.ts
  - 实现摘要分页、整份草稿事务保存、原子乐观锁、发布版本、历史恢复、复制到游戏、默认唯一和归档。
- Modify apps/api/src/modules/game-dispatch/interface/game-template.controller.ts
  - 增加 v2 路由并映射统一 HTTP 错误。
- Modify apps/api/src/modules/game-dispatch/game-dispatch.module.ts
  - 接入 AuditModule/AuditService。
- Modify tests/integration/game-dispatch-template.spec.ts
  - 保留旧 CRUD 兼容测试并适配默认权限。
- Create tests/integration/game-dispatch-template-v2.spec.ts
  - 覆盖完整管理 API、发布与 409。
- Create tests/tenant-isolation/game-dispatch-template-v2.spec.ts
  - 覆盖跨租户游戏、模板和版本访问。
- Modify openapi.yaml、openapi.json、packages/api-client/src
  - 只通过 openapi:generate 生成。

Interfaces consumed:

- S1 的 PublishedGameTemplateConfigV1、revision、status、semanticRole 和版本表。

Interfaces produced:

- GET /api/v1/tenant/game-dispatch-templates。
- POST /api/v1/tenant/game-dispatch-templates。
- GET/PATCH /api/v1/tenant/game-dispatch-templates/:id/draft。
- POST /api/v1/tenant/game-dispatch-templates/:id/publish。
- GET /api/v1/tenant/game-dispatch-templates/:id/versions。
- POST /restore、/copy、/archive、/unarchive、/default。
- 409 TEMPLATE_REVISION_CONFLICT 的稳定错误码和 details。

Steps:

- [ ] 先在 game-dispatch-template-v2.spec.ts 建立列表摘要、游戏校验、草稿不影响生效版本、发布、冲突、恢复、归档和受限删除的失败测试。
- [ ] 在 tenant-isolation 测试建立跨租户 gameId、templateId、versionId 全部拒绝的失败测试。
- [ ] 扩展集中权限矩阵：客服默认只可查看和派单，Owner/Admin 可编辑发布归档。
- [ ] 增加严格请求/查询验证，不接受客户端 tenantId 和未知字段。
- [ ] 仓储使用带 tenantId 的条件更新原子校验 revision；受影响行数为 0 时读取当前修订并返回 409。
- [ ] 发布事务创建不可变版本并更新 activeVersionId；恢复只生成新草稿。
- [ ] 列表只 select 摘要字段并使用游标分页，详情按 id 加载。
- [ ] 写入编辑、发布、恢复、默认、归档和删除审计事件。
- [ ] 生成 OpenAPI 和客户端，并检查生成差异仅对应新契约。

Verification:

- corepack pnpm vitest run --config tests/vitest.integration.config.ts tests/integration/game-dispatch-template.spec.ts tests/integration/game-dispatch-template-v2.spec.ts
- corepack pnpm vitest run --config tests/vitest.tenant-isolation.config.ts tests/tenant-isolation/game-dispatch-template-v2.spec.ts
- corepack pnpm test:contract
- corepack pnpm openapi:check
- corepack pnpm --filter @pw/api typecheck
- corepack pnpm lint

Recovery:

- v2 路由由功能开关关闭后，旧接口继续读取现有草稿结构；版本记录保持只读，不删除。

## Slice S3：模板管理界面

Objective: 将模板管理迁移到按游戏、草稿/发布和版本历史驱动的新栈界面。

Spec coverage: 第 9、13、14、15 节中的管理交互、URL 状态、共享渲染、无障碍和管理流程。

Files:

- Modify apps/admin-web/app/_lib/merchant-console/merchant-api.ts
  - 增加游戏、模板摘要、草稿、版本、修订冲突的前端契约。
- Modify apps/admin-web/app/_lib/merchant-console/template-manager-view.tsx
  - 迁移为游戏/状态筛选、四标签编辑器和草稿/发布操作。
- Modify apps/admin-web/app/_lib/merchant-console/template-form-renderer.tsx
  - 支持 semanticRole 和准确布局标签。
- Modify apps/admin-web/app/_lib/merchant-console/form-layout.ts
  - 保持编辑器、预览和派单共用布局计算。
- Modify apps/admin-web/app/_lib/merchant-console/form-layout.spec.ts
  - 增加动态列数与布局标签测试。
- Modify apps/admin-web/app/(tenant)/merchant-console/dispatch/templates/page.tsx
  - 从 searchParams 恢复 gameId、status、templateId、tab。
- Modify apps/admin-web/app/globals.css
  - 只扩展现有 token 或通用 utility。
- Modify apps/admin-web/app/merchant-console.css
  - 删除被迁移页面实际不再使用的旧选择器；保留其他页面仍引用的样式。
- Modify tests/e2e/merchant-console-admin.spec.ts
  - 增加按游戏筛选、脏状态、保存草稿、发布、历史恢复、409 和键盘交互。

Steps:

- [ ] 先写 Playwright 失败路径，固定游戏筛选、保存不即时上线、发布成功和冲突提示。
- [ ] 把 API 数据按摘要与详情分离，Query key 包含 gameId、status、q、cursor。
- [ ] 用 URL 保存筛选和标签状态，不写入敏感表单值。
- [ ] 将主要操作固定为保存草稿、预览草稿、发布，危险操作进入次级菜单。
- [ ] fieldKey 收入高级设置，新增语义角色选择器。
- [ ] 显示线上版本、草稿修订、最近编辑人和未发布改动。
- [ ] 将验证结果定位到标签/区块/字段并使用 aria-live。
- [ ] 处理 409：不丢本地草稿，提供重新加载和复制内容。

Verification:

- corepack pnpm vitest run apps/admin-web/app/_lib/merchant-console/form-layout.spec.ts
- corepack pnpm --filter @pw/admin-web typecheck
- corepack pnpm exec eslint apps/admin-web/app/_lib/merchant-console
- corepack pnpm playwright test tests/e2e/merchant-console-admin.spec.ts --grep 模板
- corepack pnpm --filter @pw/admin-web build

Recovery:

- 功能开关退回旧模板管理入口；不清理草稿和版本数据。

## Slice S4：多游戏新建派单与订单版本快照

Objective: 新建派单按客户/游戏、模板、表单/岗位三个阶段运行，并锁定发布版本、幂等创建和保存订单快照。

Spec coverage: 第 8.2、10、11、13、14、15 节。

Files:

- Modify apps/api/src/common/validation/api-validation-rules.ts
  - 扩展派单创建体：gameId、templateVersionId、idempotencyKey。
- Modify apps/api/src/modules/game-dispatch/application/game-dispatch.service.ts
  - 从发布版本读取配置，以 semanticRole 取模式/段位，校验归属/归档并保存版本快照。
- Modify apps/api/src/modules/game-dispatch/interface/game-dispatch.controller.ts
  - 暴露按游戏模板摘要、版本表单和幂等创建契约。
- Modify apps/admin-web/app/_lib/merchant-console/merchant-api.ts
  - 增加派单阶段契约。
- Modify apps/admin-web/app/_lib/merchant-console/new-order-view.tsx
  - 实现三阶段、版本锁定、会话缓存、切换确认和空状态。
- Modify apps/admin-web/app/_lib/merchant-console/new-order-dialog.tsx
  - 保持焦点、关闭确认和创建后回调。
- Modify apps/admin-web/app/(tenant)/merchant-console/dispatch/new/page.tsx
  - 读取 gameId/templateId 深链。
- Modify tests/integration/game-dispatch-template.spec.ts
  - 保持旧创建路径兼容。
- Create tests/integration/game-dispatch-order-v2.spec.ts
  - 覆盖游戏/模板/版本关系、语义角色、归档、旧版本和幂等。
- Modify tests/e2e/merchant-console-admin.spec.ts
  - 覆盖多游戏派单、模板切换值恢复和空状态。

Steps:

- [ ] 先写 integration 红测试：错游戏、错版本、归档模板、未知字段、重复幂等键和旧发布版本。
- [ ] 先写 Playwright 红测试：三阶段、默认模板、切换确认、切回恢复和无模板跳转。
- [ ] 服务端只从发布 configJson 获取启用字段和校验规则。
- [ ] 使用 semanticRole 提取 modeLabel 和 targetRankLabel。
- [ ] 在同一事务创建订单、派单、版本关联、配置快照、幂等记录和审计事件。
- [ ] 相同幂等键不同请求体返回明确冲突。
- [ ] 前端每次创建意图生成一次 key，重试复用，成功或重置表单后才生成新 key。
- [ ] 模板归档时拒绝创建并保留前端输入；仅发布新版本时允许按已锁定旧版本提交。

Verification:

- corepack pnpm vitest run --config tests/vitest.integration.config.ts tests/integration/game-dispatch-order-v2.spec.ts
- corepack pnpm test:tenant-isolation
- corepack pnpm test:contract
- corepack pnpm openapi:check
- corepack pnpm playwright test tests/e2e/merchant-console-admin.spec.ts --grep 新建派单
- corepack pnpm --filter @pw/api typecheck
- corepack pnpm --filter @pw/admin-web typecheck
- corepack pnpm --filter @pw/admin-web build

Recovery:

- 关闭 v2 派单入口后恢复旧入口；已经创建的订单继续从自身快照读取，不回写模板。

## Slice S5：灰度、观测、兼容收口

Objective: 增加租户级 v2 开关、可观测指标、迁移审计和安全回退说明，在数据完成归类前不删除旧路径。

Spec coverage: 第 12、13、16、17、18 节中的灰度、观测、验收和回退。

Files:

- Modify apps/api/src/modules/tenant-config/domain/tenant-config.ts
  - 增加 gameDispatchTemplateV2 功能开关。
- Modify apps/api/src/modules/tenant-config/application/config.service.ts
  - 校验并读取租户级开关。
- Modify apps/api/src/modules/game-dispatch/interface/game-template.controller.ts
- Modify apps/api/src/modules/game-dispatch/interface/game-dispatch.controller.ts
  - 按租户开关选择入口，保持旧路径只读兼容。
- Create scripts/audit-game-template-v2.mjs
  - 只读输出未归类、无生效版本、重名和孤立关联报告。
- Create docs/runbooks/game-template-v2-rollout.md
  - 开关、指标、灰度、回退和禁止破坏性回滚步骤。
- Modify docs/DEVELOPMENT_BACKLOG.md
- Modify PROJECT_STATUS.md
  - 只记录实际完成和验证状态。
- Modify tests/integration/game-dispatch-template-v2.spec.ts
- Modify tests/e2e/merchant-console-admin.spec.ts

Steps:

- [ ] 写开关关闭/开启时的失败测试。
- [ ] 实现租户级开关，不使用进程级全局开关隔离租户。
- [ ] 增加模板列表延迟、保存失败、409、发布失败、创建失败和版本不匹配结构化日志/指标。
- [ ] 编写只读审计脚本，默认拒绝无 DATABASE_URL 的执行，不修改数据。
- [ ] 编写灰度与回退 runbook。
- [ ] 完成测试租户灰度证据后更新状态文档。

Verification:

- corepack pnpm test
- corepack pnpm test:integration
- corepack pnpm test:tenant-isolation
- corepack pnpm test:contract
- corepack pnpm openapi:check
- corepack pnpm typecheck
- corepack pnpm lint
- corepack pnpm format:check
- corepack pnpm --filter @pw/admin-web build
- 获得 Docker 与迁移授权后运行 corepack pnpm db:migrate:check，并执行只读审计脚本。

Recovery:

- 对单个租户关闭 gameDispatchTemplateV2，保留全部版本和订单快照。
- 不删除新表、不回写旧订单、不在回退中执行数据破坏操作。

## 任务顺序与验收边界

- S1 是 S2 的类型和数据库前置；S2 是 S3、S4 的 API 前置；S3 与 S4 都依赖 S2，按仓库“一次一个 Slice”纪律顺序执行；S5 最后收口。
- 当前执行授权覆盖开始实施，但本轮只执行 S1。S1 完成并提交证据后停止，等待用户明确批准 S2。
- 计划文档不构成数据库迁移执行、Git 提交、推送或部署授权。

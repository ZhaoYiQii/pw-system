# Generic Dispatch Template S2 Implementation Plan

Goal: 在不改变旧模板 API、不切换新建派单运行路径、不执行数据库迁移的前提下，为 schemaVersion 2 通用模板提供可供 S3 管理界面消费的完整模板管理 API：摘要查询、创建与保存草稿、发布、版本历史、恢复、跨游戏复制、设默认、归档/取消归档和受限硬删除，并用权限、审计、租户隔离、乐观锁和服务端发布校验保护全部写路径。

Architecture: 保留现有 `/api/v1/tenant/game-templates` 及 `GameTemplateService` 作为 v1 兼容路径；在同一 NestJS `game-dispatch` 模块内新增独立的 generic-template controller/application service/Prisma repository。公开路径使用 `/api/v1/tenant/game-dispatch-templates`，应用层只接收 API 边界已由严格 Zod schema 验证的类型，领域层复用 S1/S1b 的生命周期和 v2 配置校验纯函数，repository 负责租户约束、行锁、原子写入和同事务审计。列表和版本历史使用稳定的复合游标，列表只查摘要；发布版本只增不改，草稿与线上版本严格分离。

Tech stack: Node.js 24.19.0、Corepack pnpm 10.34.5、TypeScript 5.9 strict、NestJS 12、Prisma 7.10、PostgreSQL 18、Zod 4.5、Vitest 3.2、Nest Swagger/OpenAPI、Hey API client generator；不新增依赖。

Spec: `docs/superpowers/specs/2026-09-13-multi-game-dispatch-template-center-design.md`

Scope and non-goals: 本计划只实施规格 S2“模板管理 API”。范围包含 v2 管理 API、权限矩阵、API 输入和响应契约、数据库事务、审计、并发与租户隔离测试、OpenAPI 及生成客户端。范围不包含 S3 模板管理界面、S4 新建派单/订单快照/人数与价格运行时计算、S5 灰度切换、移动端、旧接口收缩、旧表删除、数据库 schema 或迁移文件、数据库迁移执行、依赖安装、Git 操作和部署。S2 发布校验验证人数来源绑定和选项金额规则的配置合法性；没有订单填写值时不虚构运行时人数或价格结果，运行时计算接入留给 S4。

Permission gates: 本计划文档已获批准，可以编写；实施任何 S2 业务代码必须由用户另行批准准确 Task 或整个 S2。运行会写入测试数据库的 integration/tenant-isolation 测试、创建或清理测试夹具、启动会改变数据的容器或 API、执行任何 `prisma migrate`、修改 `pw_saas`、`pw_saas_test`、一次性演练库或远程数据库、安装依赖、创建分支、提交、推送、部署及生产回退都需要各自适用的明确授权。用户本次明确禁止执行数据库迁移；本计划也不新增或修改任何 migration。

Completion evidence: S2 实施完成时必须取得当前执行轮次的领域回归、API 合约、集成、并发、权限、租户隔离、OpenAPI 生成一致性、API typecheck、lint 和 format 退出码 0，并在 acceptance 文档记录命令与关键结果。未获测试库写权限时只能标记“代码已改、数据库集成未验证”；没有重新生成并检查 OpenAPI 时不能标记“API 契约完成”；没有当前证据时不能声称 locally-verified、ready 或 deployable。

## 项目现状与能力

- 当前分支为 `master...origin/master [ahead 1]`，工作树有大量用户未提交改动，并与 `game-dispatch`、API validation、Prisma schema、admin UI 和测试重叠。实施必须只补丁修改本计划列明的文件，不回滚、不覆盖、不批量格式化无关改动。
- Node 24.19.0 和 Corepack pnpm 10.34.5 当前可用；仓库命令统一使用 `corepack pnpm`。
- S1/S1b 的 `GameDispatchTemplate` 状态/修订/版本列、v2 草稿 JSON、领域校验、人数/价格纯函数和文案渲染器已在当前工作树中。S2 开始前先以 Task 0 门禁确认这些前置文件及 S1b acceptance 证据仍然存在。
- 当前数据库 schema 已具备 S2 所需的模板主记录和不可变版本表；S2 不需要 schema 变化。若实施时发现必须增加列、索引或约束，停止 S2 并返回设计/数据库计划，不得把迁移夹带进本切片。
- 当前权限只存在 `gameDispatch.manage` 固定角色矩阵，没有门店级自定义权限授予模型。S2 增加规格中的五个细粒度权限并落实默认角色矩阵，同时保留旧权限和旧路由。规格中“其他角色可由门店配置显式授权”需要已有通用授权能力才可实现；当前仓库不存在该能力，本切片不得临时发明权限配置表。该能力在进入需要自定义授权的 UI/上线切片前另行设计。
- 当前 API 没有通用游标工具。S2 在自己的领域契约中定义版本化、严格解码的 opaque base64url 游标，不引入全局分页框架。
- `openapi.yaml`、`openapi.json` 和 `packages/api-client/src/*.gen.ts` 为生成产物，只能通过 `corepack pnpm openapi:generate` 更新，禁止手工编辑。

## 从批准规格逐字继承的约束

- 草稿保存与发布严格分离。
- 客服默认不可编辑或发布模板。
- 旧模板在人工归类前保持“未归类”。
- 每个游戏最多一个默认模板。
- 历史恢复先生成草稿，不直接上线。
- 已发布或已被引用的模板不可硬删除。
- 岗位席位、段位加价和复制文案不再是新编辑器的固定模块。
- 岗位与人数和选择项加价仅作为可编辑参考预设。
- 人数和价格必须由发布快照中的稳定绑定驱动，禁止按显示名称或 fieldKey 猜测。
- copyLines 仅保留旧版本兼容；新派单文案由订单快照自动生成。
- 禁用保留配置，删除才移除配置。
- 已执行的 S1 迁移保持不变，通用组件通过新的 S1b 向前迁移扩展。
- 当前没有遗留的产品级开放决策；实施中若出现超出本规格的行为或数据边界变化，必须返回设计阶段复核。

## S2 公共 API 契约

批准规格中的逻辑路径统一落在项目已有的 tenant v1 前缀下；旧 `/api/v1/tenant/game-templates` 不改行为、不改响应：

| Method | Path                                                   | Permission             | Contract                                             |
| ------ | ------------------------------------------------------ | ---------------------- | ---------------------------------------------------- |
| GET    | `/api/v1/tenant/game-dispatch-templates`               | `gameTemplate.view`    | `gameId/status/q/sort/cursor/limit` 摘要列表         |
| POST   | `/api/v1/tenant/game-dispatch-templates`               | `gameTemplate.edit`    | 创建指定游戏的 v2 DRAFT                              |
| GET    | `/api/v1/tenant/game-dispatch-templates/:id/draft`     | `gameTemplate.view`    | 草稿、revision、生效版本摘要                         |
| PATCH  | `/api/v1/tenant/game-dispatch-templates/:id/draft`     | `gameTemplate.edit`    | 整份 config + expectedRevision 保存                  |
| POST   | `/api/v1/tenant/game-dispatch-templates/:id/publish`   | `gameTemplate.publish` | expectedRevision + changeNote + 可选 sourceVersionId |
| GET    | `/api/v1/tenant/game-dispatch-templates/:id/versions`  | `gameTemplate.view`    | cursor/limit 版本摘要历史                            |
| POST   | `/api/v1/tenant/game-dispatch-templates/:id/restore`   | `gameTemplate.publish` | versionId + expectedRevision 克隆到草稿              |
| POST   | `/api/v1/tenant/game-dispatch-templates/:id/copy`      | `gameTemplate.edit`    | targetGameId + newName，创建独立 DRAFT               |
| POST   | `/api/v1/tenant/game-dispatch-templates/:id/default`   | `gameTemplate.edit`    | expectedRevision，设为该游戏唯一默认                 |
| POST   | `/api/v1/tenant/game-dispatch-templates/:id/archive`   | `gameTemplate.archive` | expectedRevision                                     |
| POST   | `/api/v1/tenant/game-dispatch-templates/:id/unarchive` | `gameTemplate.archive` | expectedRevision                                     |
| DELETE | `/api/v1/tenant/game-dispatch-templates/:id`           | `gameTemplate.archive` | expectedRevision，仅未发布且未引用                   |

实现细节固定如下：

- 新建请求是 `{ gameId, name, description? }`；验证 game 与模板同租户，初始 `status=DRAFT`、`revision=1`、`activeVersionId=null`、`isDefault=false`，草稿为有效的最小 `DraftConfigV2`。
- 保存响应为 `{ revision, updatedAt, updatedBy, validationWarnings }`；保存只运行草稿校验并递增 revision，不改变 activeVersionId、status 或已发布版本。
- 发布在事务内锁定模板行，复查 expectedRevision、归属和未归档状态，把草稿复制为不含 `legacyCompatibility` 且由服务端加入 `documentRendererVersion: 1` 的 `PublishedConfigV2`，运行发布校验，创建下一个 versionNo，更新 activeVersionId/status/revision。
- `sourceVersionId` 只允许引用同租户、同模板的历史版本；直接恢复后发布时由客户端回传 restore 响应中的 sourceVersionId，服务端再次验证归属后写入版本溯源。它不参与授权或选择发布配置，发布配置永远取当前服务器草稿。
- restore 只把历史 v2 配置去掉服务端字段后写入草稿并递增 revision，不创建版本、不切换 activeVersionId；schemaVersion 1 历史继续只读并返回 `TEMPLATE_VERSION_UNAVAILABLE`，不进行隐式转换。
- copy 复制源模板当前 v2 草稿到 targetGameId，生成新的 DRAFT；不复制 activeVersionId、版本历史、默认状态、lastUsedAt 或旧 copyLines。源为归档状态仍可复制，源没有合法 v2 草稿时拒绝。
- default 只允许 gameId 非空、未归档且有 activeVersionId 的模板。事务先清除同租户同游戏旧默认，再设置目标，并依赖已有部分唯一索引兜底；双方变更和审计必须原子完成。
- archive 清除 isDefault，保留草稿、activeVersionId 和历史；unarchive 根据 activeVersionId 恢复为 PUBLISHED 或 DRAFT。两者均递增 revision。
- hard delete 只允许 activeVersionId 为空、版本数为 0、订单快照/其他引用数为 0 的模板；否则返回 409 并提示归档。删除使用现有外键/引用事实，不信任客户端声明。
- 所有 mutation 均从 `req.principal.sub` 获取 actorId，从服务端 TenantContext 获取 tenantId；请求体不得出现 tenantId、createdBy、updatedBy、publishedBy、status、activeVersionId、revision 新值或 renderer version。
- 所有成功写入与精简审计在同一个数据库事务完成。action 固定为 `game_template.v2.create`、`draft_save`、`publish`、`restore`、`copy`、`set_default`、`archive`、`unarchive`、`delete`；summary 只记录名称、修订/版本和动作，不记录整份配置或用户订单值。
- 结构化业务错误统一为 `{ code, message, details? }`，其中 validation `details.issues` 只含 `code/path/componentKey?/message`；409 包括 `TEMPLATE_REVISION_CONFLICT`、`TEMPLATE_ARCHIVED`、`TEMPLATE_NAME_CONFLICT`、`TEMPLATE_DELETE_RESTRICTED`，404 为 `TEMPLATE_NOT_FOUND`，422 使用规格定义的 `TEMPLATE_VERSION_UNAVAILABLE`、`TEMPLATE_COMPONENT_INVALID`、`TEMPLATE_BINDING_INVALID`、`TEMPLATE_PRICE_RULE_INVALID`、`TEMPLATE_LEGACY_REVIEW_REQUIRED`。
- revision 冲突 details 固定带 `expectedRevision/currentRevision/currentEditor/currentUpdatedAt`；不得自动覆盖。
- 列表默认 `limit=30`、最大 100；版本历史默认 20、最大 100。列表 sort 固定为 `UPDATED_DESC | UPDATED_ASC | NAME_ASC | LAST_USED_DESC`，默认 UPDATED_DESC；status 固定为 `DRAFT | PUBLISHED | UNPUBLISHED_CHANGES | ARCHIVED`。游标编码 `{ v:1, sort, value, id }`，解码失败或排序不匹配返回 400。
- `UNPUBLISHED_CHANGES` 是查询/展示派生状态，不写数据库 enum；repository 通过当前草稿与 active version 配置的规范化 JSON 比较得出，不把完整 JSON 返回列表。游标比较始终追加 id 作为稳定 tie-breaker。
- 列表响应为 `{ data: GameTemplateSummary[], page: { nextCursor: string | null } }`；版本历史同形。列表只返回游戏摘要、状态、activeVersionNo、revision、isDefault、lastUsedAt、updatedAt/updatedBy 和 hasUnpublishedChanges，不加载旧 fields/sections/positions/rankRules/copyLines。

## S2 文件范围

### 修改

- `apps/api/src/modules/identity-access/domain/roles.ts`
- `apps/api/src/common/validation/api-validation-rules.ts`
- `apps/api/src/modules/game-dispatch/domain/errors.ts`
- `apps/api/src/modules/game-dispatch/game-dispatch.module.ts`
- `apps/api/src/openapi/schemas.ts`
- `openapi.yaml`（仅生成器）
- `openapi.json`（仅生成器）
- `packages/api-client/src/client.gen.ts`（仅生成器确有差异时）
- `packages/api-client/src/index.ts`（仅生成器）
- `packages/api-client/src/sdk.gen.ts`（仅生成器）
- `packages/api-client/src/types.gen.ts`（仅生成器）

### 新建

- `apps/api/src/modules/game-dispatch/domain/game-template-management.ts`
- `apps/api/src/modules/game-dispatch/domain/game-template-management.spec.ts`
- `apps/api/src/modules/game-dispatch/application/generic-game-template.service.ts`
- `apps/api/src/modules/game-dispatch/infrastructure/prisma-generic-game-template.repository.ts`
- `apps/api/src/modules/game-dispatch/interface/generic-game-template.controller.ts`
- `tests/integration/game-dispatch-template-v2.spec.ts`
- `tests/integration/game-dispatch-template-v2-concurrency.spec.ts`
- `tests/tenant-isolation/game-dispatch-template-v2.spec.ts`
- `tests/contract/game-dispatch-template-v2.spec.ts`
- `docs/acceptance/2026-09-15-s2-template-management-api.md`

### 明确不修改

- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/**`
- `apps/api/src/modules/game-dispatch/application/game-template.service.ts`
- `apps/api/src/modules/game-dispatch/infrastructure/prisma-game-template.repository.ts`
- `apps/api/src/modules/game-dispatch/interface/game-template.controller.ts`
- `apps/api/src/modules/game-dispatch/application/game-dispatch.service.ts`
- `apps/admin-web/**`
- `apps/mobile/**`
- 任何订单、派单快照、旧 positions/rankRules/copyLines 数据或 API。

## Task 0：锁定前置证据与红测试环境

Objective: 在不改代码、不写数据库的前提下确认 S1/S1b、当前 schema、生成器和目标测试库能力，避免 S2 建在未完成前置或错误数据库上。

Requirements:

- 检查 S1b acceptance、v2 domain tests、Prisma schema、迁移目录和 Git 重叠文件；不自动修复。
- 精确记录本轮允许使用的 `PW_TEST_MIGRATION_URL`，必须是用户授权的测试库；禁止回退到 `DATABASE_URL`。
- 不执行 `prisma migrate`、seed 或任何数据库写入。

Files inspected: `docs/acceptance/2026-09-14-s1b-template-conversion.md`、`packages/database/prisma/schema.prisma`、`apps/api/src/modules/game-dispatch/domain/game-template-config-v2.ts`、`apps/api/src/modules/game-dispatch/domain/game-template-lifecycle.ts`、根 `package.json`、`tests/vitest.integration.config.ts`、`tests/vitest.tenant-isolation.config.ts`。

Steps:

- [ ] 运行 `git status --short --branch`，把与 S2 文件重叠的用户改动列入实施日志；不得 reset/checkout。
- [ ] 运行纯读取检查 `rg -n "draftConfigJson|GameDispatchTemplateVersion|activeVersionId|revision" packages/database/prisma/schema.prisma`，确认 S2 不需要 schema 变化。
- [ ] 运行 S1b 纯领域回归，不连接数据库。
- [ ] 仅检查测试环境变量是否存在及目标数据库名是否在授权范围；不得输出密码或完整连接串。
- [ ] 如果 S1b 回归失败、schema 缺字段、测试 URL 指向 `pw_saas`/`pw_saas_test`/远程库或用户未授权写入，停止并报告，不进入 Task 1。

Focused verification:

- `corepack pnpm exec vitest run apps/api/src/modules/game-dispatch/domain/game-template-lifecycle.spec.ts apps/api/src/modules/game-dispatch/domain/game-template-config-v2.spec.ts apps/api/src/modules/game-dispatch/domain/game-template-calculations.spec.ts apps/api/src/modules/game-dispatch/domain/game-template-document.spec.ts`
- 预期：退出码 0；该命令不连接数据库。

Recovery: 无写入，无需回退。

## Task 1：固化管理领域契约、细粒度权限与 API 边界

Objective: 先以纯测试固定 S2 DTO、游标、状态派生、角色默认权限和结构化错误，再让 controller/service/repository 消费同一套契约。

Requirements:

- 保留 `gameDispatch.manage` 和现有角色映射，避免旧 API 失权。
- 新权限严格按批准规格：Owner/Admin 全部；Customer Service 只有 `gameDispatch.create`、`gameTemplate.view`；其余当前角色不默认获得新权限。
- Zod 使用 strict object/判别联合，拒绝额外字段、未知 schemaVersion、number 金额、越界数组和客户端控制字段。

Files:

- Create `apps/api/src/modules/game-dispatch/domain/game-template-management.ts`。
- Create `apps/api/src/modules/game-dispatch/domain/game-template-management.spec.ts`。
- Modify `apps/api/src/modules/identity-access/domain/roles.ts`。
- Modify `apps/api/src/modules/game-dispatch/domain/errors.ts`。
- Modify `apps/api/src/common/validation/api-validation-rules.ts`。

Interfaces produced:

- `GenericTemplateListQuery`、`GenericTemplateListPage`、`GenericTemplateDraftView`、`GenericTemplateVersionSummary`。
- `CreateGenericTemplateInput`、`SaveGenericTemplateDraftInput`、`PublishGenericTemplateInput`、`RestoreGenericTemplateInput`、`CopyGenericTemplateInput`、`ExpectedRevisionInput`。
- `encodeTemplateCursor`/`decodeTemplateCursor`，游标 v1 且与 sort 绑定。
- `GenericTemplateError` 的受控 code/status/details 映射；controller 不以 message 文本判断错误类型。

Red tests:

- [ ] 角色矩阵测试先证明 Owner/Admin 获得全部新权限，Customer Service 只有 create/view，PLAYER/FINANCE/CUSTOMER 不默认获得模板管理权限，旧 `gameDispatch.manage` 映射保持不变。
- [ ] 游标测试先覆盖四种排序、相同排序值用 id 稳定翻页、篡改/未知版本/排序不匹配拒绝。
- [ ] API validation 测试先覆盖请求额外 tenantId/status/rendererVersion 被拒绝、expectedRevision 为非负整数、gameId/versionId 为 UUID、金额必须十进制字符串、config 大小和联合分支上限。
- [ ] 错误契约测试先固定 400/404/409/422 与 details 形状，不泄露 draft config 或数据库错误。

Implementation steps:

- [ ] 在 management domain 文件集中声明 DTO、cursor 和错误响应类型；不 import NestJS 或 Prisma。
- [ ] 扩展 `PERMISSION_KEYS` 和 `ROLE_PERMISSIONS`，保留旧 key；不得在 controller 写角色名判断。
- [ ] 在 errors 文件增加显式 S2 错误类和 code，扩展 revision conflict 的 editor/updatedAt details，同时保持旧构造方可编译。
- [ ] 在 validation rules 为公共契约中的每条 route 注册 body/query schema；复用 S1b 限制常量，API 边界解析成明确类型。

Focused verification:

- `corepack pnpm exec vitest run apps/api/src/modules/game-dispatch/domain/game-template-management.spec.ts`
- `corepack pnpm --filter @pw/api typecheck`
- `corepack pnpm exec eslint apps/api/src/modules/identity-access/domain/roles.ts apps/api/src/common/validation/api-validation-rules.ts apps/api/src/modules/game-dispatch/domain/errors.ts apps/api/src/modules/game-dispatch/domain/game-template-management.ts apps/api/src/modules/game-dispatch/domain/game-template-management.spec.ts`
- 预期：红阶段新增测试失败；最小实现后全部退出码 0。

Recovery: 只撤销新 management 文件和新权限/validator/error 增量；旧权限、旧错误类和旧 route rules 保持原样。若权限变化使旧模板测试失败，先诊断兼容问题，不删除旧 permission key。

## Task 2：实现摘要查询、草稿创建/读取/保存与租户隔离

Objective: 建立 S2 独立竖切，先交付不 N+1 的摘要列表和可乐观锁保存的完整 v2 草稿，不触碰发布版本或旧 API。

Files:

- Create `apps/api/src/modules/game-dispatch/application/generic-game-template.service.ts`。
- Create `apps/api/src/modules/game-dispatch/infrastructure/prisma-generic-game-template.repository.ts`。
- Create `apps/api/src/modules/game-dispatch/interface/generic-game-template.controller.ts`。
- Modify `apps/api/src/modules/game-dispatch/game-dispatch.module.ts`。
- Create `tests/integration/game-dispatch-template-v2.spec.ts`。
- Create `tests/tenant-isolation/game-dispatch-template-v2.spec.ts`。

Repository/application interfaces:

- `GenericGameTemplateRepository.list(tenantId, query)` 一次摘要查询返回 limit+1，不调用 legacy assemble。
- `createDraft(tenantId, actorId, input)`、`getDraft(tenantId, id)`、`saveDraft(tenantId, actorId, id, input)`。
- 所有 write 方法返回事务提交后的 revision/time/actor；service 不拼装虚假时间。

Red tests:

- [ ] Owner 能创建游戏 A/B 的模板；未知游戏和其他租户游戏返回 404/422，客户端 tenantId 被 API validator 拒绝。
- [ ] Customer Service 能 list/get，但 create/save 返回 403；Admin/Owner 可 create/save；PLAYER 返回 403。
- [ ] list 按 game/status/q/sort 过滤，支持未归类旧模板 `gameId=null`，只返回摘要和 nextCursor，第二页无重复/遗漏；查询计数证明不随模板数增加而逐模板加载子表。
- [ ] save 用 expectedRevision 成功后 revision +1，activeVersionId 不变；旧 revision 返回 409 且带当前 revision/editor/time，数据库草稿不被覆盖。
- [ ] 禁用区块/组件保存后配置仍存在；非法 stableKey、staffingSource、priceDeltaFen、unknown kind 和超限文档返回结构化 422。
- [ ] tenant-isolation 以两个租户复用 id/搜索条件尝试 list/get/save，证明无跨租户读取、更新和错误侧信道。

Implementation steps:

- [ ] controller 只做 tenant/actor 提取、权限 decorator、调用 service 和显式错误映射；不读取客户端 tenantId，不复制业务规则。
- [ ] create 在一个事务内验证游戏归属、名称唯一，创建最小 v2 草稿并写 audit。
- [ ] list 使用一条带 active version/game/editor 摘要 join 的 tenant-scoped 查询；按规范化草稿与发布配置比较派生 hasUnpublishedChanges，不返回 config JSON。
- [ ] save 先对已解析 config 调用 `validateDraftConfigV2`，再在事务中 `SELECT ... FOR UPDATE` 锁定 tenant+id 行并调用 `assertExpectedRevision`；成功原子更新 draft/revision/updatedBy 与 audit。
- [ ] archived 模板允许 view，但 save 返回 `TEMPLATE_ARCHIVED`；没有 v2 草稿或未知 schemaVersion 显式拒绝，不回退到 v1 猜测。
- [ ] module 注册新 controller/service/repository token，同时保留所有旧 provider。

Focused verification:

- `corepack pnpm exec vitest run tests/integration/game-dispatch-template-v2.spec.ts -t "summary|draft"`
- `corepack pnpm exec vitest run --config tests/vitest.tenant-isolation.config.ts tests/tenant-isolation/game-dispatch-template-v2.spec.ts`
- `corepack pnpm exec vitest run tests/integration/game-dispatch-template.spec.ts`
- `corepack pnpm --filter @pw/api typecheck`
- 预期：需获授权测试库；新测试先红后绿，旧 v1 集成测试继续通过。

Recovery: 从 module 移除新注册并删除新 controller/service/repository 可关闭 S2；数据库中测试创建的模板和审计只按测试 tenantId 精确清理。不得删除旧模板或运行迁移回滚。

## Task 3：实现发布、不可变版本、版本历史与并发控制

Objective: 以单事务、行锁和不可变版本证明发布不会丢修订、重复 versionNo 或接受无效人数/金额绑定。

Files:

- Modify `apps/api/src/modules/game-dispatch/application/generic-game-template.service.ts`。
- Modify `apps/api/src/modules/game-dispatch/infrastructure/prisma-generic-game-template.repository.ts`。
- Modify `apps/api/src/modules/game-dispatch/interface/generic-game-template.controller.ts`。
- Modify `tests/integration/game-dispatch-template-v2.spec.ts`。
- Create `tests/integration/game-dispatch-template-v2-concurrency.spec.ts`。

Red tests:

- [ ] 有效草稿发布生成 versionNo=1、activeVersionId、PUBLISHED 和 revision+1；版本 config 含服务端 rendererVersion=1，不含 legacyCompatibility。
- [ ] 发布后继续 save 只改变草稿/revision，旧 active version config 字节不变；再次发布生成 versionNo=2，旧版本仍可读。
- [ ] 无效人数绑定、选择项金额/聚合、未处理 legacy price rules 分别返回批准的 422 code，且不创建版本、不改 activeVersionId/revision、不写成功审计。
- [ ] 客户端尝试提交 rendererVersion 或发布配置被拒绝；发布始终读取服务器当前草稿。
- [ ] 两个连接以同一 expectedRevision 并发发布，恰有一个成功，另一个 409；版本号唯一且没有悬空 activeVersionId。
- [ ] 并发 save/publish 及两次 publish 不出现重复 versionNo、丢失更新或部分审计。
- [ ] versions cursor 分页稳定，只返回摘要/元数据；schemaVersion 1 版本可列出但不能 restore 为 v2。

Implementation steps:

- [ ] service 将当前 draft 转换为候选 PublishedConfigV2：剔除 migration-only compatibility，服务端加入 renderer version，调用 `validatePublishedConfigV2`；按 issue code 选择精确 422。
- [ ] repository 在事务内按 tenantId+id `FOR UPDATE`，复核 revision/status；查询 `MAX(version_no)` 后创建下一不可变版本并更新模板 activeVersion/status/revision/actor。
- [ ] version history 查询使用 `(published_at,id)` 复合游标和 limit+1，不返回 configJson；draft detail 中只返回 active version 摘要。
- [ ] publish audit 与 version/template 更新同事务；审计只写 versionNo、revision 和 changeNote 的受限摘要，不写 config。
- [ ] 任何 Prisma unique/FK 错误只在已确认约束名后转换成受控冲突；未知数据库错误继续抛出，不吞异常。

Focused verification:

- `corepack pnpm exec vitest run tests/integration/game-dispatch-template-v2.spec.ts -t "publish|version"`
- `corepack pnpm exec vitest run tests/integration/game-dispatch-template-v2-concurrency.spec.ts`
- `corepack pnpm exec vitest run apps/api/src/modules/game-dispatch/domain/game-template-config-v2.spec.ts apps/api/src/modules/game-dispatch/domain/game-template-calculations.spec.ts`
- 预期：需获授权测试库；并发断言连续三轮稳定通过，金额全部保持 decimal-string/BigInt 语义。

Recovery: 关闭新 controller 路由即可停止新发布；已经产生的测试/合法版本保持不可变，不更新或删除历史版本。测试夹具只按唯一测试 tenant 清理。

## Task 4：实现恢复、跨游戏复制、默认、归档与受限删除

Objective: 完成模板管理剩余生命周期动作，保证每个游戏单默认、历史恢复不直接上线、归档不破坏历史、硬删除有服务端引用检查。

Files:

- Modify `apps/api/src/modules/game-dispatch/application/generic-game-template.service.ts`。
- Modify `apps/api/src/modules/game-dispatch/infrastructure/prisma-generic-game-template.repository.ts`。
- Modify `apps/api/src/modules/game-dispatch/interface/generic-game-template.controller.ts`。
- Modify `tests/integration/game-dispatch-template-v2.spec.ts`。
- Modify `tests/integration/game-dispatch-template-v2-concurrency.spec.ts`。
- Modify `tests/tenant-isolation/game-dispatch-template-v2.spec.ts`。

Red tests:

- [ ] restore v2 历史只更新 draft/revision，activeVersion/status 保持，返回 sourceVersionId；跨租户/跨模板/version 1 restore 拒绝。
- [ ] copy 必须指定同租户 target game/newName，复制当前 v2 草稿且新模板为独立 DRAFT；不复制版本、默认、lastUsedAt、归档状态或旧固定模块。
- [ ] set default 只接受已发布、未归档、有 gameId 模板；切换默认在同事务清除旧值，并发设置后最多一个默认，依赖服务校验和已有唯一索引。
- [ ] archive 清除默认但保留 active version/history/draft；unarchive 按 activeVersionId 恢复 PUBLISHED/DRAFT；归档后 save/publish/default 拒绝但 view/history 仍可读。
- [ ] 从未发布且无版本/快照/订单引用的模板可 delete；已发布、曾发布或被引用的模板返回 TEMPLATE_DELETE_RESTRICTED 且数据完整。
- [ ] 每个动作验证 expectedRevision、permission、tenant boundary 和相应 audit；客服只能查看，不能 restore/copy/default/archive/delete。

Implementation steps:

- [ ] 每个 mutation 复用同一 tenant-scoped row-lock helper 和 revision conflict mapping，避免动作间出现不同并发语义。
- [ ] restore 从指定 v2 immutable version 生成 DraftConfigV2，去除 rendererVersion，保留 active version；audit 记录 source version 和新 revision。
- [ ] copy 验证 target game、规范化名称唯一并在一事务创建新模板/audit；不共享 JSON 对象引用或任何 version id。
- [ ] set default 锁定目标和同游戏当前默认；先清除后设置并递增目标 revision，冲突时重读事实返回受控 409。
- [ ] archive/unarchive 只修改 lifecycle 字段、revision 和 actor；不写历史 order/snapshot/version。
- [ ] delete 在同一事务锁模板、统计 versions 和所有现有引用后删除；审计若受模板级 cascade 影响，先确认 AuditLog 无 FK，并在删除事务内保留 delete audit。

Focused verification:

- `corepack pnpm exec vitest run tests/integration/game-dispatch-template-v2.spec.ts -t "restore|copy|default|archive|delete"`
- `corepack pnpm exec vitest run tests/integration/game-dispatch-template-v2-concurrency.spec.ts -t "default|revision"`
- `corepack pnpm exec vitest run --config tests/vitest.tenant-isolation.config.ts tests/tenant-isolation/game-dispatch-template-v2.spec.ts`
- 预期：需获授权测试库；全部退出码 0，测试 cleanup 保留非本测试数据。

Recovery: 通过移除新路由注册关闭动作；归档可通过已实现 unarchive 恢复，默认可重新指向旧模板。合法删除不可恢复，因此实施测试只删除本测试创建、已断言无引用的 DRAFT；不得对用户模板演练 delete。

## Task 5：发布 OpenAPI 契约、生成客户端并完成 S2 验收

Objective: 让 S3 能基于生成客户端调用稳定契约，并用完整回归与 acceptance 证据收口 S2；仍不进入 UI 或数据库迁移。

Files:

- Modify `apps/api/src/openapi/schemas.ts`。
- Modify `apps/api/src/modules/game-dispatch/interface/generic-game-template.controller.ts`。
- Create `tests/contract/game-dispatch-template-v2.spec.ts`。
- Generate `openapi.yaml`、`openapi.json`、`packages/api-client/src/client.gen.ts`、`packages/api-client/src/index.ts`、`packages/api-client/src/sdk.gen.ts`、`packages/api-client/src/types.gen.ts`。
- Create `docs/acceptance/2026-09-15-s2-template-management-api.md`。

Red tests:

- [ ] OpenAPI paths/operationIds、query/body/response、权限错误和 pagination schema 存在，旧 game-template paths 仍存在。
- [ ] config 使用 schemaVersion=2 判别联合；priceDeltaFen 是 decimal string pattern，不是 number；rendererVersion 只在发布响应 config 类型出现，不在可写 body。
- [ ] revision conflict 和 validation issue 的 error details 有固定类型；生成 SDK 暴露 list/create/getDraft/saveDraft/publish/versions/restore/copy/default/archive/unarchive/remove。

Implementation steps:

- [ ] 在 OpenAPI schemas 定义可复用 v2 section/component/config、summary/draft/version/page、request 和 error schema；字段上限与 Zod/领域常量一致。
- [ ] controller 增加 `ApiBody`/`ApiOkResponse`/`ApiCreatedResponse`/错误 response decorators 和稳定方法名，避免生成操作名漂移。
- [ ] 先运行 contract 红测试确认文档缺失，再运行 `corepack pnpm openapi:generate`；只接受生成器写入生成文件，不手改生成结果。
- [ ] 运行 `openapi:check`，证明第二次生成无 diff；运行全套 S2、旧 v1、相关 domain、权限和 tenant isolation 回归。
- [ ] acceptance 文档记录准确文件、数据库迁移状态“无 schema 变化、未执行迁移”、API 变化、租户/权限/输入/并发/审计位置、命令退出码、未验证能力和 skill 使用情况；不得记录凭据或完整 config。
- [ ] 停止在 S2，向用户报告并请求 S3 计划/实施授权；不得自动修改 admin UI。

Focused verification:

- `corepack pnpm openapi:generate`
- `corepack pnpm exec vitest run --config tests/vitest.contract.config.ts tests/contract/game-dispatch-template-v2.spec.ts tests/contract/openapi-money.spec.ts`
- `corepack pnpm openapi:check`
- `corepack pnpm exec vitest run apps/api/src/modules/game-dispatch/domain/game-template-lifecycle.spec.ts apps/api/src/modules/game-dispatch/domain/game-template-config-v2.spec.ts apps/api/src/modules/game-dispatch/domain/game-template-calculations.spec.ts apps/api/src/modules/game-dispatch/domain/game-template-document.spec.ts apps/api/src/modules/game-dispatch/domain/game-template-management.spec.ts`
- `corepack pnpm exec vitest run tests/integration/game-dispatch-template.spec.ts tests/integration/game-dispatch-template-v2.spec.ts tests/integration/game-dispatch-template-v2-concurrency.spec.ts`
- `corepack pnpm exec vitest run --config tests/vitest.tenant-isolation.config.ts tests/tenant-isolation/game-dispatch-template-v2.spec.ts`
- `corepack pnpm --filter @pw/api typecheck`
- `corepack pnpm --filter @pw/api-client typecheck`
- `corepack pnpm exec eslint apps/api/src/modules/identity-access/domain/roles.ts apps/api/src/common/validation/api-validation-rules.ts apps/api/src/modules/game-dispatch apps/api/src/openapi/schemas.ts tests/integration/game-dispatch-template-v2.spec.ts tests/integration/game-dispatch-template-v2-concurrency.spec.ts tests/tenant-isolation/game-dispatch-template-v2.spec.ts tests/contract/game-dispatch-template-v2.spec.ts`
- `corepack pnpm exec prettier --check apps/api/src/modules/identity-access/domain/roles.ts apps/api/src/common/validation/api-validation-rules.ts apps/api/src/modules/game-dispatch apps/api/src/openapi/schemas.ts tests/integration/game-dispatch-template-v2.spec.ts tests/integration/game-dispatch-template-v2-concurrency.spec.ts tests/tenant-isolation/game-dispatch-template-v2.spec.ts tests/contract/game-dispatch-template-v2.spec.ts docs/acceptance/2026-09-15-s2-template-management-api.md openapi.yaml openapi.json packages/api-client/src`
- 预期：所有命令取得当前轮次退出码 0；integration/tenant isolation 仅在已授权测试库执行。

Recovery: OpenAPI 与客户端必须整体回到同一生成状态，不能只撤一边；关闭 S2 时从 module 移除新 controller/provider 并重新生成契约。数据库中已经发布的合法版本保持不变且不运行迁移回滚。任何回归失败进入 systematic-debugging，确认一个根因后再改代码，不连续盲改。

## 实施顺序和停点

1. Task 0 是只读前置门禁。
2. Task 1 固定契约与权限，取得纯测试证据后才能进入持久化。
3. Task 2 交付查询和草稿竖切；需要测试库写权限。
4. Task 3 交付发布与并发，是 S2 最高风险门禁。
5. Task 4 完成生命周期动作；hard delete 只对本任务夹具测试。
6. Task 5 生成公开契约并全量验收，然后停止；S3 需要新的明确批准。

每个 Task 都是独立审查点。任何数据库测试失败、租户越界、重复 versionNo、旧 API 回归、生成契约漂移或需要 schema 变化都会暂停后续 Task；不得以跳过测试、类型断言、吞异常、关闭规则或改写旧接口规避。

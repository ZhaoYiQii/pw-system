# Generic Dispatch Template S1b Implementation Plan

Goal: 在不切换现有 API/UI 运行路径、不改写历史订单的前提下，建立 schemaVersion 2 通用模板领域契约、人数与选项加价计算、自动文案渲染，以及可审计的旧模板前向转换底座。

Architecture: `game-dispatch` 领域新增与 NestJS、Prisma 无关的 v2 判别联合和纯函数；`game_dispatch_templates` 使用版本化 JSONB 保存整份通用草稿，发布版本继续保留既有不可变 `config_json`，订单模板快照增加可空 v2 配置列。S1b 使用新的 expand-only Prisma 迁移回填现有模板草稿，保留 v1 发布版本、旧岗位/段位/copyLines 表和历史快照；无法无歧义绑定的旧价格规则进入人工复核状态。

Tech stack: Node.js 24.19.0、Corepack pnpm 10.34.5、TypeScript 5.9 strict、NestJS 12、Prisma 7.10、PostgreSQL 18、Vitest 3.2；不新增依赖。

Spec: `docs/superpowers/specs/2026-09-13-multi-game-dispatch-template-center-design.md`

Scope and non-goals: 本计划只实施规格 S1b：通用组件类型与限制、`staffingSource`、选择项 `priceDeltaFen`、SUM/MAX 聚合、自动文案纯函数、Prisma schema、前向迁移、旧模板草稿转换、租户隔离和回填审计。它不实现或切换模板管理 API、新建派单 API、OpenAPI、admin UI、移动端 UI、灰度开关、旧写路径删除、计价引擎/订单状态机/支付重构，也不执行数据库迁移、Git 操作或部署。

Permission gates: 编写和本地验证 S1b 产品代码需要用户在计划审批后另行授权；执行 `prisma migrate deploy` 或向 `pw_saas_test`/`pw_saas` 写入、创建或删除一次性迁移演练数据库、启动会改变数据的容器、安装依赖、创建分支、提交、推送、部署、远程数据库修改和生产回退都需要各自新的目标明确授权。本计划本身不授权这些动作。

Completion evidence: 纯领域红绿测试、Prisma schema 生成与类型检查、一次性测试数据库的 S1→S1b 迁移演练、转换断言、RLS 负面测试、回填审计报告、受影响包 lint/format/typecheck 全部取得当前执行轮次的退出码 0；缺少迁移授权时只能标记“代码已改、数据库行为未验证”，不能标记 S1b locally-verified。

## 项目现状与能力

- 当前分支为 `master`，HEAD 为 `97bcc4c`；工作树有大量用户未提交改动，并与 `packages/database/prisma/schema.prisma`、`apps/api/src/modules/game-dispatch/**` 和模板迁移测试重叠。
- S1 文件目前也在工作树中：`20260912090000_dispatch_template_sections`、`20260913100000_multi_game_template_versions`、`game-template-lifecycle.ts`、`game-template-values.ts` 及其测试。S1b 以这些内容为前置，只做定向补丁，不回滚、不重写、不格式化无关文件。
- 系统 `pnpm` 为 11.19.0，与仓库 `packageManager=pnpm@10.34.5` 不一致；所有命令固定使用 `corepack pnpm`。
- Node 与 Corepack pnpm 可用；Docker CLI/Compose 可用，但当前沙箱无法读取 Docker 配置或连接 daemon，数据库集成能力为 degraded，直到取得授权并重新确认容器状态。
- 仓库没有独立 `psql` 可执行文件；迁移演练通过 Compose 的 `postgres` 服务及 Prisma CLI 完成，不安装额外客户端。
- S1b 不改公开 API，因此不生成 `openapi.yaml`、`openapi.json` 或 `packages/api-client/src`，也不运行 UI/E2E 或 H5/weapp 构建作为本切片阻断门禁。

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

补充执行解释：按规格 8.3 的精确契约，`DraftConfigV2` 只承载 `schemaVersion`、`sections`、`components`、`staffingSource` 与仅迁移期存在的兼容信息；`PublishedConfigV2` 再增加服务端控制的 `documentRendererVersion`。`templateId`、`gameId`、版本号等身份字段继续由关系列和 API/快照外层对象承载，不把 JSON 内重复标识当作租户或归属事实。

## S1b 文件范围

### 修改

- `packages/database/prisma/schema.prisma`
  - 为模板草稿与订单快照增加 v2 JSONB/version 字段和转换状态；扩展语义角色枚举。
- `apps/api/src/modules/game-dispatch/domain/game-template.ts`
  - 保留全部 v1 类型，扩展语义角色，并把 `GameTemplateVersionConfig` 改为显式 v1/v2 联合。
- `tests/integration/game-dispatch-template-migration.spec.ts`
  - 在现有 S1 数据库约束/RLS 测试上增加 S1b 字段配对、转换状态、租户隔离和历史兼容断言。

### 新建

- `packages/database/prisma/migrations/20260914100000_generic_dispatch_template_config/migration.sql`
  - 仅新增列、枚举值、CHECK 和回填；不修改已执行的 S1 迁移。
- `apps/api/src/modules/game-dispatch/domain/game-template-config-v2.ts`
  - v2 判别联合、限制常量、结构/引用校验和发布校验。
- `apps/api/src/modules/game-dispatch/domain/game-template-config-v2.spec.ts`
  - 通用区块/组件/表格/稳定键/禁用保留/兼容状态测试。
- `apps/api/src/modules/game-dispatch/domain/game-template-calculations.ts`
  - 基于发布快照和值计算人数与选项价格调整的纯函数。
- `apps/api/src/modules/game-dispatch/domain/game-template-calculations.spec.ts`
  - FIXED、NUMBER_FIELD、表格汇总、SUM/MAX、整数分和无效绑定测试。
- `apps/api/src/modules/game-dispatch/domain/game-template-document.ts`
  - 按快照顺序生成结构化行和纯文本的确定性渲染器。
- `apps/api/src/modules/game-dispatch/domain/game-template-document.spec.ts`
  - 空值、省略、表格行、纯文本转义、长度限制、未知组件安全占位和历史确定性测试。
- `scripts/rehearse-game-dispatch-template-s1b.mjs`
  - 在调用方预先创建的本机一次性数据库中，分两阶段应用迁移、插入非敏感旧结构夹具并验证 S1b 回填；脚本自身不创建或删除数据库。
- `docs/acceptance/2026-09-14-s1b-template-conversion.md`
  - 实施时记录一次性迁移演练、转换计数、人工复核数量、RLS 与回退证据；不得记录完整配置或订单值。

### 明确不修改

- `packages/database/prisma/migrations/20260912090000_dispatch_template_sections/migration.sql`
- `packages/database/prisma/migrations/20260913100000_multi_game_template_versions/migration.sql`
- `apps/api/src/modules/game-dispatch/application/**`
- `apps/api/src/modules/game-dispatch/interface/**`
- `apps/admin-web/**`
- `apps/mobile/**`
- `openapi.yaml`、`openapi.json`、`packages/api-client/src/**`
- 旧 `game_dispatch_positions`、`game_dispatch_rank_rules`、`copy_lines` 与快照旧 JSON 列。

## 公共领域契约

Task 1 必须先创建以下接口，后续任务只能消费这些名称，不得各自发明另一套结构：

```ts
type TemplateConfigSchemaVersion = 1 | 2;

type DraftConfigV2 = {
  schemaVersion: 2;
  sections: TemplateSectionV2[];
  components: TemplateComponentV2[];
  staffingSource: StaffingSourceV2;
  legacyCompatibility?: {
    unboundPriceRules: LegacyUnboundPriceRuleV2[];
  };
};

type PublishedConfigV2 = Omit<DraftConfigV2, "legacyCompatibility"> & {
  documentRendererVersion: 1;
};

type TemplateComponentV2 =
  | TemplateFieldComponentV2
  | TemplateRepeatableTableV2
  | TemplateNoteComponentV2;

type StaffingSourceV2 =
  | { kind: "FIXED"; count: number }
  | { kind: "NUMBER_FIELD"; componentKey: string }
  | {
      kind: "REPEATABLE_TABLE_SUM";
      componentKey: string;
      columnKey: string;
    };

type TemplateChoiceOptionV2 = {
  value: string;
  label: string;
  priceDeltaFen?: MoneyFen;
};

type DispatchDocumentV1 = {
  schemaVersion: 1;
  rendererVersion: 1;
  rows: Array<{
    sectionLabel: string;
    fieldLabel: string;
    value: string;
  }>;
  plainText: string;
};
```

稳定键使用同一命名空间：区块、组件、表格列在一个模板内不能重复，匹配 `^[a-z][a-z0-9_]{0,63}$`。迁移生成键使用持久 UUID 派生的 `section_<32hex>`、`field_<32hex>`；岗位表格固定使用 `legacy_staffing_<template uuid 32hex>`，列使用 `legacy_staffing_label_<template uuid 32hex>` 与 `legacy_staffing_count_<template uuid 32hex>`，避免依赖可编辑名称。

字段类型固定为 `TEXT`、`TEXTAREA`、`NUMBER`、`MONEY_FEN`、`DATETIME`、`SINGLE_SELECT`、`MULTI_SELECT`；`NOTE` 是组件类型，不作为可填写字段。可重复表格列首版只允许 `TEXT`、`NUMBER`、`SINGLE_SELECT`，以控制提交形状。

## Task 1：建立 schemaVersion 2 类型与发布校验

Objective: 把通用模板结构、上限、稳定引用和启用/删除语义固化为纯领域契约，不触碰持久化和 API。

Spec coverage: 2.1、2.2、5.3、5.7、5.11–5.15、6.3–6.6、13.1、15.5–15.10。

Files:

- Modify `apps/api/src/modules/game-dispatch/domain/game-template.ts`。
- Create `apps/api/src/modules/game-dispatch/domain/game-template-config-v2.ts`。
- Create `apps/api/src/modules/game-dispatch/domain/game-template-config-v2.spec.ts`。

Interfaces produced:

- `DraftConfigV2`、`PublishedConfigV2`、`TemplateComponentV2`、`StaffingSourceV2`。
- `GAME_TEMPLATE_V2_LIMITS`，值固定为 20 区块、100 组件、10 表格列、50 默认行/提交行、100 选项、256 KiB 草稿。
- `validateDraftConfigV2(config): TemplateConfigIssue[]`。
- `validatePublishedConfigV2(config): TemplateConfigIssue[]`。
- `TemplateConfigIssue` 固定包含 `code`、`path`、`componentKey?`、`message`，不包含用户填写值。

Preconditions and gates:

- S1 的 v1 类型和语义角色已存在；不得删除或改名。
- 此任务没有数据库写入、依赖安装、OpenAPI 或 UI 权限。

Steps:

- [ ] 在 `game-template-config-v2.spec.ts` 写红测试：接受两个区块与五个区块；拒绝第 21 个区块、第 101 个组件、第 11 个表格列、第 51 个默认行、第 101 个选项和序列化后超过 256 KiB 的草稿。
- [ ] 写红测试：拒绝非法/重复 stableKey、孤立 sectionKey、重复唯一语义角色、可填写 NOTE、选择字段缺少选项、非选择字段携带选项和额外未知组件 kind。
- [ ] 写红测试：禁用区块/组件仍保留定义；发布校验忽略普通禁用内容，但当 `staffingSource` 引用禁用或不存在组件/列时返回 `TEMPLATE_BINDING_INVALID` 路径。
- [ ] 在 `game-template.ts` 追加 `STAFFING_LABEL`、`STAFFING_COUNT`，保留 v1 `PublishedGameTemplateConfigV1`，新增 v2 类型导出，并把 `GameTemplateVersionConfig` 定义为 v1/v2 判别联合。
- [ ] 在 `game-template-config-v2.ts` 定义受控字段、区块、布局、选择项、表格列/默认行和兼容信息类型；不 import NestJS、Prisma 或 Zod。
- [ ] 实现一次遍历收集 stableKey、section/component/column 索引和结构问题，再做引用校验；不按 label 或旧 fieldKey 猜测绑定。
- [ ] 发布校验拒绝非空 `legacyCompatibility.unboundPriceRules`，映射为 `TEMPLATE_LEGACY_REVIEW_REQUIRED`；草稿校验允许其存在以便后续 S2 人工处理。
- [ ] 以 UTF-8 字节数检查 256 KiB 上限；不把 `JSON.stringify` 的字符数当作字节数。

Focused verification:

- `corepack pnpm exec vitest run apps/api/src/modules/game-dispatch/domain/game-template-config-v2.spec.ts`
  - 预期：红阶段因模块/行为缺失失败；实现后全部通过。
- `corepack pnpm --filter @pw/api typecheck`
  - 预期：v1 现有消费方继续通过，v2 联合没有 `any` 或类型忽略。
- `corepack pnpm exec eslint apps/api/src/modules/game-dispatch/domain/game-template.ts apps/api/src/modules/game-dispatch/domain/game-template-config-v2.ts apps/api/src/modules/game-dispatch/domain/game-template-config-v2.spec.ts`
  - 预期：退出码 0。

Recovery: 仅反向移除新 v2 导出和新增测试；保留 S1 的 v1 类型、字段与生命周期函数。若发现 v1 消费方被破坏，停止并回到契约设计，不用类型断言掩盖。

## Task 2：实现人数、选项加价与自动文案纯函数

Objective: 在不接数据库/API 的前提下，证明任意通用字段和表格可驱动人数、价格调整和自动复制文案，且结果只依赖发布快照和值。

Spec coverage: 2.1、2.2、5.12–5.14、6.4、6.5、6.7、10、11、13.1、14、15.9–15.12。

Files:

- Create `apps/api/src/modules/game-dispatch/domain/game-template-calculations.ts`。
- Create `apps/api/src/modules/game-dispatch/domain/game-template-calculations.spec.ts`。
- Create `apps/api/src/modules/game-dispatch/domain/game-template-document.ts`。
- Create `apps/api/src/modules/game-dispatch/domain/game-template-document.spec.ts`。

Interfaces consumed: Task 1 的 `PublishedConfigV2`、组件联合、`StaffingSourceV2`、`MoneyFen`。

Interfaces produced:

- `calculateTemplateStaffing(config, values): { totalCount: number; rows: StaffingRow[] }`。
- `calculateTemplatePriceAdjustmentFen(config, values): MoneyFen`。
- `renderDispatchDocument(config, values): DispatchDocumentV1`。
- `TemplateRuntimeValues = Readonly<Record<string, unknown>>`；函数必须主动验证值形状，不信任客户端对象。

Steps:

- [ ] 在 calculations spec 写红测试：FIXED 默认/显式人数、NUMBER_FIELD 正整数、REPEATABLE_TABLE_SUM 多行汇总；拒绝 0、负数、小数、超过系统人数上限、未知键、禁用来源和列类型不匹配。
- [ ] 写红测试：SINGLE_SELECT 加价、多个独立字段累加、MULTI_SELECT 的 SUM/MAX、未配置加价为 0、未知选项拒绝、`priceDeltaFen` 非规范十进制字符串拒绝；内部用 `BigInt` 累加并以十进制字符串返回。
- [ ] 实现计算函数，只读取 `PublishedConfigV2` 中启用区块/组件和被选中的合法选项，不接受客户端总人数或最终加价。
- [ ] 在 document spec 写红测试：按区块和组件顺序输出；跳过空的非必填字段；必填缺失返回结构化错误；表格逐行输出；禁用内容不出现；stableKey/semanticRole 不泄露。
- [ ] 写红测试：`<script>`、控制字符和超长文本只作为受限纯文本处理；未知组件输出安全占位并返回可观测 issue；相同快照和值重复渲染字节一致。
- [ ] 实现 renderer version 1；每个显示值上限 2,000 字符、总纯文本上限 20,000 字符，使用明确截断标记，不支持 HTML、脚本、URL 抓取或模板表达式。
- [ ] 对 DATETIME 使用规范 ISO 字符串输出；金额只显示规范整数分值，元换算属于后续展示层，不在领域函数使用浮点。

Focused verification:

- `corepack pnpm exec vitest run apps/api/src/modules/game-dispatch/domain/game-template-calculations.spec.ts apps/api/src/modules/game-dispatch/domain/game-template-document.spec.ts`
  - 预期：红阶段分别因缺失函数失败；实现后人数、金额和文案全部通过。
- `corepack pnpm exec vitest run apps/api/src/modules/game-dispatch/domain/game-template-lifecycle.spec.ts apps/api/src/modules/game-dispatch/domain/game-template-values.spec.ts apps/api/src/modules/game-dispatch/domain/game-template-config-v2.spec.ts apps/api/src/modules/game-dispatch/domain/game-template-calculations.spec.ts apps/api/src/modules/game-dispatch/domain/game-template-document.spec.ts`
  - 预期：现有 v1 领域行为与新增 v2 人数、金额、文案行为全部通过；仓库当前 `test:critical` 只覆盖 money/order/ledger，不能替代本命令。
- `corepack pnpm --filter @pw/api typecheck`
  - 预期：退出码 0。

Recovery: 删除新纯函数文件即可恢复，且不影响旧派单运行路径。任何现有 v1 测试回归先进入系统化调试，不改旧值解析器来迁就 v2。

## Task 3：增加 S1b Prisma schema 与 expand-only 迁移

Objective: 增加 v2 草稿/快照持久化结构并把现有模板转换为可审阅的 v2 草稿，同时保持 v1 发布版本、历史快照和旧运行路径不变。

Spec coverage: 5.3、5.6、5.11–5.15、6.3–6.7、7、12、13、15.18–15.19、16.S1b、17、18。

Files:

- Modify `packages/database/prisma/schema.prisma`。
- Create `packages/database/prisma/migrations/20260914100000_generic_dispatch_template_config/migration.sql`。
- Modify `tests/integration/game-dispatch-template-migration.spec.ts`。
- Create `scripts/rehearse-game-dispatch-template-s1b.mjs`。

Database contract:

- `game_dispatch_templates.draft_config_json JSONB NULL`。
- `game_dispatch_templates.draft_schema_version INTEGER NULL`。
- `game_dispatch_templates.legacy_conversion_state TEXT NOT NULL DEFAULT 'NOT_REQUIRED'`。
- `game_dispatch_templates.legacy_conversion_issues JSONB NOT NULL DEFAULT '[]'::jsonb`。
- `game_dispatch_template_snapshots.config_json JSONB NULL`。
- `game_dispatch_template_snapshots.schema_version INTEGER NULL`。
- `GameDispatchTemplateSemanticRole` 追加 `STAFFING_LABEL`、`STAFFING_COUNT`；不重建或重命名已有枚举值。

Migration rules:

- 列先可空添加；`draft_config_json`/version 与 snapshot `config_json`/version 使用配对 CHECK，JSON 非空时必须为 object 且 JSON 内 `schemaVersion=2`。
- `legacy_conversion_state` 限定为 `NOT_REQUIRED | READY | NEEDS_REVIEW`；issues 必须为 JSON array。
- CHECK 先 `NOT VALID` 添加，完成回填后 `VALIDATE CONSTRAINT`；不增加 GIN，因为 S1b 没有 JSON 内查询。
- 不新增表或外键；继续复用模板/快照既有 `tenant_id`、复合外键、索引与 FORCE RLS。新增列自动受同行 RLS 保护，测试必须证明这一点。
- 迁移为每个现有模板生成 `DraftConfigV2`。旧 section/field 使用 UUID 派生 stableKey；FIELD 映射保持原排序、启用、必填、options 与语义角色。
- 旧 position 集合转换为一个普通 `REPEATABLE_TABLE`，默认行保存 label/count，并把 `staffingSource` 绑定数量列；没有岗位时使用 `{ kind: "FIXED", count: 1 }`。
- 仅当恰好存在一个启用的 `TARGET_RANK` 选择字段，且每条旧 rank label 都能与该字段选项精确匹配时，把 `add_price_fen` 写入相应选择项 `priceDeltaFen` 并标记 READY。
- 无目标段位字段、字段禁用/类型不支持、选项缺失或匹配不唯一时，不猜测绑定；旧 rank 表保持原样，草稿的 `legacyCompatibility.unboundPriceRules` 保存原有 label/整数分/顺序，issues 仅保存问题码和 stableKey，状态标记 NEEDS_REVIEW。
- 旧 `game_dispatch_template_versions.config_json` 保持 schemaVersion 1 且不可变；不得原地升级版本 1。
- 旧 `game_dispatch_template_snapshots` 的新 v2 列保持 NULL，旧 fields/sections/positions/rankRules/copyLines JSON 原样；新快照写 v2 列属于 S4。
- 新模板默认 `NOT_REQUIRED` 且 v2 草稿由 S2 创建；迁移结束后不把 JSON 列改为 NOT NULL，以保留旧写路径兼容。

Preconditions and permission gates:

- 只创建迁移文件和 schema 变更不连接数据库；可以在执行授权后进行。
- 对 `pw_saas_test` 运行迁移、为演练创建/删除一次性数据库、向 `pw_saas` 本地开发库运行迁移是三个不同写入目标，分别取得授权；S1b 验收默认只申请一次性测试数据库，不先修改开发库。
- 生产/远程数据库不在本计划执行范围。

Steps:

- [ ] 先在 migration spec 写最终 schema 红测试：非法 version/JSON 配对、非法 conversion state、非数组 issues 被数据库拒绝；新列在 A 租户上下文不可读取/更新 B 租户行。
- [ ] 在 rehearsal 脚本内定义迁移演练夹具：一个无岗位/无加价模板、一个可绑定 TARGET_RANK 模板、一个缺失或不匹配选项模板、一个已有关联历史快照模板；夹具只使用固定 UUID 和虚构非敏感值。
- [ ] 在 `schema.prisma` 添加六列和两个语义角色，保持旧字段/模型不删不改。
- [ ] 写新的 `20260914100000` SQL；不编辑 `20260912090000` 或 `20260913100000`。
- [ ] 实现 rehearsal 脚本：强制读取 `PW_S1B_REHEARSAL_DATABASE_URL`，只接受 host 为 `127.0.0.1`/`localhost` 且数据库名以 `pw_saas_s1b_rehearsal_` 开头的 URL；将 Prisma schema 与截至 S1 的迁移复制到系统临时目录，运行第一阶段 `prisma migrate deploy`，用 Prisma raw SQL 插入夹具，再复制 S1b 目录并运行第二阶段 deploy。
- [ ] rehearsal 脚本使用 `try/finally` 清理系统临时目录，但不创建、删除或重置数据库；目标库生命周期由单独授权的 Compose 命令管理。
- [ ] 在一次性数据库应用迁移至 S1，插入夹具，再应用 S1b；不得把夹具写入 `pw_saas_test` 或 `pw_saas`。
- [ ] 断言 READY 模板的区块/字段/岗位表格/staffingSource/选项加价和排序正确，NEEDS_REVIEW 模板的旧规则完整保留且没有猜测绑定。
- [ ] 断言 v1 version 1 的 `config_json` 和历史 snapshot 旧列在 S1b 前后字节语义一致，新 snapshot v2 列保持 NULL。
- [ ] 运行 constraint catalog 查询，记录 CHECK 已 validated；确认没有新增 GIN、没有丢列/丢表、现有 RLS 仍为 enabled + forced。

Focused verification:

- `corepack pnpm --filter @pw/database generate`
  - 预期：Prisma schema 校验与客户端生成退出 0；不连接数据库。
- `corepack pnpm --filter @pw/database typecheck`
  - 预期：退出码 0。
- `git diff --check -- packages/database/prisma/schema.prisma packages/database/prisma/migrations/20260914100000_generic_dispatch_template_config/migration.sql`
  - 预期：退出码 0。
- 经一次性测试数据库授权后：`corepack pnpm exec node scripts/rehearse-game-dispatch-template-s1b.mjs`
  - 环境：`PW_S1B_REHEARSAL_DATABASE_URL` 指向预先创建且名称满足保护规则的一次性本机数据库；预期 S1、夹具、S1b、回填断言依次成功并输出非敏感计数。
- 经同一测试数据库授权后：`corepack pnpm exec vitest run --config tests/vitest.integration.config.ts tests/integration/game-dispatch-template-migration.spec.ts`
  - 预期：S1 与 S1b 约束、回填、历史兼容和 RLS 用例全部通过。

Recovery:

- 迁移未执行：反向移除 S1b schema 增量和新迁移目录；不触碰 S1 文件。
- 仅一次性测试数据库执行失败：保留日志，停止实施并进入系统化调试；删除/重建该一次性数据库需要新的精确授权。
- 开发/共享/生产库一旦执行：不运行破坏性 down migration。代码回退后保留可空列与旧表，必要修复使用新的前向迁移；生产回退另行设计和授权。

## Task 4：收口租户隔离、回填审计与 S1b 门禁

Objective: 用新鲜证据证明领域模型、数据转换、历史兼容和租户边界满足 S1b，并形成不含业务内容的审计记录。

Spec coverage: 12、13、14、15.18–15.19、16.S1b、17。

Files:

- Modify `tests/integration/game-dispatch-template-migration.spec.ts`（仅补充前一任务未覆盖的最终断言）。
- Create `docs/acceptance/2026-09-14-s1b-template-conversion.md`。

Steps:

- [ ] 运行全部新增领域测试，确认 v1 lifecycle/value 测试同时通过。
- [ ] 在授权的一次性测试数据库运行 migration spec；记录模板总数、READY 数、NEEDS_REVIEW 数、问题码分布、v1 版本未改写数量、旧快照未改写数量和约束/RLS 状态。
- [ ] 审计查询只输出计数、模板 ID 和问题码；不输出完整 `draft_config_json`、copyLines、订单值、联系人或其他用户文本。
- [ ] 在 acceptance 文档记录环境名称、迁移前后 migration 名称、命令、退出码、关键计数和清理/保留状态；不写凭据和连接串。
- [ ] 运行受影响包 typecheck、定向 eslint、定向 prettier 和根级 unit tests；任何失败进入系统化调试，不能继续堆补丁。
- [ ] 检查 exact-scope Git diff/status，确认没有修改 API/UI/OpenAPI、既有迁移、seed、锁文件或无关用户文件。

Final verification:

- `corepack pnpm exec vitest run apps/api/src/modules/game-dispatch/domain/game-template-lifecycle.spec.ts apps/api/src/modules/game-dispatch/domain/game-template-values.spec.ts apps/api/src/modules/game-dispatch/domain/game-template-config-v2.spec.ts apps/api/src/modules/game-dispatch/domain/game-template-calculations.spec.ts apps/api/src/modules/game-dispatch/domain/game-template-document.spec.ts`
- `corepack pnpm exec vitest run --config tests/vitest.integration.config.ts tests/integration/game-dispatch-template-migration.spec.ts`（需要已授权且已迁移的一次性测试数据库）。
- `corepack pnpm --filter @pw/database typecheck`。
- `corepack pnpm --filter @pw/api typecheck`。
- `corepack pnpm exec eslint apps/api/src/modules/game-dispatch/domain/game-template.ts apps/api/src/modules/game-dispatch/domain/game-template-config-v2.ts apps/api/src/modules/game-dispatch/domain/game-template-config-v2.spec.ts apps/api/src/modules/game-dispatch/domain/game-template-calculations.ts apps/api/src/modules/game-dispatch/domain/game-template-calculations.spec.ts apps/api/src/modules/game-dispatch/domain/game-template-document.ts apps/api/src/modules/game-dispatch/domain/game-template-document.spec.ts tests/integration/game-dispatch-template-migration.spec.ts scripts/rehearse-game-dispatch-template-s1b.mjs`。
- `corepack pnpm exec prettier --check packages/database/prisma/schema.prisma packages/database/prisma/migrations/20260914100000_generic_dispatch_template_config/migration.sql apps/api/src/modules/game-dispatch/domain/game-template.ts apps/api/src/modules/game-dispatch/domain/game-template-config-v2.ts apps/api/src/modules/game-dispatch/domain/game-template-config-v2.spec.ts apps/api/src/modules/game-dispatch/domain/game-template-calculations.ts apps/api/src/modules/game-dispatch/domain/game-template-calculations.spec.ts apps/api/src/modules/game-dispatch/domain/game-template-document.ts apps/api/src/modules/game-dispatch/domain/game-template-document.spec.ts tests/integration/game-dispatch-template-migration.spec.ts scripts/rehearse-game-dispatch-template-s1b.mjs docs/acceptance/2026-09-14-s1b-template-conversion.md`。
- `corepack pnpm test`。
- `git diff --check -- packages/database/prisma/schema.prisma packages/database/prisma/migrations/20260914100000_generic_dispatch_template_config/migration.sql apps/api/src/modules/game-dispatch/domain/game-template.ts apps/api/src/modules/game-dispatch/domain/game-template-config-v2.ts apps/api/src/modules/game-dispatch/domain/game-template-config-v2.spec.ts apps/api/src/modules/game-dispatch/domain/game-template-calculations.ts apps/api/src/modules/game-dispatch/domain/game-template-calculations.spec.ts apps/api/src/modules/game-dispatch/domain/game-template-document.ts apps/api/src/modules/game-dispatch/domain/game-template-document.spec.ts tests/integration/game-dispatch-template-migration.spec.ts scripts/rehearse-game-dispatch-template-s1b.mjs docs/acceptance/2026-09-14-s1b-template-conversion.md`。

Expected result:

- 所有命令退出码 0。
- S1b 迁移只增加结构；v1 发布版本与旧订单快照没有改写。
- 可绑定旧价格规则转换为选择项加价；无法绑定的规则完整保留并标记 NEEDS_REVIEW。
- A 租户无法读取或更新 B 租户模板/快照。
- 自动文案只输出受限纯文本，且同一快照和值确定性一致。

Recovery: 若领域或类型门禁失败，保留红测试并回到对应任务；若迁移/集成失败，停止在 S1b，不进入 S2。只允许对一次性测试数据库做经授权的重建，对任何共享数据库只使用后续前向修复。

## 规格映射与执行顺序

| 规格要求                                     | 计划任务               | 阻断证据                                |
| -------------------------------------------- | ---------------------- | --------------------------------------- |
| 通用区块、字段、NOTE、可重复表格与 2–5+ 组合 | Task 1                 | config v2 单测                          |
| 启用保留、删除独立、稳定键与引用             | Task 1                 | 结构/发布校验单测                       |
| 岗位/加价仅为预设，不是固定模块              | Task 1、Task 3         | v2 类型中无固定模块；转换结果为普通组件 |
| staffingSource                               | Task 1、Task 2、Task 3 | 绑定校验、人数计算、迁移断言            |
| 任意选择项 priceDeltaFen 与 SUM/MAX          | Task 1、Task 2、Task 3 | 金额单测与回填断言                      |
| 自动文案，不配置 copyLines                   | Task 2                 | renderer 单测；v2 无 copyLines          |
| v1/历史快照兼容                              | Task 1、Task 3、Task 4 | 联合类型与迁移前后断言                  |
| 旧规则无歧义转换/人工复核                    | Task 3、Task 4         | READY/NEEDS_REVIEW 夹具与审计计数       |
| 租户、输入、DoS 与纯文本安全                 | Task 1–Task 4          | 上限、RLS、转义与不泄露测试             |
| expand-contract 与可回退                     | Task 3、Task 4         | schema diff、迁移演练、恢复记录         |

执行顺序固定为 Task 1 → Task 2 → Task 3 → Task 4。Task 1/2 的纯领域工作可以在没有数据库授权时完成；Task 3 的实际迁移演练和 Task 4 的数据库证据必须等待一次性测试数据库授权。S1b 全部证据通过后停止，等待用户批准 S2；不得自动实施模板管理 API、UI、新建派单、迁移开发库、Git commit/push 或部署。

## 自检清单

- [ ] 每个新增类型、函数、文件和命令均由更早任务创建或已在仓库存在。
- [ ] 无占位词、模糊后续动作或未声明依赖。
- [ ] 未把公开 API/OpenAPI/UI 偷渡进 S1b。
- [ ] 未编辑既有 S1 迁移，未删除旧表/列/版本/快照。
- [ ] 每个行为变更都有红测试与绿色预期。
- [ ] 每个持久副作用都有权限点与非破坏性恢复路径。
- [ ] 金额仅使用整数分字符串/BigInt，人数仅使用有界正整数。
- [ ] 租户身份来自现有关系列/RLS，不信任 JSON 内标识。
- [ ] 迁移审计不输出敏感配置和值。
- [ ] S1b 完成状态与 commit、push、部署、生产验证严格区分。

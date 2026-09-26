# ADR-0010：下单三字段（大区 / 目标段位 / 模式）的必填、联想与平台预设库

- 状态：**已批准**（2026-09-27 提出，2026-09-27 批准。第一批（零迁移部分）**已实施并验证**，见「实施记录（第一批）」；第二批（建表迁移 / 检索端点 / 平台端维护页 / 候选列表控件 / 发布口必填 / 设计器放开三个语义角色）尚未授权）
- 日期：2026-09-27
- 关联：ADR-0002（派单默认）、ADR-0003（算价模型）、`docs/superpowers/specs/2026-09-13-multi-game-dispatch-template-center-design.md`、`docs/specs/派单模板表单设计器-设计规格-v0.2.md`（D-13）、`docs/DEVELOPMENT_BACKLOG.md` §5（大区/目标段位/模式条目）

## 背景

### 一、老板端下单有两条并行链路，且两条都会走到

| 链路 | 老板端采集 | 提交 | 服务端入口 | 值形状 |
| --- | --- | --- | --- | --- |
| **v2 通用派单模板** | `apps/mobile/src/pages/customer/game-order/index.tsx:706-740`（`submitV2`）+ `apps/mobile/src/features/customer-ui/order-values.ts:335`（`collectOrderValues`） | `POST /api/v1/tenant/game-dispatch/customer/template-orders` | `apps/api/src/modules/game-dispatch/interface/customer-game-template.controller.ts:198` | `{ gameId, templateId, templateVersionId, values }`，三字段按 `stableKey`（`server_region` / `target_rank` / `mode`）平铺 |
| **v1 经典下单** | 同页 `:762-800`（`submitV1`） | `POST /api/v1/tenant/game-dispatch/customer/orders` | `apps/api/src/modules/game-dispatch/interface/game-dispatch.controller.ts:229` | `{ templateId, formValues, durationMinutes, lines }`，值在 `formValues: Record<fieldKey,string>` |

页面对 v2 不可用**自动回退** v1：`game-order/index.tsx:619-620` 决定回退，`:668` 提示「该游戏暂无通用模板，已切换为经典下单流程。」因此**任一链路未改，老板都会再撞一次同样的问题**。

### 二、三个字段不是固定字段，而是模板里由商家自定义的组件

它们靠**语义角色**标识身份：`GameDispatchTemplateSemanticRole`（`packages/database/prisma/schema.prisma:1103-1114`）= `MODE` / `TARGET_RANK` / `CURRENT_RANK` / `SERVER_REGION` / `DURATION_MINUTES` / `CONTACT` / `ORDER_NOTE` / `STAFFING_LABEL` / `STAFFING_COUNT` / `CUSTOM`。字段组件表 `GameDispatchTemplateField`（`:1149-1173`）持有 `semanticRole`（`:1157`）、`required`（`:1158`，默认 `false`）、`options Json @default("[]")`（`:1159`）。v2 的完整表单定义存在 `GameDispatchTemplate.draftConfigJson`（`:1131`）与 `GameDispatchTemplateVersion.configJson`（`:1180`），下单时冻结进 `GameDispatchTemplateSnapshot.fieldsJson`（`:1311-1314`）。

**推论一（"必填"的现状）**：模板里若**根本没有** `TARGET_RANK` 字段，下单链路完全不感知——v2 的服务端校验只遍历模板实际存在的组件（`game-template-document.ts:270-303`）。所以"三字段必填"目前既不是系统约束、也不是模板约束，只是各商家逐字段手工勾选的 `required`。

**推论二（平台端零基础）**：`apps/admin-web/app/(platform)` 整目录对 `rank|region|mode|template|段位|大区|模式|模板` **零命中**；平台导航只有 8 项（`apps/admin-web/app/_lib/platform-shell.tsx:41-68`），无任何相关入口。

**推论三（两端渲染不一致）**：

- v2 的 `SINGLE_SELECT` / `MULTI_SELECT` 在老板端是**全封闭分段按钮组**（`game-order/index.tsx:226-277`），只能点模板选项、不能输入；`TEXT`/`TEXTAREA` 才是自由输入（`:284-309`）。
- v1 的老板端把**包括 `select` 在内的所有字段一律渲染成自由文本 `<Input>`**（`game-order/index.tsx:1049-1061`），模板选项只被塞进 `placeholder={field.options[0] ?? "填写"}`（`:1054`）——**既没有下拉也没有联想**，这正是本问题的现场。
- 同一份模板在商家/客服端 v1 下单页是真 `<select>`（`apps/admin-web/app/(tenant)/game-dispatch/new/page.tsx:193-210`）。**两端行为不一致。**

### 三、库外值现在会被拦下（用户所说「填得不正确就无法提交」的出处）

三层同时拦：

| 层 | 位置 | 行为 |
| --- | --- | --- |
| 客户端 | `apps/mobile/src/features/customer-ui/order-values.ts:242-252`（`convertChoice` 把库外值当错误）+ `:335-407`（一有错就整体不提交） | 页面 `game-order/index.tsx:708-712` 直接 `return`，**不发请求** |
| 服务端 v1 | `apps/api/src/modules/game-dispatch/domain/game-template-values.ts:71-77`：`${field.label}的值不在模板选项中` | → `DispatchInputError` → **400**（`game-dispatch-error.mapper.ts:22-23`） |
| 服务端 v2 | `game-template-calculations.ts:232-236`、`game-template-document.ts:74-79` | → `TEMPLATE_COMPONENT_INVALID` → **422**（`errors.ts:22-37`） |

> 用户原话中的「没有段位模板」「没有对应的数据」在全仓检索为 **0 命中**——它们是需求描述而非界面文案；实际等价文案是上表三条。既有测试对当前行为有断言：`apps/mobile/src/features/customer-ui/order-values.spec.ts:124-135`（`模式 的值不在模板选项中`）、`apps/api/src/modules/game-dispatch/domain/game-template-values.spec.ts:61`（`目标段位的值不在模板选项中`）。

### 四、预设库与价格的既有边界

- 「任意选择类字段可配置选项价格调整」是既有能力；**价格权威**在 `GamePricingRule` + `GamePricingRuleItem`（`schema.prisma:1270-1301`），按 `gameId` 绑定、`dimensionKey` 命中（如 `rank=翡翠`）。
- `GameDispatchRankRule`（`:1228-1242`）是**模板级** v1 段位加价，ADR-0003 已降级为 legacy 只读。
- `GameRegion`（`:379-392`）属 catalog 模块（被 `ServiceProduct.gameRegionId` `:398`、`PlayerSkill.gameRegionId` `:434` 引用），**与下单模板的"大区"字段无任何外键关系**——不能直接当作预设库。
- 订单侧只存字符串：`GameDispatchOrder.formValuesJson`（`:1336`）、`modeLabel`（`:1337`）、`targetRankLabel`（`:1338`，v1 由字符串启发式填充，见 `game-dispatch.service.ts:425-433`）。**没有 regionLabel。**

### 五、一条必须先解的产品裁定

v2 模板设计器**故意不暴露** `MODE` / `TARGET_RANK` / `SERVER_REGION`：`apps/admin-web/app/_lib/merchant-console/template-editor-meta.ts:28` 注释「语义角色只以『不用 / 人数 / 时长』三个中性取值出现」，`BINDING_OPTIONS` 只有 `null / STAFFING_COUNT / DURATION_MINUTES`（`:53-60`）；依据是 `docs/specs/派单模板表单设计器-设计规格-v0.2.md:16`（D-13）「只给原语，不给预设」。**结果是商家目前无法在 UI 上把字段标成"目标段位"**——这使"必备字段由模板保证"的方案无法落地，必须先解掉该裁定的适用边界。

### 六、用户诉求（原话）

> 「区、目标段位、模式这些必填的，可以有下拉按钮或者有辅助搜索的，例如我写个翡翠，他就会智能的去筛选出数据库中翡翠相关的段位，也就是翡翠1-4。其他段位也类似，还有大区也是，这个相关的信息是由平台端那边去创建的表格预设库，但不限定老板自己填写，不是必须后台有准确名字的，因为有一些老板可能会写翡1，所以如果填写的不正确的话就会提示没有对应的数据。就无法提交，不够灵活。」

拆解为四条可验证要求：**(a)** 三字段必填；**(b)** 下拉或辅助搜索；**(c)** 预设由**平台端**维护；**(d)** **不限制老板自填**，库外值不得阻塞提交。

## 约束

- 不改算价口径：单价 = 陪玩 × 游戏底价 + 按游戏绑定的加价规则（ADR-0003 与 2026-09-20 已确认口径）。
- 「库外值不阻塞提交」**只对这三个语义角色生效**；其余选择类字段保持严格校验（它们参与"选项价格调整"的一致性）。
- 移动端业务代码必须同时面向 H5 与 weapp；`window` / `document` / `localStorage` / `wx` 只能出现在平台适配目录（AGENTS.md）。
- 平台端在本 ADR 之前对该能力**零基础**：任何"预设库"都要新建表 + 新接口 + 新页面 + 迁移。
- 不得追溯使**存量已发布模板**无法使用（存量模板可能没有这三个字段）。
- 新增/变更的租户侧读写必须在服务端绑定 `TenantContext`，不接受客户端提交的 `tenantId`。
- 金额仍以整数分或明确十进制对象表示；本 ADR 不新增金额字段。

## 候选方案

### 决策一：改哪条链路

| 方案 | 做法 | 取舍 |
| --- | --- | --- |
| A 只改 v2 | 只在通用模板链路落地 | v2 不可用时老板端自动回退 v1（`:619-620`），回退后仍会撞同一问题 |
| B 只改 v1 | 只修经典下单 | v1 是向 v2 迁移中的兼容轨道，改完在 v2 模板上仍原地踏步 |
| **C（选）** | 两条链路都接同一套「预设 + 联想 + 可自填」原语；v2 为主目标、v1 同步补齐 | 覆盖老板端全部真实路径；代价 = 两处渲染 + 两处校验都要动 |

选 **C**。

### 决策二：预设库放哪

| 方案 | 做法 | 取舍 |
| --- | --- | --- |
| A 复用 catalog 的 `GameRegion` | 直接拿它当"大区"预设 | 它是**商家级** catalog 表、与下单字段无外键；段位/模式根本没有对应表。不满足"平台端维护" |
| B 沿用商家级模板 `options` | 保持现状 | 正是用户要改的现状：各商家各写一套，老板看不到联想 |
| **C（选）** | **新建平台级预设表** `PlatformGamePreset`（见「决定」1），平台端增删改查，租户侧只读检索 | 与用户原话「由平台端那边去创建的表格预设库」一致；代价 = 一次建表迁移 + 平台端新页面 |

选 **C**。

### 决策三：联想来源与价格来源是否同一

| 方案 | 做法 | 取舍 |
| --- | --- | --- |
| A 预设库同时决定价格 | 选中预设即按预设加价 | 与 ADR-0003「按游戏绑定加价规则」冲突，等于把平台预设库变成第二张价格表 |
| **B（选）** | **联想只负责输入**（来自平台预设库）；**价格仍由既有 `GamePricingRuleItem` 命中决定** | 不触碰算价口径；库外值 = 未命中 = 基础价 |

选 **B**。

### 决策四：库外值怎么处理

| 方案 | 做法 | 取舍 |
| --- | --- | --- |
| A 继续拦截 | 保持现状（400 / 422 / 客户端不发请求） | 用户明确否掉：「就无法提交，不够灵活」 |
| B 全部选择类字段放开 | 所有 select 都可自填 | 破坏价格选项一致性，客服会看到无法定价的任意值 |
| **C（选）** | **仅三个语义角色**的字段改为「可选可填」：库外值原样保存、**不阻塞提交**，UI 给弱提示；其余选择类字段维持严格校验 | 精确命中用户诉求，边界清晰可测 |

选 **C**。

### 决策五：三字段必填由谁保证

| 方案 | 做法 | 取舍 |
| --- | --- | --- |
| A 商家逐字段勾 `required` | 沿用现状 | 用户要的是"这三项必填"，不是"商家可以勾必填"；模板里没有该字段时无解 |
| **B（选）** | **平台端为每个游戏配置"必需语义角色集合"**（首批默认 `SERVER_REGION` + `TARGET_RANK` + `MODE`），**模板发布 / 发新版本时校验**：缺字段或 `required=false` 即拒绝发布 | 与"平台端维护"一致；把约束卡在**模板入口**而非下单口，存量订单链路不会突然不可用 |
| C 下单时服务端强校验 | 下单口要求三值齐备 | 会让**存量已发布模板**（可能没有这三个字段）当场无法下单，无宽限期 |

选 **B**，并约定：**只对新发布 / 新版本生效，不追溯存量已发布版本。**

### 决策六：老板端控件形态

| 方案 | 做法 | 取舍 |
| --- | --- | --- |
| A 原生 `<select>` 下拉 | 用下拉代替自由文本 | H5 与 weapp 的原生下拉行为不一致；且与"允许自填"目标相反 |
| B H5 用 `datalist` | 借用 DOM 原生联想 | `datalist` 是 DOM-only，weapp 没有；`document` 也只能出现在平台适配目录 |
| **C（选）** | **Taro `Input` + 自绘候选列表**（复用既有 `cu-*` 样式）：输入即过滤、点候选即填、也可直接提交原文 | H5 与 weapp 同一份实现，且天然满足"可选可填"；代价 = 新写一个受控组件及其键盘/失焦行为 |

选 **C**。匹配规则（按优先级）：先 `value` **前缀**匹配 → 再 `value` **包含**匹配（`翡翠` → 翡翠 1..4）→ 再 `aliases` **前缀/包含**匹配（`翡1` → 翡翠 1）。

## 决定

1. **新建平台级预设表** `PlatformGamePreset`：`id` / `gameId`（外键，既有 games 表）/ `kind`（`SERVER_REGION` | `TARGET_RANK` | `MODE`）/ `value`（展示值）/ `aliases`（`String[]`，可空）/ `sortOrder` / `enabled`；唯一键 `@@unique([gameId, kind, value])`。这是本 ADR **唯一**的 schema 变化。
2. **平台端新增维护入口**：既有 `app/(platform)` 下新增 1 个页面（列表 + 新增/编辑/删除 + 启停 + 排序），平台导航补 1 项；同页维护**每个游戏的"必需语义角色集合"**（决定 7）。
3. **新增租户侧只读检索** `GET /api/v1/tenant/game-dispatch/presets?gameId=&kind=&q=`：服务端绑定 `TenantContext`，只返回 `enabled` 项；`q` 为空时按 `sortOrder` 返回前 N 条。**不新增任何写接口。**
4. 老板端下单页的 `SERVER_REGION` / `TARGET_RANK` / `MODE` 三个字段改用**可输入 + 候选列表**控件（决策六 C），候选来自第 3 条接口；点候选即填入 `value`，也可原样提交自填值。
5. **库外值不再阻塞提交**（决策四 C）：客户端不再因这三个字段"值不在选项中"整体 `return`；服务端 v1（400）与 v2（422）的"值不在模板选项中"校验对这三个语义角色**豁免**。其余选择类字段校验不变，既有断言相应收窄而非删除。
6. **库外值不加价**：价格仍按既有 `GamePricingRuleItem` 命中计算，未命中即基础价。UI 必须提示「不在预设库中，将按基础价」，但**不阻止**提交。
7. **必填由模板发布口保证**（决策五 B）：平台端为每个游戏维护"必需语义角色集合"（首批默认三个）；模板**发布 / 发新版本**时校验该集合——缺字段或非必填则**拒绝发布**并给出明确文案（点名缺失的语义角色）。**不追溯**存量已发布版本，**不在下单口**新增必填拦截。
8. **v1 与 v2 两条链路同批落地**（决策一 C）：共享同一张预设表、同一个检索接口、同一份匹配规则、同一个控件组件。
9. **同时解掉 D-13 的适用边界**（背景五）：为三个语义角色开例外，使商家能在设计器里把字段标成"大区 / 目标段位 / 模式"；其余语义角色维持"只给原语"的现状。
10. 本 ADR **不改**：算价口径、订单状态机、订单表结构、`GameRegion` catalog 语义、`GameDispatchRankRule` 的 legacy 只读状态。

## 理由

- 选"平台端新表"而非复用 catalog，是因为 `GameRegion` 已被服务目录与陪玩技能引用且属商家级语义；把它改造成平台预设会污染 catalog 边界，而段位/模式本来就没有表可复用。
- 把"必填"放在**模板发布口**而不是下单口，是为了同时满足"三字段必填"与"不让存量模板突然失效"：发布口是模板的唯一入口，卡在这里能保证**新单不会缺字段**，而存量版本继续可下单。
- 把"联想来源"与"价格来源"分开（决策三 B），是为了不让输入辅助功能顺带改动算价口径——算价是 2026-09-20 已确认、ADR-0003 在管的口径，不应被本功能波及。
- "库外值不阻塞"只放开三个语义角色，是因为其余选择类字段承载"选项价格调整"的一致性；全放开会让客服看到无法定价的任意值，等于把问题从老板端挪到客服端。
- 控件选自绘而非原生 `datalist`/`<select>`，是"H5 与 weapp 必须同源"的硬约束（AGENTS.md）与"允许自填"目标共同决定的。
- 必须解 D-13 的边界，是因为不暴露这三个语义角色，商家就无法让模板满足"必备字段"校验——决策 5 与决策 7 是同一个约束的两端。

## 影响

- **数据**：新增 1 张表 + 1 次迁移；无既有列改动、无数据回填。
- **接口**：新增 1 个平台侧维护端点组 + 1 个租户侧只读检索端点；OpenAPI 需重新生成并提交生成物。
- **前端**：平台端新增 1 个页面 + 1 个导航项；老板端下单页新增 1 个控件组件并替换 2 处渲染（v1 / v2 各一处）；商家端模板设计器放开 3 个语义角色选项。
- **校验语义**：三个语义角色的"值不在模板选项中"从**错误**降级为**提示**；其余字段不变。既有单测断言需相应调整——**实施后落实为 3 条**（`game-template-calculations.spec.ts` 的 `target_rank: "unknown"` 与 `mode: "unknown"`、`game-template-order-draft.spec.ts` 的 `mode: "not-declared"`），处理方式是把「未知选项被拒」的覆盖**改挂到未豁免的 `CUSTOM` 字段**而非删除断言；设计期点名的另两处（`order-values.spec.ts:124-135`、`game-template-values.spec.ts:61`）实际未转红、原样保留。详见「实施记录（第一批）」。
- **产品裁定**：修订 D-13「只给原语，不给预设」的适用边界（三个语义角色开例外）。
- **不变量**：算价口径、订单状态机、租户隔离、`GameRegion` catalog 语义均不变。

## 迁移方式

**一次建表迁移**，无既有列改动、无数据回填。

| 写入 | 目标 | 现状 |
| --- | --- | --- |
| 平台预设 | `platform_game_presets`（新建） | **本次新增** |
| 游戏的必需语义角色集合 | 与预设同页维护；落点二选一（见下） | **本次新增** |
| 老板端提交的三个字段值 | `game_dispatch_orders.form_values_json`（`schema.prisma:1336`） | 已存在，库外值原样写入，**不改表结构** |

- 命令：`pnpm --filter @pw/database migrate:dev -- --name add_platform_game_presets`，随后 `pnpm --filter @pw/database generate`。
- **按 AGENTS.md「执行数据库迁移」需单独授权**；授权时须列出目标库（`pw_saas` 与 `pw_saas_test`）、影响与回滚方式。迁移目录：`packages/database/prisma/migrations/<YYYYMMDDHHMMSS>_add_platform_game_presets/`。
- "必需语义角色集合"的落点待实施计划确定：优先倾向**复用既有 `games` 表新增一个 JSON 列**，从而避免第二张表；若实施时发现 `games` 属 catalog 且不宜承载平台派单约束，则改为独立小表——两种落点都不影响本 ADR 的其他决定。
- 首批预设数据的录入方式（平台端页面手工录入 vs 一次性种子脚本）属实施细节；**种子脚本若写库需单独授权**。

## 回滚方式

- **代码回滚**：撤销本次提交即可。老板端退回"无联想 + 库外值报错"的旧行为，其余功能不受影响。
- **schema 回滚**：`DROP TABLE "platform_game_presets";`（若决定新增 `games` 列则 `ALTER TABLE "games" DROP COLUMN ...;`）。该表是引用方（引用 `games`），不被任何既有表外键引用，删除不影响订单、模板、价格数据。
- **数据回滚**：无。库外值只写进既有的 `form_values_json`，不产生孤儿行、不需要降级脚本。
- **契约回滚**：新增端点为纯新增，删除后旧客户端不受影响；需重新生成 OpenAPI 生成物。

## 验证证据

**现状证据（2026-09-27 只读核实，全部为文件内事实）**

- 两条链路与自动回退：`game-order/index.tsx:619-620`、`:668`、`:706-740`、`:762-800`。
- v1 老板端把 `select` 降级为自由文本、选项只当 placeholder：`game-order/index.tsx:1049-1061`，其中 `:1054` 为 `placeholder={field.options[0] ?? "填写"}`。
- v2 单选只有封闭分段按钮：`game-order/index.tsx:226-277`；自由输入仅 `TEXT`/`TEXTAREA`：`:284-309`。
- 三字段由 `semanticRole` 标识：`schema.prisma:1103-1114`；字段组件 `:1149-1173`；`required` 默认 `false`：`:1158`。
- 模板缺字段时下单无感知：`game-template-document.ts:270-303`。
- 三层拦截库外值：`order-values.ts:242-252`、`:335-407`、`game-order/index.tsx:708-712`；`game-template-values.ts:71-77`；`game-template-calculations.ts:232-236`、`game-template-document.ts:74-79`。
- 平台端零基础：`platform-shell.tsx:41-68`（导航仅 8 项）；`app/(platform)` 整目录对 `rank|region|mode|template|段位|大区|模式|模板` 零命中。
- 设计器不暴露三个语义角色：`template-editor-meta.ts:28`、`:53-60`；依据 `派单模板表单设计器-设计规格-v0.2.md:16`（D-13）。
- 价格权威与 legacy 边界：`schema.prisma:1270-1301`（`GamePricingRule`/`GamePricingRuleItem`）、`:1228-1242`（`GameDispatchRankRule`，ADR-0003 降级）。
- `GameRegion` 与下单字段无外键：`schema.prisma:379-392`、`:398`、`:434`。
- 既有行为断言（**2026-09-27 设计期复核 + 实施后二次更正**）：`order-values.spec.ts:124-135`、`game-template-values.spec.ts:61`——两处夹具字段都没有 `semanticRole`（`order-values.spec.ts:25-38`、`game-template-values.spec.ts:23-31`），不是豁免角色，故本改动不会令其转红；它们转而充当「豁免没写宽」的护栏。**但由这两条推出的「既有断言一律不需要收窄」不成立**：另有 **3 条**断言挂在真正的豁免角色夹具上（`game-template-calculations.spec.ts` 的 `pricedConfig()` 含 `TARGET_RANK`/`MODE`、`game-template-order-draft.spec.ts` 的 `orderConfig()` 含 `MODE`），实施时确实转红，已按「把覆盖改挂到未豁免的 `CUSTOM` 字段」收窄——见「实施记录（第一批）·既有断言收窄」。
- ~~v1 建模板接口接受 `semanticRole`~~ —— **2026-09-27 实施时实测推翻**：`domain/game-template.ts:43` 的 `TemplateFieldInput.semanticRole?` 只是域内可选类型，**HTTP 契约层不放行**——v1 建模板路由有严格 Zod 请求校验，带该键的 payload 实测返回 **400** `{"code":"ApiValidationError","fieldErrors":{"fields":["Unrecognized key: \"semanticRole\""]}}`；且 `application/game-template.service.ts:64-113` 的 `cleanFields` 逐键构造返回对象时**从不读该键**、`infrastructure/prisma-game-template.repository.ts:140-155` 的 `createMany` **不写该列**。⇒ v1 字段恒为 DB 默认 `CUSTOM`（`schema.prisma:1157`），集成用例**无法**通过 v1 建模板 payload 标注语义角色；v1 的豁免在现有链路不可达。已登记 `docs/unverified-and-deferred.md` §C。
- v1 的 `activeTemplateFields`（`game-template-values.ts:18-21`）是泛型且原样返回行对象 ⇒ 运行时 `semanticRole` 已在传给 `templateFormValueError` 的对象上。
- v2 集成夹具的豁免角色是 `MODE`（`tests/integration/game-dispatch-template-order.spec.ts:32-47`，选项无 `priceDeltaFen`）；该文件无 `TARGET_RANK` 夹具。
- **无任何用例覆盖**：前缀联想（`翡1` → 翡翠1）、"三字段必填"这条业务约束、库外值不阻塞提交。

**获批后需取得的验收证据（实施计划将逐条给出命令）**

- 输入「翡翠」出现翡翠 1..4；输入「翡1」命中翡翠 1；输入库外值可提交成功且订单金额等于基础价。
- 模板缺 `TARGET_RANK` 时发布被拒并点名该语义角色；存量已发布版本仍可正常下单。
- v1 与 v2 两条链路行为一致（同一份输入在两条链路得到同样的候选与同样的可提交性）。
- 租户隔离用例覆盖新增的只读检索端点。

## 批准记录

- 2026-09-27：**待批准**。本 ADR 依据用户授权「Bug2 先出方案」撰写；撰写过程未改任何产品代码、未执行迁移、未提交。获批后方可进入实施计划（`docs/superpowers/plans/`）。
- 2026-09-27：**三处方案分歧点已由用户确认**（用户所选选项逐字）——① 「按基础价 + 下单页提示（推荐）」：库外值不改价、按基础价，仅在下单页提示，不阻止提交；② 「卡模板发布口，不追溯存量（推荐）」：三字段必填只卡模板发布口，存量已发布版本不回填、不追溯；③ 「分两批：先解「不能提交」，再建预设库（推荐）」：实施拆两批，第一批**零迁移、不建表**，只解库外值不阻塞提交；第二批再建平台预设库 + 联想 + 必填校验。**该确认只解决分歧点本身，不构成对整份 ADR 的批准**——状态仍为待批准。- 2026-09-27：**批准（已批准）**。用户以 AskUserQuestion 选定「批准 ADR + 开工第一批（推荐）」⇒ 本 ADR 转「已批准」，并授权按 `docs/superpowers/plans/2026-09-27-order-field-free-input-batch1.md` 实施**第一批**（Task 1–5：v1/v2 服务端豁免、老板端 v2 预检豁免与自由文本输入、集成回归）。范围约束：**零迁移、不建表、不加端点、不改契约**；**不授权**第二批（平台预设库建表迁移、`GET /api/v1/tenant/game-dispatch/presets`、平台端维护页、候选列表控件、模板发布口必填校验），也**不授权** Git 提交/推送与任何部署动作。第二批待第一批落地后另立计划并单独授权。

## 实施记录（第一批，2026-09-27）

**范围**：零迁移、不建表、不加端点、不改契约。只解「库外值不能提交」（决定 4 / 决定 6 的**单选**部分）。**未做**：决定 1–3、5（预设库 / 检索端点 / 平台端维护页 / 候选列表控件）、决定 7（模板发布口必填）、决定 9（设计器放开三个语义角色）——均属第二批。

| # | 文件 | 改动 |
| --- | --- | --- |
| 1 | `apps/api/src/modules/game-dispatch/domain/game-template-values.ts` | 新增 `FREE_INPUT_SEMANTIC_ROLES`（`SERVER_REGION` / `TARGET_RANK` / `MODE`）与 `allowsFreeInput`；`templateFormValueError` 的「值不在模板选项中」加 `!allowsFreeInput(field)` 条件 |
| 2 | `.../domain/game-template-calculations.ts`、`.../domain/game-template-document.ts` | `selectedOption(...)` / `findOption(...)` 增加 `allowFreeValue` 参数：**单选**传 `allowsFreeInput(...)`，**多选恒传 `false`**；库外值合成 `{ value, label: value }`，不命中定价规则 ⇒ 加价 0（按基础价） |
| 3 | `apps/mobile/src/features/customer-ui/order-values.ts` | 客户端预检同口径豁免（同集合 + `allowsFreeInput`）；`convertChoice` 增第 4 参数 `allowFreeValue`。**表格 `SINGLE_SELECT` 列不豁免**（见「未决项」②） |
| 4 | `apps/mobile/src/pages/customer/game-order/index.tsx` | 豁免字段**保留预设分段按钮**并追加一个自由文本 `Input`（`cu-input`）；提示文案追加「，可填写预设外的值；不在预设库中不影响提交，将按基础价。」。**偏差**：计划原文要求"走文本 Input 分支"（替换掉按钮组），实际改为**混合式**——纯文本会丢掉预设点选，相对现状是倒退 |
| 5 | `tests/integration/game-dispatch-template-order.spec.ts` | 新增 v2 集成用例：`mode: "aram"`（规则库只有 `mode=ranked → 1500`）⇒ 201、`priceAdjustmentFen === "0"`、`document.plainText` 含「游戏模式：aram」、`formValuesJson.mode === "aram"` |

**既有断言收窄（3 条，均为「把覆盖改挂到未豁免的 `CUSTOM` 字段」，无删除）**：

- `game-template-calculations.spec.ts` —「拒绝未知选项…」中 `target_rank: "unknown"` 的「应被拒」改为「放行且加价 0」；「未知选项被拒」改由同文件新增用例「未豁免的多选字段仍然拒绝库外值」（`extras: ["unknown_extra"]`）承担。
- 同文件 —「取值校验保留…」中 `mode: "unknown"` 改挂到 `extras: ["unknown"]`（`choiceConfig()` 的 `mode` 是 `MODE`，`:408`）。
- `game-template-order-draft.spec.ts:215` —「拒绝未声明的选项值与越界人数」中 `mode: "not-declared"` 改挂到新内联构造的 `CUSTOM` 单选字段 `plan`；`MODE` 的库外值改为断言「正常建草稿」。
- **未收窄、原样保留**：`apps/mobile/src/features/customer-ui/order-values.spec.ts:124-135`、`apps/api/src/modules/game-dispatch/domain/game-template-values.spec.ts:61`（夹具无 `semanticRole`，继续充当护栏）。

**新增回归用例**：api 侧 2 条（`game-template-values.spec.ts` 三个豁免角色逐一放行 + 未标注字段仍拦；`game-template-calculations.spec.ts` 豁免角色库外值放行 / 不加价 / 同单其他字段照旧加价），mobile 侧 2 条（豁免角色放行并进入提交体 / `CUSTOM` 角色仍拦），集成侧 1 条（上表第 5 行）。

**验证证据（2026-09-27，全部退出码 0）**：`pnpm test` 953 passed / 1 skipped（104 文件）；`pnpm test:integration` 315 passed（61 文件）；`pnpm test:tenant-isolation` 44 passed（12 文件）；`pnpm typecheck` 10/10 turbo 任务 + `typecheck:tests`；`pnpm --filter @pw/mobile typecheck`；`pnpm build:h5`、`pnpm build:weapp`。移动端 Task 3 为 TDD 红→绿（红：`expected [ '目标段位 的值不在模板选项中' ] to deeply equal []`）。

**证据缺口（如实登记）**：本批**只有自动化证据，无页面人工实测**——按用户授权原文「页面人工实测另起服务时再单独报」。因此决定 4 在 UI 上的实际观感（自由文本输入框与预设按钮并存、提示文案位置）**未经验证**。

**未决项（需用户决策方向）**：

1. **v1 经典链路实际仍拦库外值**——语义角色在 v1 不可达（依据见本 ADR「验证证据」段的实测推翻条目）。本批 Task 1 对 v1 的豁免属**前瞻性保留**。出路：(a) 扩展 v1 契约（OpenAPI/Zod + repository 写列 + 重新生成客户端，属契约变更需另行授权）；(b) 保留前瞻性代码、按已知限制接受（决定一「两条链路都要改」只落实了 v2）；(c) 回退本批的 v1 改动。
2. **移动端表格 `SINGLE_SELECT` 列不豁免**：`order-values.ts:360-364` 传 `false`，而服务端文案侧已放行（`game-template-document.ts:96-99` 传 `allowsFreeInput(column)`）；算价侧本就不覆盖列（`templatePricingDimensionFields` 只取 `FIELD`，`game-template-calculations.ts:402-410`）⇒ 同一输入两端口径不一致。
3. **`apps/admin-web/app/_lib/merchant-console/template-document-preview.ts:92`** 是同一规则的**第三份实现**，商家端预览会对服务端已接受的库外值报错。

以上 2 / 3 已登记 `docs/unverified-and-deferred.md` §C。

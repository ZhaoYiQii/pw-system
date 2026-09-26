# 下单三字段「可自填、不阻塞提交」第一批实施计划

Goal: 让大区 / 目标段位 / 模式三个语义角色字段允许老板填写模板选项之外的自由文本，且库外值不再阻塞提交（价格口径不变，库外值按基础价）。

Architecture: 只改**校验层与 v2 老板端渲染**，不建表、不加接口、不加字段。服务端两条链路各放开一处「值不在模板选项中」的硬校验（仅限三个语义角色）；移动端 v2 的本地预检同步放开，并把这三个字段的单选题控件从「封闭分段按钮」改为自由文本输入（与 v1 行为对齐）。第二批再引入平台预设库与「可输入 + 候选列表」控件替换本批的纯文本输入。

Tech stack: TypeScript strict / NestJS / Prisma / Taro 4 + React 18.3.1（H5 + weapp）/ Vitest。

Spec: `docs/adr/0010-order-region-rank-mode-presets.md`（**已批准**，2026-09-27）的决定 4、5、6、8；本计划只覆盖用户选定的**第一批**（「先解『不能提交』」）。

Scope and non-goals:

- **范围内**：v1 服务端选项成员校验豁免；v2 服务端豁免（价格计算 + 文档生成两处）；移动端 v2 本地预检豁免；v2 三个语义角色字段改为自由文本输入；对应单测与集成测试；确认既有断言保持绿（反向护栏，**不改动**）；台账更新。
- **非目标（属于第二批）**：平台预设库表与迁移；平台端维护页；`GET /api/v1/tenant/game-dispatch/presets`；候选列表（联想）控件；前缀/别名匹配（`翡1` → 翡翠1）；模板发布口的三字段必填校验；放开模板设计器的 `SERVER_REGION`/`TARGET_RANK`/`MODE` 语义角色绑定。
- **本轮明确不做**：`CURRENT_RANK`（当前段位）与 `MULTI_SELECT` 仍保持严格校验；库外值不改价（不新增金额字段、不改加价规则）；不改订单表结构；不动 `GameRegion` / `GameDispatchRankRule`。

Permission gates（以下动作**本计划不授权**，执行前须单独确认）：

- 执行任何数据库迁移——**本批为零迁移，不需要**；若实施中发现需要，立即停止并回到 ADR。
- 安装/升级任何依赖——本批不需要。
- 任何 Git 动作（提交 / 分支 / 推送）——不在本计划内。
- 重启或新起本地服务（3300 / 3101）——仅在需要人工实测时单独提出。

Completion evidence（全部须取得并记录命令与退出码）：

1. `cd "D:/pw system" && pnpm exec vitest run apps/api/src/modules/game-dispatch/domain/game-template-values.spec.ts apps/api/src/modules/game-dispatch/domain/game-template-calculations.spec.ts` 退出码 0（含新增用例）。
2. `cd "D:/pw system" && pnpm exec vitest run apps/mobile/src/features/customer-ui/order-values.spec.ts` 退出码 0（含新增用例）。
3. `pnpm typecheck` 与 `pnpm typecheck:tests` 退出码 0。
4. `pnpm test:integration` 退出码 0（含新增两条集成用例）。
5. `cd "D:/pw system" && pnpm build:h5` 退出码 0（H5 产物可构建）。
6. 既有断言**未被改动**的证据：`git diff` 中不出现 `order-values.spec.ts:124-135` 与 `game-template-values.spec.ts:61` 那两条用例的改动（它们不需要收窄）。（**执行后更正**：该结论对这**两条**成立；但「既有断言一律不需要收窄」的一般化结论**不成立**——另有 3 条豁免角色断言转红并已收窄，见文末「执行结果与偏差」。）

项目级约束（逐字沿用 AGENTS.md 与既有规则）：

- 「只修改当前 Slice 拥有的文件；需要越界时停止并说明原因。」
- 「不得创建空实现、始终成功的 Provider、吞异常的 catch、伪造命令输出或空测试脚本。」
- 「移动端业务代码必须同时面向 H5 和 weapp；window、document、localStorage、wx 只能出现在平台适配目录。」
- 「使用 TypeScript strict。」
- 「API 契约来自 OpenAPI；生成客户端不得手工修改。」
- 「金额使用整数分或明确的十进制数值对象。」
- 「文本使用 UTF-8 与 LF；导入路径大小写必须与文件名完全一致。」
- 「禁止业务代码包含 Windows 绝对路径。」
- 台账沿用既有两份，不新建开发日志。

## 实施映射（先读这一节）

| 文件 | 角色 | 本批改动 |
| --- | --- | --- |
| `apps/api/src/modules/game-dispatch/domain/game-template-values.ts` | v1 值校验域函数 | 新增 `semanticRole` 到 `TemplateValueField`；新增豁免判定；`templateFormValueError` 的选项成员校验对三个语义角色放行 |
| `apps/api/src/modules/game-dispatch/domain/game-template-calculations.ts` | v2 价格计算 | `selectedOption()` 对三个语义角色改返回合成选项（`priceDeltaFen` 缺省 = 0 加价） |
| `apps/api/src/modules/game-dispatch/domain/game-template-document.ts` | v2 文档/格式化 | `findOption()` 对三个语义角色返回 `{ value, label: value }` |
| `apps/mobile/src/features/customer-ui/order-values.ts` | 老板端 v2 值采集与本地预检 | `OrderFieldLike` 增加 `semanticRole`；`convertChoice` 增加豁免；导出共享判定 |
| `apps/mobile/src/pages/customer/game-order/index.tsx` | 老板端下单页 | `FieldInput` 对三个语义角色的 `SINGLE_SELECT` 改渲染自由文本 `Input` |

**不改**：`apps/api/src/modules/game-dispatch/application/game-dispatch.service.ts`（`:417-421` 的调用形态不变，`semanticRole` 由 `TemplateValueField` 透传）、`generic-game-template.service.ts`（`visibleConfigV2` 已把 `semanticRole` 透出，无需改）、`customer-game-template.controller.ts`、`game-dispatch.controller.ts`、任何 OpenAPI 生成物（本批不加端点、不改请求体形状）。

**已核实的关键事实**（实施时不要重新推导）：

- v1 老板端**没有**本地选项校验：`game-order/index.tsx:762-800` 的 `submitV1` 只判必填 ⇒ v1 只需改服务端。
- v2 老板端**有**本地预检：`order-values.ts:242-252`（`convertChoice`）+ `:335-407`，页面 `game-order/index.tsx:708-712` 一有错就 `return` 不发请求。
- v1 服务端字段来自 DB（`game-dispatch.service.ts:409-421` 的 `templateFields`），Prisma 行自带 `semanticRole`，只是 `TemplateValueField`（`game-template-values.ts:7-15`）没声明它。`activeTemplateFields`（`:18-21`）是泛型 `T extends TemplateValueField` 且**原样返回行对象**（不过滤字段）⇒ 运行时 `semanticRole` 已经在传给 `templateFormValueError` 的对象上，Task 1 是纯类型放宽 + 判定新增，**无任何管道改造**。
- v1 的建模板接口**接受 `semanticRole`**：`domain/game-template.ts:43`（`TemplateFieldInput.semanticRole?: GameTemplateSemanticRole`），控制器原样透传（`interface/game-template.controller.ts:90-91`、`:120-121`）⇒ Task 5.1 可直接在建模板 payload 里加该键，**不需要直接写库**。
- 既有域用例的夹具**没有** `semanticRole`：`game-template-values.spec.ts:23-31`（`rank` 字段只有 fieldKey/label/fieldType/required/enabled/sectionId/options）⇒ 该 spec `:61` 的既有断言**不会**因本批改动转红，它会继续充当「未标豁免角色仍被拦」的护栏。
- v2 集成夹具里的豁免角色是 **`MODE`**（`game-dispatch-template-order.spec.ts:32-47`，`required: true`、options `ranked`/`normal`、**无 `priceDeltaFen`**）；该文件**没有** `TARGET_RANK` 夹具 ⇒ Task 5.2 用 `MODE`，且「命中即加价」只能由 Task 2.1 的单测（带 `priceDeltaFen: "500"`）证明。
- v2 客户端口表单的 `semanticRole` **可见**：`visibleConfigV2`（`game-template-config-v2.ts:245-260`）经 `visibleComponentsV2`（`:226-239`）**原样透出**组件对象，只有端口过滤、没有字段裁剪。
- `TemplateChoiceOptionV2.priceDeltaFen` 是**可选**（`game-template-config-v2.ts:82-86`）⇒ 合成选项 `{ value, label: value }` 类型合法。
- v2 单选控件现状：`game-order/index.tsx:226-277` 全封闭分段按钮；文本分支在 `:284-309`。

## 任务

### Task 1 — v1 服务端：三个语义角色豁免选项成员校验

**覆盖需求**：ADR-0010 决定 5（v1 侧）、决定 4。

**前置**：无。本任务不依赖其他任务。

- [ ] 1.1 写红灯用例。文件 `apps/api/src/modules/game-dispatch/domain/game-template-values.spec.ts`，新增两个用例：
  - `目标段位（TARGET_RANK）填库外值不再报错`：字段 `{ fieldKey: "rank", label: "目标段位", fieldType: "select", required: true, enabled: true, sectionId: null, options: ["翡翠1","翡翠2"], semanticRole: "TARGET_RANK" }`，值 `{ rank: "神秘段位" }` ⇒ 期望 `templateFormValueError(...) === null`。
  - `非豁免角色的选项越界仍然报错`：同一字段把 `semanticRole` 换成 `"CUSTOM"`（或 `null`），值仍为 `"神秘段位"` ⇒ 期望返回 `"目标段位的值不在模板选项中"`。
- [ ] 1.2 跑该 spec，记录红灯证据：`cd "D:/pw system" && pnpm exec vitest run apps/api/src/modules/game-dispatch/domain/game-template-values.spec.ts`。期望：1.1 第一条失败（当前返回「目标段位的值不在模板选项中」）、第二条通过。
- [ ] 1.3 改 `game-template-values.ts`：
  - `TemplateValueField` 增加 `semanticRole?: string | null;`
  - 文件顶部新增导出常量 `export const FREE_INPUT_SEMANTIC_ROLES: ReadonlySet<string> = new Set(["SERVER_REGION", "TARGET_RANK", "MODE"]);`
  - 新增 `export function allowsFreeInput(field: { semanticRole?: string | null }): boolean { return field.semanticRole != null && FREE_INPUT_SEMANTIC_ROLES.has(field.semanticRole); }`
  - `templateFormValueError` 的第二个 `if` 增加前置条件 `!allowsFreeInput(field) &&`（必填校验 `:70` **不动**）。
- [ ] 1.4 重跑 1.2 的命令 ⇒ 两条用例均通过，退出码 0。
- [ ] 1.5 跑该域的全部 spec 确认无回归：`cd "D:/pw system" && pnpm exec vitest run apps/api/src/modules/game-dispatch/domain`。
- [ ] 1.6 确认既有断言**未**转红：`game-template-values.spec.ts:61`（断言「目标段位的值不在模板选项中」）用的夹具 `rank`（`:23-31`）没有 `semanticRole` ⇒ 应保持通过。**若它转红，说明豁免判定写宽了（把未标注的字段也放行了），必须修实现而不是改断言。**

**回滚**：还原上述四处编辑即可；无数据写入、无迁移。

### Task 2 — v2 服务端：豁免价格计算与文档生成两处

**覆盖需求**：ADR-0010 决定 5（v2 侧）、决定 6（库外值 = 未命中 = 不加价）。

**前置**：Task 1 已完成（可复用同一组语义角色字面量；两处各自定义常量亦可，但**不得**在两处写不一致的集合）。

- [ ] 2.1 写红灯用例，文件 `apps/api/src/modules/game-dispatch/domain/game-template-calculations.spec.ts`：
  - `TARGET_RANK 单选提交库外值：不抛错且加价为 0`：构造 `config` 含一个 `fieldType: "SINGLE_SELECT"`、`semanticRole: "TARGET_RANK"`、`options: [{ value: "翡翠1", label: "翡翠1", priceDeltaFen: "500" }]` 的组件（可参考该 spec `:258` 已有的 `TARGET_RANK` 夹具），值 `{ [stableKey]: "神秘段位" }` ⇒ 期望 `calculateTemplatePriceAdjustmentFen(config, values)` 返回 `0n` 且不抛异常。
  - `同一配置下命中选项仍按选项加价`：值改为 `"翡翠1"` ⇒ 期望返回 `500n`（守住"命中即加价"不被本次改动破坏）。
- [ ] 2.2 跑红灯：`cd "D:/pw system" && pnpm exec vitest run apps/api/src/modules/game-dispatch/domain/game-template-calculations.spec.ts`，记录第一条失败（当前抛 `TEMPLATE_VALUE_INVALID`）。
- [ ] 2.3 改 `game-template-calculations.ts`：把 `selectedOption`（`:218-239`）的 `source` 形参类型从 `readonly TemplateChoiceOptionV2[]` 改为携带语义角色的对象，并在 `:231` 的 `if (!option)` 分支里，当该组件的语义角色属于三个豁免角色时返回合成选项 `{ value, label: value }`（`priceDeltaFen` 省略 ⇒ `optionPriceFen` 返回 `0n`）。`collectChoiceSelections`（`:315` 起）与 `calculateTemplatePriceAdjustmentFen` 保持现有调用形态，只把 `component` 传进去。
  - **不要**放宽 `:223-229` 的"必须提交字符串"判断；**不要**改 `:348-354` 的多选上限与 `:355` 的重复校验（MULTI_SELECT 不在豁免范围）。
- [ ] 2.4 重跑 2.2 ⇒ 两条用例通过。
- [ ] 2.5 写红灯用例，文件 `apps/api/src/modules/game-dispatch/domain/game-template-document.spec.ts`（**已存在**，追加用例）：`TARGET_RANK 库外值在文档里原样显示（label = 原值）`。先跑，记录红灯（当前抛 `${label}的值不在模板选项中`）。
- [ ] 2.6 改 `game-template-document.ts` 的 `findOption`（`:57-82`）：`source` 形参类型补 `semanticRole?: GameTemplateSemanticRole | null`；`:74` 的 `if (!option)` 分支在豁免角色下返回 `{ value, label: String(value) }`，否则维持现抛错。
  - 表格列（`formatTableColumnValue` `:84-93`）走同一函数：列若标了三个豁免角色之一则一并豁免，这与字段行为一致；未标注的列不受影响。
- [ ] 2.7 重跑 2.5 ⇒ 通过；再跑 `cd "D:/pw system" && pnpm exec vitest run apps/api/src/modules/game-dispatch/domain` 确认该目录全绿。
- [ ] 2.8 跑 v2 订单服务的 spec 确认无回归：`cd "D:/pw system" && pnpm exec vitest run apps/api/src/modules/game-dispatch/application`。

**回滚**：还原两处函数编辑即可。库外值在此前的行为是抛错 ⇒ 回滚后恢复抛错，已产生的订单数据不受影响（值本来就存在 `form_values_json` 里）。

### Task 3 — 移动端 v2：本地预检豁免

**覆盖需求**：ADR-0010 决定 4 的客户端一半、决定 5。

**前置**：Task 1（取自 `FREE_INPUT_SEMANTIC_ROLES` 的同一组字面量；移动端**不 import** API 包，需在本包内声明一份等价常量，并在注释里指回 ADR-0010 决定 4 说明两处必须同步）。

- [ ] 3.1 写红灯用例，文件 `apps/mobile/src/features/customer-ui/order-values.spec.ts`：
  - `TARGET_RANK 填库外值时不再产生错误且进入提交体`：字段 `{ kind: "FIELD", stableKey: "target_rank", label: "目标段位", fieldType: "SINGLE_SELECT", required: true, enabled: true, sortOrder: 0, sectionKey: "s", semanticRole: "TARGET_RANK", options: [{ value: "翡翠1", label: "翡翠1" }] }`，值 `{ target_rank: "神秘段位" }` ⇒ 期望 `collectOrderValues(...)` 返回 `ok: true` 且提交体中该键为 `"神秘段位"`。
  - `非豁免的 SINGLE_SELECT 仍拦截库外值`：同一字段改 `semanticRole: "CUSTOM"` ⇒ 期望 `ok: false` 且消息为 `目标段位 的值不在模板选项中`（**沿用**既有文案，不改文案）。
- [ ] 3.2 跑红灯：`cd "D:/pw system" && pnpm exec vitest run apps/mobile/src/features/customer-ui/order-values.spec.ts`，记录第一条失败。
- [ ] 3.3 改 `apps/mobile/src/features/customer-ui/order-values.ts`：
  - `OrderFieldLike`（`:32-43`）增加 `semanticRole?: string | null;`
  - 新增 `export const FREE_INPUT_SEMANTIC_ROLES: ReadonlySet<string>`（值同 Task 1，注释指回 ADR-0010 决定 4）
  - 新增 `export function allowsFreeInput(field: { semanticRole?: string | null }): boolean`
  - `convertFieldValue`（`:254`）的 `case "SINGLE_SELECT"`（`:283-284`）传入豁免判定；`convertChoice`（`:242-252`）增加第三个参数 `allowFreeValue: boolean`，为 `true` 时直接返回 `{ ok: true, value }`。`MULTI_SELECT`（`:285-300`）继续传 `false`。
- [ ] 3.4 重跑 3.2 ⇒ 两条通过。
- [ ] 3.5 确认既有断言**未**转红：该 spec `:124-135` 断言「模式 的值不在模板选项中」，其夹具 `mode`（`:25-38`）**没有** `semanticRole`（只有 stableKey/label/enabled/sortOrder/fieldType/required/options）⇒ 应保持通过。**若它转红，说明豁免判定写宽了，必须修实现而不是改断言。**
  - 附注：该夹具的 `ranked` 选项带 `priceDeltaFen: "1500"`，说明客户端确实能读到加价；但自由值不参与客户端加价计算（价格权威在服务端），本批**不要**在客户端为自由值补算价格。
- [ ] 3.6 跑移动端全量单测：`cd "D:/pw system" && pnpm exec vitest run apps/mobile`。

**回滚**：还原 `order-values.ts` 三处编辑；UI 不受影响。

### Task 4 — 移动端 v2：三个语义角色字段改为自由文本输入

**覆盖需求**：ADR-0010 决定 4（UI 侧）、决定 6 的「UI 提示」；第二批将被候选列表控件替换。

**前置**：Task 3 已完成（`allowsFreeInput` 可用）。

- [ ] 4.1 改 `apps/mobile/src/pages/customer/game-order/index.tsx` 的 `FieldInput`（`:208`）：在 `:226` 的分支之前插入判定——当 `field.fieldType === "SINGLE_SELECT" && allowsFreeInput(field)` 时，走文本分支（复用 `:295-309` 的 `Input`），并在 `:310-314` 的 `cu-field-note` 之后追加一行提示文案 `可填写预设外的值；不在预设库中不影响提交，将按基础价。`
  - 实现上建议把文本分支抽成局部渲染函数供两处复用，避免复制 `Input` 的 `type`/`name`/`aria-label` 属性块。
- [ ] 4.2 确认 `MULTI_SELECT` 与未标豁免角色的 `SINGLE_SELECT` **不进入**该分支（`:226-277` 的既有行为不变）。
- [ ] 4.3 构建验证：`cd "D:/pw system" && pnpm build:h5` 退出码 0；并跑 `cd "D:/pw system" && pnpm build:weapp` 退出码 0（本组件不得引入任何 DOM-only API）。
- [ ] 4.4 类型验证：`pnpm typecheck` 退出码 0。

**回滚**：还原 `FieldInput` 的编辑；单选字段恢复为封闭分段按钮。

### Task 5 — 集成回归与既有断言护栏确认

**覆盖需求**：ADR-0010「获批后需取得的验收证据」的前两条在**本批**可取得的版本（联想与必填属第二批）。

**前置**：Task 1–4 均已完成。

- [ ] 5.1 在 `tests/integration/game-dispatch-flow.spec.ts` 追加用例 `v1 下单：目标段位填库外值成功创建，订单金额不变`：
  - 先在既有建模板 payload 的 `rank` 字段（`:126-131`）加 `semanticRole: "TARGET_RANK"`。该接口接受此键（`TemplateFieldInput.semanticRole`，`game-template.ts:43`；控制器 `game-template.controller.ts:90-91` 原样透传），**不需要直接写库**。
  - 用两份输入各下一次单：`formValues.rank = "翡翠"`（夹具选项内）与 `formValues.rank = "神秘段位"`（库外），其余照该文件既有的下单写法。期望两者都 **201**，且两次返回的订单金额**相等**（证明库外值不加价；ADR-0003 下加价来自按游戏的加价规则而非 `rankRules`，故用差额断言而非绝对金额）。
- [ ] 5.2 在 `tests/integration/game-dispatch-template-order.spec.ts` 追加用例 `v2 下单：MODE 填库外值成功创建且加价为 0`：复用该文件既有的 `mode` 组件夹具（`:32-47`，`semanticRole: "MODE"`、`required: true`、options `ranked`/`normal`）。该文件**没有** `TARGET_RANK` 夹具，**不要**为凑用例新增组件。提交 `mode = "aram"`（库外值），期望：创建成功（`CreateOrderResult`，`:69-80`）且 `priceAdjustmentFen === "0"`。
  - 该夹具的选项都不带 `priceDeltaFen` ⇒ **加价不为 0 才需要排查**；「命中选项仍按选项加价」由 Task 2.1 的单测（带 `priceDeltaFen: "500"`）负责证明，不在本用例里重复。
- [ ] 5.3 跑 `pnpm test:integration`，记录退出码与用例数（须 ≥ 改前基线 + 2）。
- [ ] 5.4 跑 `pnpm test:tenant-isolation` 退出码 0（本批不改仓储与租户边界，属回归护栏）。
- [ ] 5.5 跑 `pnpm typecheck` 与 `pnpm typecheck:tests` 退出码 0。

**回滚**：删除新增用例即可；无数据写入（集成测试用测试库）。

### Task 6 — 台账与文档同步

**覆盖需求**：用户既有偏好「完成 Sprint 后写入既有台账，不新建开发日志」。

- [ ] 6.1 更新 `docs/adr/0010-order-region-rank-mode-presets.md`：状态行补记「第一批（决定 4/5/6 的零迁移部分）已于 <日期> 实施完成，本地验证通过、未提交；第二批（决定 1/2/3/7）待授权」；批准记录追加一条实施记录（含 3 个用户选择与执行范围）。
- [ ] 6.2 更新 `docs/DEVELOPMENT_BACKLOG.md` §5 的 Bug 2 条目：标记第一批为 `[x]`，保留第二批为 `[ ]` 并指向 ADR-0010。
- [ ] 6.3 更新 `docs/unverified-and-deferred.md` §C 的 2026-09-27 条目：把「零用例覆盖」中的**库外值不阻塞提交**一项改为「第一批已覆盖（用例清单）」，并保留前缀联想与三字段必填两项为未覆盖。
- [ ] 6.4 如实登记本批**未**取得的证据：本批**不做**页面人工实测（除非用户另行要求起服务）；若无人工实测，写明「仅有自动化证据」。

## 自查

- 需求映射：ADR-0010 决定 4（→Task 1/2/3/4）、决定 5（→Task 1/2/3）、决定 6 的"不加价"（→Task 2/5）与本批的"UI 提示"（→Task 4）均已落到任务；决定 1/2/3/7 与非目标一致地留待第二批。
- 无占位符：每个任务都给了确切文件、符号、行锚与命令。
- 无隐式授权：本批零迁移、零新依赖、零 Git 动作；需要越界的只有 Task 5.1 的夹具补 `semanticRole`（属测试夹具，不是产品代码）。
- 每个持久副作用都有回滚：本批**无**持久副作用（不改 schema、不写产品数据），回滚一律为"还原编辑"。
- 已知风险：**原判「既有断言需收窄」已被复核推翻**（两处夹具字段均无 `semanticRole`）⇒ Task 1.6 / 3.5 现在是**反向护栏**：它们必须保持绿；若转红，一律视为「豁免判定写宽了」的实现缺陷，改实现，**不允许**改这两条断言。ADR-0010 的验证证据段与 `unverified-and-deferred.md` §C 已同步更正。
- 契约影响：本批不改端点、不改请求/响应形状 ⇒ 不需 `pnpm openapi:generate`，生成物应保持零 diff（可作为额外的无契约变更证据）。

## 执行结果与偏差（2026-09-27，执行后补记）

**Task 1–4 已实施并通过验证；Task 5 部分实施；Task 6 已完成。** 完整实施记录（改动清单、收窄的断言、验证命令与结果）见 `docs/adr/0010-order-region-rank-mode-presets.md`「实施记录（第一批）」，此处只记本计划被推翻的判断与偏差：

- **命令修正（计划缺陷）**：本计划初稿全部写作 `pnpm --filter ./apps/api exec vitest run <包内相对路径>`，该写法在本仓（Turbo monorepo，包名 `@pw/api` / `@pw/mobile`）**不可用**；上文所有命令已改为 `cd "D:/pw system" && pnpm exec vitest run apps/...`（vitest 根在仓库根，路径相对仓库根）。
- **Task 5.1 已回退（计划判断被实测推翻）**：「已核实的关键事实」第 4 条称 `v1` 建模板接口**接受** `semanticRole`（依据 `domain/game-template.ts:43` 与控制器原样透传）——**实测不成立**。v1 建模板路由有严格 Zod 请求校验，带该键的 payload 返回 **400** `{"code":"ApiValidationError","fieldErrors":{"fields":["Unrecognized key: \"semanticRole\""]}}`；且 `game-template.service.ts` 的 `cleanFields` 不读该键、`prisma-game-template.repository.ts` 的 `createMany` 不写该列 ⇒ v1 字段恒为 DB 默认 `CUSTOM`，**Task 5.1 的 v1 集成用例不可达**。处理：把 `tests/integration/game-dispatch-flow.spec.ts` 完全还原到改前状态（已用 `git diff --stat -- <path>` 确认为空、复跑 5/5 绿），**不**写「v1 仍拒库外值」的护栏测试（那会把限制固化成预期行为，与 ADR 意图矛盾）。缺口登记于 `docs/unverified-and-deferred.md` §C，出路待用户决策（扩展 v1 契约 / 保留前瞻性代码 / 回退 Task 1 的 v1 部分）。
- **Task 4 偏差（混合式而非替换）**：计划要求豁免字段「走文本 Input 分支」（即替换掉 `:226-277` 的分段按钮组）；实际改为**保留预设分段按钮 + 追加一个自由文本 `Input`**。理由：纯文本会丢掉预设点选，相对现状是功能倒退，且与第二批的「可输入 + 候选列表」方向一致。提示文案为 `，可填写预设外的值；不在预设库中不影响提交，将按基础价。`
- **「既有断言不需要收窄」被推翻（自查章的风险条同样失效）**：计划与 ADR 声称两处既有断言（`order-values.spec.ts:124-135`、`game-template-values.spec.ts:61`）不需要收窄——**对它们自己成立**（夹具无 `semanticRole`，继续充当护栏），但由此推出的**一般结论不成立**：另有 **3 条**断言挂在真正的豁免角色夹具上，实施时转红，已按「把"未知选项被拒"的覆盖改挂到未豁免的 `CUSTOM` 字段」收窄（`game-template-calculations.spec.ts` 的 `target_rank: "unknown"` 与 `mode: "unknown"`、`game-template-order-draft.spec.ts:215` 的 `mode: "not-declared"`），无删除。
- **Task 5.2 的断言比计划更严**：除计划要求的 `priceAdjustmentFen === "0"` 外，实际用例还断言了 `document.plainText` 含「游戏模式：aram」（文案原样显示）与 `formValuesJson.mode === "aram"`（原样落库）。
- **未取得**：Task 5.3 计划要求「用例数 ≥ 改前基线 + 2」，实际只加了 **1** 条集成用例（另一条的落点即被回退的 5.1）。
- **证据缺口**：本批**只有自动化证据，无页面人工实测**。`pnpm test` 953 passed / 1 skipped（104 文件）、`pnpm test:integration` 315 passed（61 文件）、`pnpm test:tenant-isolation` 44 passed（12 文件）、`pnpm typecheck` 10/10 + `typecheck:tests`、`pnpm --filter @pw/mobile typecheck`、`pnpm build:h5`、`pnpm build:weapp`，全部退出码 0。**未做** Git 提交/推送（未授权）。

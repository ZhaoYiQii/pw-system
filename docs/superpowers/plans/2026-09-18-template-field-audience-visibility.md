# 模板字段端口可见性 Implementation Plan

Goal: 让模板里的字段/表格/说明可以标记"给客服看还是给客户看"，未标记的端口看不到也不记录；客服端与客户下单页各按自己的端口渲染。
Architecture: 配置是 JSON（零 DDL）。服务端按端口过滤后才返回数据（安全边界），前端只做呈现；三处渲染（客服表单、客户下单页、编辑器的两页预览）共用同一个**纯函数**决定"这个端口能看见什么"。
Tech stack: NestJS + Prisma（后端校验与过滤）；Next.js 16 + React 19（admin-web）；Taro 4 + React 18（mobile）；Vitest 3.2；Playwright。
Spec: `docs/specs/模板字段端口可见性-设计规格-v0.1.md`
Scope：端口矩阵只有 **客服 / 客户**；组件与分组都带标记，组件可覆盖分组；默认两个全选；历史模板与历史订单不受影响。
Non-goals：陪玩端与老板端的字段渲染面；算价模型；发布设置屏；删除 v1 死代码 `TemplateFormRenderer`。
Permission gates：写仓库文件；**`pnpm openapi:generate`（P1：会改写受版本管理的 openapi.yaml/json 与 packages/api-client）**；启动本地服务跑 E2E；提交/推送/部署。
Completion evidence：typecheck 0（api + admin-web + mobile）、相关集成/契约测试全绿、E2E 新增三条全绿、视觉快照更新、lint/format 0。

## 1. 事实基线（已核实）

| 事实                                                      | 位置                                                                                         |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 草稿与发布版本都是 JSON                                   | `game_dispatch_templates.draft_config_json`、`game_dispatch_template_versions.config_json`   |
| zod schema 逐字段声明、无 `strict()` → 未声明键被静默剥离 | `apps/api/src/common/validation/api-validation-rules.ts`                                     |
| 领域校验入口                                              | `validateDraftConfigV2()` 在 `game-dispatch/domain/game-template-config-v2.ts`               |
| 客服端渲染                                                | `new-order-view.tsx` → `TemplateOrderForm`（`config: DraftConfigV2`）                        |
| 客户端渲染                                                | `apps/mobile/src/pages/customer/game-order/index.tsx`（读 `field.fieldKey` 拼 `formValues`） |
| 编辑器预览                                                | `template-editor-content.tsx` → `TemplateDraftRenderer`（已有 `numberOf` 等可选 props）      |
| 共享布局纯函数                                            | `form-layout.ts` 的 `layoutV2Rows`                                                           |

## 2. Task 1 共享过滤纯函数（前端）

Files: `apps/admin-web/app/_lib/merchant-console/template-editor-meta.ts`（扩展）、其 spec。

- [x] 定义 `type TemplateAudience = "CS" | "CUSTOMER"`、`ALL_AUDIENCES`、`DEFAULT_AUDIENCES = ALL_AUDIENCES`。
- [x] 纯函数 `audiencesOf(component, section): TemplateAudience[]`：组件显式声明则用它；否则用分组的；都没有则 `ALL_AUDIENCES`（V-8）。
- [x] 纯函数 `visibleForAudience(config, audience)`：返回过滤后的 sections/components（装箱仍交给 `layoutV2Rows`，本函数只决定可见性）。
- [x] 纯函数 `describeAudiences(list)`：给行标签用（如「客服」「客户」「客服·客户」）。
- [x] 先写失败用例：默认全选、组件覆盖分组、历史模板回落、只给客服时客户侧取不到、必填不因可见性变化（V-10）。

Focused verification（2026-09-18 本轮复跑）：`vitest run apps/admin-web/app/_lib/merchant-console` → **19 文件 / 150 用例全绿**
（其中 `template-editor-meta.spec.ts` 27 用例）。

## 3. Task 2 后端校验与落地

Files: `apps/api/src/common/validation/api-validation-rules.ts`、`apps/api/src/modules/game-dispatch/domain/game-template-config-v2.ts`、`apps/api/src/openapi/schemas.ts`、相关集成测试。

- [x] zod schema 为组件与分组增加 `audiences`（枚举数组，去重后长度 ≥ 1；缺省允许）。
- [x] `validateDraftConfigV2` 增加对应校验与**受控错误路径**（沿用现有 issue 结构）。
- [x] `openapi/schemas.ts` 增加该属性（加性）。
- [x] 写失败集成用例：空数组 → 400；合法数组 → 保存并发布成功；未提供 → 仍成功且行为不变。
- [x] **P1 已单独授权**并执行 `corepack pnpm openapi:generate`；补 `tests/contract/game-dispatch-template-v2.spec.ts` 的 `audiences` 断言（契约 4 文件 / 19 用例全绿）。
- [~] 发布时把"解析后的 audiences"（继承结果）显式写进 `config_json`：**未按字面实现，见下方偏差 1**。

Focused verification（本轮实测，全部 0）：`tsc --noEmit -p apps/api/tsconfig.json`、
`vitest run apps/api`（17 文件 / 73 用例）、
`vitest run --config tests/vitest.integration.config.ts tests/integration/game-dispatch-template-v2.spec.ts`（27 用例）、
`vitest run --config tests/vitest.contract.config.ts`（4 文件 / 19 用例）、eslint / prettier（本次 6 个文件）。

### Task 2 偏差 1：不在发布快照里补全 `audiences`（阻塞待用户裁定）

规格 §4.4 要求"发布版本必须显式落地解析后的 audiences"。按字面实现会让发布版本与草稿不再逐字节相等，
直接打破两条既有锁定用例：

1. `tests/integration/game-dispatch-template-v2.spec.ts` → "publish：客户端 rendererVersion/config 被 API 边界拒绝，发布只读服务器草稿"
   断言 `published.components` / `published.staffingSource` 与草稿完全相等（草稿未声明时会被补出 `audiences`）。
2. 同文件的 publish 用例断言发布后 `hasUnpublishedChanges === false`；补全会让草稿（缺省）与版本（显式）判为不同，
   模板列表会把刚发布的模板显示成"有未发布改动"。

本轮的替代实现：继承解析下沉为纯函数 `resolveAudiencesV2()`（`game-template-config-v2.ts`），
发布快照保持"草稿原样"，由读取路径（Task 3）在过滤前解析。语义等价（区块与组件的声明都在同一份不可变快照里），
且不引入上述回归。若用户裁定必须字面落地，改动点只有 `game-template-service.ts` 的 `buildPublishedConfig()`，
同时需要一并决定 1、2 两条用例的新期望值。

### Task 2 副作用 1：OpenAPI 重生成把「判别联合内联体」一并换成 `$ref`

`apps/api/scripts/generate-openapi.mjs` 在本工作树里本就带着未提交改动（执行时打印
`discriminated unions normalized: 20 (hoisted components: 6)`），而受版本管理的 `openapi.yaml` /
`openapi.json` / `packages/api-client` 是更早生成的。本次重生成除加入 `audiences`（yaml / json /
types.gen.ts 各 13 处）外，还把多处内联 `type: object` 归一成 `$ref: '#/components/schemas/Template*V2'`
（yaml 增 60 个 `$ref`、删 120 处内联 `type: object`）。

净差异 4 个文件 +2205 / −10961；连跑两次数字完全一致（生成稳定）。契约 19 用例全绿、api-client typecheck 0，
说明是归一化而非契约语义变化，但它把一大块机械重排混进了本切片，提交时应单独说明或单独成一个提交。

### Task 2 已知遗留（不是本轮引入）

`tests/contract/game-dispatch-template-v2.spec.ts:256` 有工作树里既有的
`@typescript-eslint/no-explicit-any` 错误（`Record<string, Record<string, any>>`；HEAD 版本没有这一行，
本轮也没碰它），因此该文件 eslint 不为 0，本轮只对它跑了 prettier。修它需要把那处属性访问改成显式类型，属对方切片。

## 4. Task 3 按端口过滤的读取路径（后端）

- [x] 客户读路径：客户自查订单（`GET /game-dispatch/customer/orders/:orderId/select`）返回的 `formValues`
      与 `document` 按 CUSTOMER 过滤（`game-dispatch.service.ts` 的 `view(tenantId, orderId, audience)`）。
- [x] 下单写入：`buildTemplateOrderDraftForAudience(config, values, "CS")` 丢弃不可见字段的值（丢弃而非报错，
      未知键仍走既有 422），并把过滤后的值交给仓储落库；服务端补一条受控事件 `template.field_values_dropped`（只含条数）。
- [x] 客服端读路径：`GET versions/:versionId/form` 与订单详情（`GET orders/:orderId`）按 CS 过滤。
- [x] 集成测试：客户自查不含 CS-only 字段与文案；客服提交含 CUSTOMER-only（且必填）字段 → 值未落库、必填不拦、事件发出。

Focused verification（本轮实测，全部 0）：`tsc --noEmit -p apps/api/tsconfig.json`、
`vitest run apps/api`（18 文件 / 82 用例）、
`vitest run --config tests/vitest.integration.config.ts`（order + v2 + flow 三文件 / 46 用例）、
eslint / prettier（本次 12 个文件）。

### Task 3 事实基线更正：客户侧 v2「下单页」不存在（需另行立项）

计划与规格 §5.3 假设"客户端（H5 下单）读取模板/发布快照并按 CUSTOMER 过滤"，但代码里没有这条路径：

- 客户下单页读的是 **v1** 模板字段与岗位：`apps/mobile/src/pages/customer/game-order/index.tsx:68,126,158`
  → `customer/templates`、`customer/orders`。
- 服务端客户侧模板接口同样是 v1 表：`game-dispatch.service.ts` 的 `customerTemplates` / `customerTemplate`
  读 `gameDispatchTemplateField` / `gameDispatchPosition`。
- v2 的写入方只有客服：`POST /game-dispatch/template-orders`（`gameDispatch.manage`）。
- 客户能读到的 v2 数据只有**订单快照**：移动端订单详情调 `customer/orders/:orderId/select`，渲染 `formValues` + `document`。

因此本 Task 把"客户侧只返回 CUSTOMER 可见"落在**客户自查订单**这条真实读路径上；"客户端能看/能填哪些字段"
必须等 v2 客户下单面（新接口 + 移动端改造）立项——Task 5 的"客户端（H5 下单页）各自按端口渲染"同样依赖它。
另注：派单模板的**写入方端口**固定为 CS（`TEMPLATE_ORDER_WRITER_AUDIENCE`），客户 v2 下单面出现时应传 CUSTOMER 并各自校验必填（V-10）。

### 运行环境提示（不是代码问题）

`tests/integration/game-dispatch-flow.spec.ts` 的"上传档位证据"用例在沙箱内必定失败：
`EPERM: operation not permitted, mkdir 'D:\pw system\data\evidence\<tenantId>'`。
该用例与端口可见性无关（证据上传写本地文件），无沙箱复跑三文件 46 用例全绿。

## 5. Task 4 编辑器 UI

Files: `template-editor-content.tsx`、`template-editor-meta.ts`、`merchant-console.css`。

- [x] 字段/表格/说明的属性面板加两个开关：`客服` / `客户`（默认都开）。
- [x] 分组头加同样的两个开关；组件继承时显示「跟随分组」提示，改了就显示覆盖标记（并可一键回到跟随）。
- [x] 行内显示小标签（如「客服·客户」），沿用行内既有 chip 尺寸与调色板。
- [x] 校验：两个都不勾被三道防线挡住（见下方解释）。

Focused verification（本轮实测，全部 0）：`@pw/admin-web` typecheck（沙箱内需 `--incremental false`，否则 tsbuildinfo 触发 EPERM）、
`@pw/admin-web` build（无沙箱执行，路由表正常输出）、
`vitest run apps/admin-web/app/_lib/merchant-console`（**19 文件 / 157 用例**，新增 7 条：模型补丁 5 + 校验 2）、
eslint / prettier（本次 6 个前端文件）。

### Task 4 实施说明（三处需要解释的判断）

1. **端口可见性的最小原语下沉到模型层。** `TemplateAudience` / `ALL_AUDIENCES` / `DEFAULT_AUDIENCES` /
   `sanitizeAudiences` 现在定义在 `template-draft-state.ts`（模型），`template-editor-meta.ts` 原样转出，
   Task 1 已有的引用面（含 spec）不变；这样模型不必反向依赖视图层。
2. **"默认两个全选"用「不写声明」实现。** 新建内容不预写 `audiences`：区块没有上层的默认即两个全选（V-4），
   组件则优先继承分组——否则在"只给客服"的分组里新建字段会意外对客户可见。行为与 V-4 一致，存储更省。
3. **"两个都不勾"的三道防线**（V-2）：界面把最后一个开着的开关锁住（点不动，`aria-disabled` + tooltip）→
   模型 `applyAudiences` 对空数组/非法元素保持原状 → `collectDraftIssues` 对空数组给出问题（拦发布，覆盖脏数据与历史草稿）；
   后端 `zod` 的 400 仍是最终兜底。

### Task 4 环境限制（不是设计选择）

`merchant-console.css` 不在本轮可写路径内：apply_patch 对 `apps/admin-web/app/` 下的**任何**文件（新建也）都报
`path contains a reparse point`，而实际属性里没有 reparse point。因此新控件的样式改用与行内 chip 相同的
Tailwind 工具类写在组件里（`aria-pressed:` / `group-aria-pressed:` 变体），没有新增 CSS 文件、也没动 `merchant-console.css`。
若 Task 5 要把它们收敛成 `.mc-*` 类，需要先能写该路径（提权命令或换工具）。

⚠️ Task 5 注意：行内 chip 与分组开关会改变编辑器外观，**既有像素级视觉快照基线必然失效**，需要重新生成。

## 6. Task 5 渲染弹层两页 + 两端渲染 + 门禁

- [x] 渲染弹层改两页（客服 / 客户），默认客服（V-11），点选 / 左右滑动 / 左右方向键切换；两页都调用
      `visibleForAudience`（V-7），标题旁提示「N 项内容这个端口看不到」。
- [~] 客服端（新建派单）：由 Task 3 的服务端过滤承担——表单只收到 CS 可见字段，因此不存在对不可见字段的必填校验（V-10）。
  **客户端（H5 下单页）本版做不到**：v2 客户下单面不存在（见 Task 3 事实基线更正、验收记录 §5.2）。
- [x] E2E 三条（2026-09-19 跑通）：分组开关默认两个都开 → 组件覆盖分组后行内标签变「客户」 → 客服页看不到该内容、
      提示「1 项内容这个端口看不到」 → 切客户页两页内容不同 → 方向键切回。证据：`playwright -g "S3"` 3 passed，
      紧跟一次不带 `--update-snapshots` 的复跑同样 3 passed；另跑 `-g "S4 新建派单"` 3 passed（客服端表单无回归）。
- [x] 视觉快照基线：`template-editor-*.png` 重新生成；弹层拆成 `template-render-dialog-cs-*.png` 与
      `template-render-dialog-customer-*.png` 两页各一张，旧 `template-render-dialog-*.png` 已删除。
- [x] 门禁：`@pw/api`、`@pw/admin-web`、`@pw/mobile` typecheck 0；api / admin 单测、契约、集成、租户隔离、关键路径套件全绿；
      eslint / prettier 0。
- [x] 验收记录 `docs/acceptance/2026-09-18-template-field-audience-visibility.md` 已更新。

剩余一步：**E2E 三条 + 视觉基线重生成**（要起本地 API 与 admin dev server，属独立动作，需单独确认）。

## 7. 追加（2026-09-19）：两条产品规则的修复

背景：端口过滤让"值类内容被标成对客服不可见"变成两个隐患——带加价的选择字段会让客服下单**静默少算**，
普通字段则是**任何界面都填不了**（v2 只有客服能下单）。

规则（一条覆盖两处）：**值类内容（字段 / 可重复表格）必须留给"能填写下单"的端口**——目前只有客服；
说明类（NOTE）只影响预览，允许只给客户看。客户侧下单面立项后把 CUSTOMER 加进
`TEMPLATE_WRITABLE_AUDIENCES_V2` 即可自动放宽。

- 发布期阻断：`collectPublishBlockingIssuesV2`（服务端权威，**只挡发布**，不影响已发布版本读取与历史订单——
  最初的实现误把它塞进 `validatePublishedConfigV2`，会让历史版本被判"版本不可用"，已拆开）。
- 运行期兜底：`buildTemplateOrderDraftForAudience` 遇到"参与算价/人数却对该端口不可见"的历史版本直接 422，
  文案点名具体内容，不再静默丢值；普通不可见字段仍按 V-5 丢弃并记事件。
- 前端同步：`collectDraftIssues` 给出同一条规则的问题（**只提示**；`canPublish` 不看问题数，真正拦发布的是服务端），编辑器面板再加一句原因提示。
- 证据：领域 8 文件 / 69 用例、admin 19 文件 / 160 用例、定向集成 43 用例、api+admin typecheck 0、eslint/prettier 0。
  红证据：关掉运行期兜底后"宁可报错也不静默少算"用例红、误导性 `TEMPLATE_BINDING_INVALID` 复现；
  整段跳过发布规则时两条"发布拒绝"用例红。
- 连带调整：`tests/integration/game-dispatch-template-order.spec.ts` 的端口用例改为"先正常发布、再直接改写版本快照"，
  模拟规则上线前发布的历史版本（现行规则下这种配置已无法发布）。

## 7. 执行顺序与权限

Task 1 → 2 → 3 → 4 → 5 串行（2 与 3 依赖 1 的类型；5 依赖 4）。**任何提交/推送/部署、以及 `openapi:generate`，都需届时单独授权。**

## 8. 自检

- 规格 V-1 至 V-11 全部映射到 Task 1–5；非目标在 header 列明。
- 无 TBD；引用的文件、函数、表列均已在仓库核实。
- 每个 Task 有聚焦验证；零 DDL；回滚 = 前端回退 + 后端忽略新属性。

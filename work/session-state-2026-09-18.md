# 会话状态与交接（2026-09-18）

## 一句话现状

「派单模板·内容设计」已完成并合并进 master；当前在做**模板字段端口可见性**：Task 1（前端纯函数）、
Task 2（后端校验 + OpenAPI 重生成 + 契约断言）、Task 3（服务端按端口过滤读写）、Task 4（编辑器端口开关与标签）、
Task 5（渲染弹层两页 + E2E + 视觉基线）均已完成未提交。用户已裁定：Task 2 偏差 1 按「不补全发布快照」实现、
OpenAPI 重生成产物保留。**Task 1–5 全部做完，状态 locally-verified**（唯一未覆盖：客户侧 H5 v2 下单面不存在）。
**下一步：等用户决定是否把这两个未提交切片提交/推送**（提交属独立授权动作）。

## 已完成并合并

- 提交 `9e0d8d2`：内容设计原语化重写、客户视角「渲染」弹层、模板列表可隐藏、视觉对齐原型、像素级视觉回归基线。**已快进合并到 `origin/master`**（`9296508..9e0d8d2`）。
- E2E 全套 **17/17**（起点 10/17）。
- 已取消「业务绑定与计算」屏与字段级「用于算价」，删除 `template-editor-binding.tsx`。

## 进行中：模板字段端口可见性

- 规格：`docs/specs/模板字段端口可见性-设计规格-v0.1.md`（决策 V-1 至 V-11 已定稿）
- 计划：`docs/superpowers/plans/2026-09-18-template-field-audience-visibility.md`（5 个 Task）
- **Task 1 已完成（未提交）**：`template-editor-meta.ts` 新增 `TemplateAudience` / `ALL_AUDIENCES` / `DEFAULT_AUDIENCES` / `sanitizeAudiences` / `audiencesOf` / `canSee` / `visibleForAudience` / `describeAudiences`；spec 新增 8 个用例。证据：19 文件 / **150 用例全绿**、typecheck 0、eslint 0、prettier 0。
- **Task 2 已完成（未提交）**：`api-validation-rules.ts`（3 个组件 + 分组加 `audiences`，`.refine(去重后 ≥ 1)`）、
  `game-template-config-v2.ts`（`validAudiences` / `resolveAudiencesV2` + 组件与分组两条 `TEMPLATE_COMPONENT_INVALID` 路径）、
  `openapi/schemas.ts`、`tests/contract/game-dispatch-template-v2.spec.ts`、集成用例 2 条。
  证据：api typecheck 0、api 单测 17 文件 / 73 用例、集成 27 用例、契约 4 文件 / 19 用例、eslint + prettier 0（除下方遗留）。
- ⚠️ **Task 2 偏差 1（需用户裁定）**：规格 §4.4「发布版本显式落地解析后的 audiences」未按字面实现——那会打破
  "发布快照 = 草稿原样" 与 "发布后 `hasUnpublishedChanges === false`" 两条既有锁定用例。改为把继承解析放进
  `resolveAudiencesV2()`，由 Task 3 的读取路径在过滤前解析。详见计划文件 §3「Task 2 偏差 1」。
- ✅ **P1 已授权并执行**：`corepack pnpm openapi:generate` 两轮幂等；`audiences` 落入 yaml / json / types.gen.ts（各 13 处）。
  ⚠️ 该命令同时还把内联判别联合归一成 `$ref`（`openapi.yaml` 增 60 `$ref` / 删 120 处内联对象，4 文件 +2205 / −10961）——
  这是工作树里 `apps/api/scripts/generate-openapi.mjs` 既有改动的补生成，提交时应单独说明。
- ⚠️ **必须同批上线**：后端 `z.strictObject` 对未知键是**直接拒绝**（不是静默丢弃）→ 前端发 `audiences` 而后端未改 schema 会 400。
  顺序：先后端，再前端。本轮已用"临时撤掉 zod 改动 → 集成用例红（`Unrecognized key: "audiences"`）"实证过。
- **Task 3 已完成（未提交）**：服务端按端口过滤落了三条读写路径——①客服读发布表单 `versions/:id/form`；
  ②客服读订单详情 `GET game-dispatch/orders/:id`；③客户自查订单 `customer/orders/:id/select`（`formValues` + `document`）。
  下单写入丢弃该端口看不见的字段值（未知键仍 422），落库的是过滤后的值。新增领域纯函数 `visibleComponentsV2` /
  `visibleConfigV2` / `partitionValuesV2`（`game-template-config-v2.ts`）与 `buildTemplateOrderDraftForAudience`
  （`game-template-order-draft.ts`）；受控事件 `template.field_values_dropped`（只记条数，不带键与值）。
  证据：api typecheck 0、api 单测 18 文件 / 82 用例、集成三文件 46 用例、eslint + prettier 0。
- ⚠️ **Task 3 事实更正**：客户侧 v2**下单页不存在**（H5 `customer/game-order` 仍读 v1 `fields`/`positions`），
  所以「客户只返回 CUSTOMER 可见」落在**客户自查订单**这条既有读路径上；「客户端能看/能填哪些字段」要等 v2 客户下单面
  另行立项（Task 5 的客户侧渲染同样依赖它）。写入方端口当前固定为 CS（`TEMPLATE_ORDER_WRITER_AUDIENCE`）。
- **Task 4 已完成（未提交）**：编辑器里区块头与组件属性面板都有「客服 / 客户」开关，行内显示「客服·客户」小标签
  （组件单独声明时用主色标出）；组件未声明时提示「跟随分组」并可一键回到跟随。模型层新增
  `TemplateAudience` / `ALL_AUDIENCES` / `DEFAULT_AUDIENCES` / `sanitizeAudiences` 与 `applyAudiences`（区块与组件补丁），
  校验层对空标记出问题。证据：admin-web typecheck 0、build 0、`merchant-console` 19 文件 / 157 用例、eslint + prettier 0。
- ⚠️ **Task 4 环境限制**：apply_patch 对 `apps/admin-web/app/` 下任何文件（含新建）都报 reparse point，
  所以 `merchant-console.css` 未改；新控件样式用与行内 chip 相同的 Tailwind 工具类写在组件里。
- ⚠️ **Task 5 必做**：编辑器外观变了（新增行内标签与分组开关），像素级视觉快照基线会失效，需要重新生成。
- **Task 5 已完成的部分**：渲染弹层改成两页（客服 / 客户），默认客服（V-11），点选 / 左右滑动 / 左右方向键切换，
  两页都调 `visibleForAudience`，标题旁提示「N 项内容这个端口看不到」。验收记录见
  `docs/acceptance/2026-09-18-template-field-audience-visibility.md`（状态：部分 locally-verified）。
- **Task 5 E2E 已完成（2026-09-19）**：`playwright test --project=admin tests/e2e/merchant-console-admin.spec.ts
  -g "S3"` → 3 passed（含端口可见性新断言），紧跟一次不带 `--update-snapshots` 的复跑 → 3 passed；
  `-g "S4 新建派单"` → 3 passed。夹具 = `work/s3-e2e-seed.mjs seed` / `work/s4-e2e-seed.mjs seed`
  （**注意：S3/S4 用例不需要 `scripts/seed-dev.mjs`**，它要平台库权限会 42501 失败）。
  快照：`template-editor` 重新生成，弹层拆成 `template-render-dialog-cs` / `-customer` 两页，旧的已删除。
- ⚠️ **本机服务现状（2026-09-19）**：3005 是昨天起的 admin dev（仍在跑，热更新生效）；3100 原本是昨天的**旧 API 构建**，
  已重建并重启为当前代码，**仍在运行**；3000 是无关的 wslrelay。夹具留在一次性库里未清理。
- **产品规则修复已完成（2026-09-19）**：值类内容（字段/表格）必须留给能填写下单的端口（目前只有客服），
  说明类允许只给客户看。发布期由服务端 `collectPublishBlockingIssuesV2` 阻断（**只挡发布**，不影响历史版本读取——
  一开始误写进 `validatePublishedConfigV2` 会让历史版本变"不可用"，已拆开）；运行期
  `buildTemplateOrderDraftForAudience` 对"参与算价/人数却不可见"的历史版本直接 422，不再静默少算；前端
  `collectDraftIssues` + 编辑器面板同步提示。证据：领域 69 用例、admin 160 用例、集成 43 用例、typecheck/lint/format 全 0。
  连带把 `tests/integration/game-dispatch-template-order.spec.ts` 的端口用例改成"先发布再改写版本快照"以模拟历史版本。
- **第③条降级点已修（2026-09-19）**：订单快照解析失败时，客户侧改为返回空值（宁可少给），客服侧保留原值便于排查；
  集成用例新增「快照损坏时：客户侧宁可少给，客服侧保留原值以便排查」→ 该文件 16 passed。三条产品问题全部闭环。
- ⚠️ **提交受阻（需要用户定）**：本特性的改动有 6–8 个文件**同时带着其它工作流的未提交改动**
  （`game-dispatch-template-order.service.ts`、`game-dispatch.service.ts`、`generic-game-template.service.ts`、
  `interface/game-dispatch.controller.ts`、`application/game-template-observability.ts`、
  `tests/integration/game-dispatch-template-{order,v2}.spec.ts`、`tests/contract/game-dispatch-template-v2.spec.ts`、
  `openapi.{yaml,json}` + `packages/api-client/src/*`），所以"只提交本特性"在**文件粒度**上做不到，
  需要先提交那些 WIP、或接受混合提交、或用 hunk 级补丁交付。
- ⚠️ **写盘限制**：apply_patch 对 `apps/admin-web/app/` 与 `docs/acceptance/` 下的文件会报 reparse point（实际没有），
  本轮这两处分别改用组件内 Tailwind 类与一次提权写入解决；后续再动这两个目录需要同样的处理。

## 未提交的改动（别当垃圾清掉）

| 路径 | 说明 |
| --- | --- |
| `apps/admin-web/app/_lib/merchant-console/template-editor-meta.ts` 与 `.spec.ts` | Task 1 的端口可见性纯函数与用例 |
| `apps/api/src/common/validation/api-validation-rules.ts` | Task 2：zod 边界接受并校验 `audiences` |
| `apps/api/src/modules/game-dispatch/domain/game-template-config-v2.ts` 与 `.spec.ts` | Task 2：领域校验 + `resolveAudiencesV2()` 与 8 个新用例 |
| `apps/api/src/openapi/schemas.ts`、`tests/contract/game-dispatch-template-v2.spec.ts` | Task 2：契约属性与断言 |
| `tests/integration/game-dispatch-template-v2.spec.ts` | Task 2：2 条新集成用例（边界 400 / 保存发布原样落地） |
| `apps/api/src/modules/game-dispatch/domain/game-template-config-v2.ts`（Task 3 追加）、`game-template-order-draft.ts` 与两个 `.spec.ts` | Task 3：端口过滤纯函数 + 写入编排与用例 |
| `apps/api/src/modules/game-dispatch/application/{game-dispatch.service.ts,generic-game-template.service.ts,game-dispatch-template-order.service.ts(+新 spec),game-template-observability.ts}` | Task 3：三条读写路径按端口过滤 + 受控事件 |
| `apps/api/src/modules/game-dispatch/{infrastructure/prisma-game-dispatch-template-order.repository.ts,interface/game-dispatch.controller.ts}` | Task 3：落库过滤后的值、订单详情传 CS 端口 |
| `tests/integration/game-dispatch-template-order.spec.ts` | Task 3：客户自查 / 写入丢值的集成用例 + 客户账号夹具 |
| `apps/admin-web/app/_lib/merchant-console/template-draft-state.ts`、`template-editor-meta.ts`、`template-editor-content.tsx`、`template-binding.ts`（+两个 `.spec.ts`） | Task 4：端口开关、行内标签、模型与校验补丁 |
| `docs/specs/模板字段端口可见性-设计规格-v0.1.md`、`docs/superpowers/plans/2026-09-18-template-field-audience-visibility.md` | 本次规格与计划 |
| `work/s3-e2e-seed.mjs`、`work/s4-e2e-seed.mjs` | 已摘掉会删门店的 `clean` 并加拒绝闸；**两文件里还有用户既有改动，勿混提** |
| `work/session-state-2026-09-18.md` | 本文件 |
| `openapi.yaml`、`openapi.json`、`packages/api-client/src/*` | P1 已授权的重生成产物（含大量 `$ref` 归一化） |

## 已确认的产品决策（不得回退）

1. 只给原语，不给预设；不替店主决定表单里有什么。
2. 派单模板只负责「客服填什么」，**不管钱**。
3. 恢复 = 写回草稿，**线上不变**。
4. 算价模型（归属报名/结算，待立项）：格子由店主定；**单价与时长由陪玩报名时自己填**；人数 = 最终确认报名数；总价 = 每条确认报名累加。
5. 端口可见性：本版只做**客服 / 客户**；默认两个全选；分组可设、字段可覆盖；**只有该端口能看到并填写**；可见性与必填无关（必填只在可见端口生效）；历史模板与历史订单不受影响。
6. 发布设置屏**按用户要求暂不动**，规格与计划已备好。

## 环境与命令

- 容器 `pw-saas-local`：postgres `5433` / redis `6380` / minio `9002`（另有无关项目 new-api-deploy 也在跑）。
- 站点 `http://localhost:3005`（**必须用 localhost**）；API `3100`。门店 `s3e2e`、`demo`，账号 `owner`，密码 `zcloud1024`。
- 一次性测试库只允许 `pw_saas_s2_task2_20260916`（禁止 `pw_saas`、`pw_saas_test`、`pw_shadow`）。
- E2E：`$env:ADMIN_ORIGIN='http://localhost:3005'`、`$env:E2E_TENANT_CODE='demo'`，再跑 `playwright test --project=admin tests/e2e/merchant-console-admin.spec.ts`。前置种子 = `scripts/seed-dev.mjs` **+** `scripts/seed-store-demo.mjs`。**`-g` 参数不能带竖线**（playwright.cmd 是 CMD 包装）。
- 夹具清理：两个 seed 脚本的 `clean` 已被禁用；要清模板请按门店 id 精确删，**别用 clean**（它会删整个门店，实测导致过登录失败）。

### 本机工具链实测（2026-09-18 本轮）

- `pnpm` 在本机 shell 是 **11.19.0 回退版**，会触发隐式 install 并在沙箱里 EPERM 失败；一律用 `corepack pnpm ...`（10.34.5，实测可用）。
- `corepack pnpm exec vitest ...` 在本机 shell 报 `'vitest' is not recognized`；改用 `node node_modules/vitest/vitest.mjs run ...`。
- 沙箱里 **node 子进程无法写 `D:\pw system`**（`prettier --write` 报 EPERM），写文件用 apply_patch，或对写产物的命令申请提权执行。
- 定向集成测试跑法（一次性库）：
  ```powershell
  $env:DATABASE_URL='postgresql://pw_runtime:pw_runtime_dev_only@127.0.0.1:5433/pw_saas_s2_task2_20260916?schema=public'
  $env:PLATFORM_DATABASE_URL='postgresql://pw:pw_dev_only@127.0.0.1:5433/pw_saas_s2_task2_20260916?schema=public'
  $env:PW_TEST_MIGRATION_URL='postgresql://pw:pw_dev_only@127.0.0.1:5433/pw_saas_s2_task2_20260916?schema=public'
  $env:PW_TEST_RUNTIME_URL='postgresql://pw_runtime:pw_runtime_dev_only@127.0.0.1:5433/pw_saas_s2_task2_20260916?schema=public'
  $env:PAYMENT_PROVIDER='mock'
  node node_modules/vitest/vitest.mjs run --config tests/vitest.integration.config.ts tests/integration/game-dispatch-template-v2.spec.ts
  ```

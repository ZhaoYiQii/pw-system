# 模板字段端口可见性 验收记录（2026-09-18 起执行，2026-09-19 补 E2E）

状态：**locally-verified**（本地代码 + 本地一次性测试库 + 真实本地 API 的 E2E 与像素级视觉基线；
未提交、未推送、未部署）。唯一未覆盖的是**客户侧 H5 下单面**——该面在 v2 里不存在（见 §5.2）。

依据：`docs/specs/模板字段端口可见性-设计规格-v0.1.md`（决策 V-1 至 V-11）、
`docs/superpowers/plans/2026-09-18-template-field-audience-visibility.md`。

## 1. 数据库与迁移

| 项目 | 事实 |
| --- | --- |
| schema 变化 | **无**（配置是 JSON，零 DDL） |
| 本轮是否执行迁移 | **否** |
| 使用的测试数据库 | `pw_saas_s2_task2_20260916`（本地 127.0.0.1:5433，一次性库） |
| 未访问 | `pw_saas`、`pw_saas_test`、`pw_shadow`、任何远程库 |
| 回滚 | 前端回退编辑器、后端忽略新属性；已发布版本仍可读（属性被旧代码忽略），无数据迁移 |

## 2. 契约变化

`TemplateSectionV2` / 三种组件的 schema 各加一个可选属性 `audiences: ("CS" | "CUSTOMER")[]`（minItems 1，缺省=继承）。
加性变更，已执行 `corepack pnpm openapi:generate` 重生成 `openapi.yaml` / `openapi.json` / `packages/api-client`。

注意：同一次重生成还把内联判别联合归一成 `$ref`（`openapi.yaml` 增 60 个 `$ref` / 删 120 处内联对象，4 文件 +2205 / −10961）：
这是工作树里 `apps/api/scripts/generate-openapi.mjs` 既有改动的补生成，连跑两次数字一致（生成稳定）。

## 3. 已交付行为

- **校验（服务端权威）**：`audiences` 必须是枚举数组、去重后至少一个，否则 400（zod 边界）；领域层对区块与组件各出一条
  `TEMPLATE_COMPONENT_INVALID`，路径 `$.sections[i].audiences` / `$.components[i].audiences`。缺省=继承，历史模板不受影响。
- **端口过滤（服务端权威）**：领域纯函数 `visibleComponentsV2` / `visibleConfigV2` / `partitionValuesV2`。
  - 客服读发布表单、客服读订单详情、客户自查订单（`formValues` + 自动文案）都按各自端口过滤；
  - 下单写入按写入方端口（当前固定 CS）丢弃不可见字段的值：不落库、不进文案、不参与必填校验，
    并留一条受控事件 `template.field_values_dropped`（只记条数，不含键与值）；配置里根本不存在的键仍走既有 422。
- **编辑器 UI**：区块头与组件属性面板各有「客服 / 客户」开关；行内显示端口标签（组件单独设置时用主色标出）；
  组件未声明时提示「跟随分组」并支持一键回到跟随；空标记被界面、模型、校验三层挡住。
- **渲染弹层**：两页（客服 / 客户），默认停在客服（V-11），支持点选、左右滑动与左右方向键切换；
  两页都调用同一个过滤纯函数（V-7），标题旁提示「N 项内容这个端口看不到」。

## 4. 证据（实测）

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `tsc --noEmit -p apps/api/tsconfig.json` | 0 | — |
| `vitest run apps/api` | 0 | 18 文件 / 82 用例（1 skip） |
| `vitest run --config tests/vitest.integration.config.ts`（order + template-v2 + flow） | 0 | 46 用例 |
| `vitest run --config tests/vitest.tenant-isolation.config.ts` | 0 | 11 文件 / 36 用例 |
| `vitest run --config tests/vitest.critical.config.ts` | 0 | 8 文件 / 24 用例（无沙箱执行） |
| `vitest run --config tests/vitest.contract.config.ts` | 0 | 4 文件 / 19 用例 |
| `vitest run apps/admin-web/app/_lib/merchant-console` | 0 | 19 文件 / 157 用例 |
| `tsc --noEmit -p apps/admin-web/tsconfig.json` / `apps/mobile/tsconfig.json` | 0 / 0 | 沙箱内需 `--incremental false` |
| `corepack pnpm --filter @pw/admin-web build` | 0 | Compiled successfully（无沙箱执行） |
| eslint / prettier（本轮改动文件） | 0 / 0 | — |
| `corepack pnpm openapi:generate`（P1 已单独授权） | 0 | 两轮幂等 |
| `playwright test --project=admin … -g "S3"`（夹具 `work/s3-e2e-seed.mjs`） | 0 | **3 passed**：含端口可见性三条新断言（分组默认两个都开 / 组件覆盖分组后行内标签变「客户」/ 客服页看不到该内容且提示「1 项内容这个端口看不到」/ 切客户页两页内容不同 / 方向键切回） |
| 同上，紧跟一次**不带** `--update-snapshots` 的复跑 | 0 | **3 passed**（证明新基线与当前渲染一致） |
| `playwright test --project=admin … -g "S4 新建派单"`（夹具 `work/s4-e2e-seed.mjs`） | 0 | **3 passed**（客服端表单按快照渲染无回归） |

视觉基线：`template-editor-admin-win32.png` 重新生成；弹层按两页拆成
`template-render-dialog-cs-admin-win32.png` 与 `template-render-dialog-customer-admin-win32.png`，
被取代的旧 `template-render-dialog-admin-win32.png` 已删除（可用 git 找回）。

红证据：Task 2 撤掉 zod 改动后集成用例报 `Unrecognized key: "audiences"`（证明前后端必须同批上线）；
Task 3 领域函数与写入编排不存在时共 7 条用例报 `not a function`；
Task 4 模型与校验未实现时 5 条用例失败（`audiences` 未生效、空标记未被判问题）。

## 5. 已知偏差与遗留

1. **规格 §4.4 未按字面实现**（用户已裁定）：发布快照不补全解析后的 `audiences`，改由读取路径解析。
   按字面实现会打破两条既有锁定用例（"发布快照=草稿原样"、发布后 `hasUnpublishedChanges === false`）。
2. **规格 §5.3 与代码不符**：客户侧 v2 下单面不存在（H5 仍读 v1 `fields`/`positions`），
   本版"客户只看得到 CUSTOMER 字段"落在**客户自查订单**这条既有读路径上，E2E 里由渲染弹层的客户页代表客户视角。
   "客户端能看/能填哪些字段"需要先立新切片（新接口 + 移动端改造）。
3. **新控件样式没进 `merchant-console.css`**：apply_patch 对 `apps/admin-web/app/` 下任何文件都报 reparse point，
   故用与行内 chip 相同的 Tailwind 工具类写在组件里。
4. **待修问题（产品规则）**：①带加价的选择字段若被标成对 CS 不可见，客服下单会**静默少算**那笔加价
   （人数来源被标不可见则是硬错，文案会误导）；②被标成"只给客户"的字段在 v2 里目前任何界面都填不了；
   ③订单快照解析失败时客户侧不做端口过滤（降级点）。
5. **`tests/` 不在任何 tsconfig 里**：本轮端口回调契约变更因此漏过一个测试替身（tenant-isolation 已修）。

## 6. 未验证 / 环境备注

- **客户侧 H5（Taro）**：本版未改 mobile 代码，v2 客户下单面不存在，未做真机/构建验证。
- **视觉基线是 Windows 本机生成**（文件名含 `-admin-win32`），与仓库既有基线口径一致；换到 Linux/CI 需重新生成。
- **本地服务状态**：3005 的 admin dev 是你昨天起的（热更新生效，未重启）；3100 的 API 原本是昨天的旧构建，
  本轮已重建并重启为当前代码，**仍在运行**；夹具留在一次性库 `pw_saas_s2_task2_20260916`（未清理）。
## 7. 2026-09-19 追加：两条产品规则的修复

背景：端口过滤让"值类内容被标成对客服不可见"变成两个隐患——带加价的选择字段会让客服下单**静默少算**，
普通字段则是**任何界面都填不了**（v2 只有客服能下单）。

规则（一条覆盖两处）：**值类内容（字段 / 可重复表格）必须留给"能填写下单"的端口**——目前只有客服；
说明类（NOTE）只影响预览，允许只给客户看。客户侧下单面立项后把 CUSTOMER 加进
`TEMPLATE_WRITABLE_AUDIENCES_V2` 即可自动放宽。

- 发布期阻断：`collectPublishBlockingIssuesV2`（服务端权威，**只挡发布**；不影响已发布版本的读取与历史订单）。
- 运行期兜底：`buildTemplateOrderDraftForAudience` 遇到"参与算价/人数却对该端口不可见"的历史版本直接 422，
  文案点名具体内容；普通的不可见字段仍按 V-5 丢弃并记受控事件。
- 前端同步：`collectDraftIssues` 给出同一条规则的问题（**只提示**；`canPublish` 不看问题数，真正拦发布的是服务端），编辑器面板再加一句原因提示。
- 证据：领域 8 文件 / 69 用例、admin 19 文件 / 160 用例、定向集成 2 文件 / 43 用例、api + admin typecheck 0、
  eslint / prettier 0。
- 红证据（修复前）：关掉运行期兜底后"宁可报错也不静默少算"用例红（根本没抛错）、"人数来源不可见"报的是误导性的
  `TEMPLATE_BINDING_INVALID`；整段跳过发布规则时两条"发布拒绝"用例红。
- 连带调整：`tests/integration/game-dispatch-template-order.spec.ts` 的端口用例改为"先正常发布、再直接改写版本快照"，
  模拟规则上线前发布的历史版本（现行规则下这种配置已无法发布）。

至此 §5.4 的①与②已修。

## 8. 2026-09-19 追加：第③条降级点已修

订单快照配置解析失败时（`orderSnapshotView` 的 `config === null` 分支）无法判定端口可见性，原先对**客户侧**原样返回
全部 `formValues`（V-6 的漏洞）。现改为：

- **客户侧**：返回空值 + `document: null`（宁可少给），并照旧留 `template.document_failed` 事件。
- **客服侧**：保留原值便于排查（自己门店的数据），`document` 同样降级为 `null`。

证据：`tests/integration/game-dispatch-template-order.spec.ts` → 16 passed，其中新增
「快照损坏时：客户侧宁可少给，客服侧保留原值以便排查」；
api typecheck 0、eslint / prettier 0。§5.4 的三条产品问题至此全部闭环。

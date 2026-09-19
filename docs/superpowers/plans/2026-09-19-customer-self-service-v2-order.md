# 客户自助下单（v2）Implementation Plan

Goal: 让客户在 H5 上自助选游戏/模板并下单，全程只接触 CUSTOMER 端口可见的内容；客服在商家端看到同一张单。
Architecture: 客户侧与商家侧是**两个独立入口**，端口由入口决定（C-9）。新增三个客户侧只读/写入路由，复用同一套领域编排
（`buildTemplateOrderDraftForAudience`）：服务端按 CUSTOMER 过滤配置、丢弃不可见值、算人数/加价/文案、写订单快照与幂等记录。
规则层把"可写入端口"扩到两个，并新增"参与算价/人数的内容必须对每个可写端口可见"的发布期约束。
Tech stack: NestJS 12 + Prisma 7（API）、Next.js 16 + React 19（admin-web）、Taro 4 + React 18（mobile H5/weapp）、Vitest 3.2、Playwright 1.63。
Spec: `docs/superpowers/specs/2026-09-19-customer-self-service-v2-order-design.md`
Scope：C-1 至 C-11；只做"客户自助下单 + 客服能看到该单"。
Non-goals：客服在已建订单上补填字段值（C-10 的后半，另立小切片）、两段填写的锁单与合并、算价模型（归属报名/结算）、
陪玩端与老板端渲染面、货币/结算口径变更。
Permission gates：写仓库文件；启动本地服务与向一次性库 `pw_saas_s2_task2_20260916` 写夹具；`pnpm openapi:generate`（P1，需单独授权）；
提交/推送/部署（各自独立授权）。
Completion evidence：api/admin/mobile typecheck 0；新增/相关单测、集成、契约全绿；E2E（admin 项目 + H5 冒烟）；
eslint / prettier 0；验收记录一节。

## 1. 事实基线（已核实）

| 事实                                   | 位置                                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 客户侧目前只有 v1 下单接口与页面       | `game-dispatch.controller.ts` 的 `customer/*`；`apps/mobile/src/pages/customer/game-order/index.tsx`                                       |
| v2 下单只由客服发起，写入端口写死为 CS | `game-dispatch-template-order.controller.ts`；`game-dispatch-template-order.service.ts` 的 `TEMPLATE_ORDER_WRITER_AUDIENCE`                |
| 端口编排已经是参数化的纯函数           | `game-template-order-draft.ts` 的 `buildTemplateOrderDraftForAudience(config, values, audience)`                                           |
| 端口规则现状                           | `game-template-config-v2.ts`：`TEMPLATE_WRITABLE_AUDIENCES_V2 = ["CS"]`、`collectPublishBlockingIssuesV2`、`billingComponentsHiddenFromV2` |
| 前端对应规则                           | `apps/admin-web/.../template-draft-state.ts`（`WRITABLE_AUDIENCES`）、`template-binding.ts`（`collectDraftIssues`）                        |
| 幂等机制                               | `prisma-game-dispatch-template-order.repository.ts` 的 `IDEMPOTENCY_OPERATION` + 唯一索引 `[tenantId, idempotencyKey, operation]`          |
| 端口可见性特性已上线                   | 提交 `8e7067e`、`9eaa4cb`（同分支）                                                                                                        |

## 2. Task 1 规则层：可写入端口扩到两个 + 发布期收紧（C-3 / C-4）

Files: `apps/api/src/modules/game-dispatch/domain/game-template-config-v2.ts`、其 `.spec.ts`、
`apps/admin-web/app/_lib/merchant-console/{template-draft-state.ts,template-binding.ts}` 与两个 `.spec.ts`。

- [ ] 失败用例先行（api）：把 `TEMPLATE_WRITABLE_AUDIENCES_V2` 断言为 `["CS","CUSTOMER"]`；新增用例——带加价的选项字段只给客服可见时，
      `collectPublishBlockingIssuesV2` 报错并点名该内容；人数来源只给客户可见时同样报错；两者都对两端可见时放行。
- [ ] 实现：常量改为两个端口；新增"参与算价/人数的内容必须对**每个**可写端口可见"的发布期阻断项（复用 `billingComponentsV2`）。
- [ ] 失败用例先行（admin）：`collectDraftIssues` 对"CS-only 且带加价的字段"与"只给客户的人数来源"给出问题；
      普通值类内容只给客户（客服仍可填）**不再**报问题（C-3 放宽）。
- [ ] 实现：`WRITABLE_AUDIENCES = ["CS","CUSTOMER"]`；`valueComponentsOutsideAudiences` 保持"至少一个可写端口"；
      另加"算价/人数必须覆盖全部可写端口"的前端问题（文案与后端一致口径）。

Focused verification: `vitest run apps/api/src/modules/game-dispatch/domain apps/admin-web/app/_lib/merchant-console` → 0；
`tsc --noEmit -p apps/api/tsconfig.json` 与 admin typecheck → 0。
Rollback: 还原两个常量与新增校验即可；无数据影响（历史版本不受发布期规则影响）。

## 3. Task 2 客户侧只读入口（C-1 / C-9）

Files: 新增 `apps/api/src/modules/game-dispatch/interface/customer-game-template.controller.ts`；
`.../application/generic-game-template.service.ts`；`apps/api/src/common/validation/api-validation-rules.ts`；
`apps/api/src/openapi/schemas.ts`（如需新响应/参数 schema）；新增 `tests/integration/customer-self-service-order.spec.ts`。

- [ ] 失败集成用例：以 CUSTOMER 身份 `GET customer/published?gameId=` 只返回该游戏**未归档且有生效版本**的模板；
      以 `GET customer/versions/{versionId}/form` 取的配置**不含 CS-only 组件**；同一请求用 PLAYER 身份 403；跨租户版本 422 `TEMPLATE_VERSION_UNAVAILABLE`。
- [ ] 新增控制器：`@Controller("api/v1/tenant/game-dispatch")` + `@Get("customer/published")`、`@Get("customer/versions/:versionId/form")`，
      权限 `@Permissions("order.manage")` + 角色 `CUSTOMER`（与既有 `customer/*` 一致），带 `@RequireAddon(GAME_DISPATCH_TEMPLATE_V2_FEATURE)`。
- [ ] 应用层：新增 `listPublishedForCustomer(tenantId, gameId)` 与 `getCustomerVersionForm(tenantId, versionId)`，
      内部复用现有发布读取与 `visibleConfigV2(config, "CUSTOMER")`；**不**放宽既有 CS 方法的权限。
- [ ] 边界校验：`gameId` 为 uuid、`versionId` 形状校验沿用现有规则（沿用 `requireVersionId`）。

Focused verification: `vitest run --config tests/vitest.integration.config.ts tests/integration/customer-self-service-order.spec.ts` → 0。
Rollback: 删除新控制器与两个服务方法；契约改动为加性，回滚只需前端不调用。

## 4. Task 3 客户自助下单入口（写）（C-2 / C-5 / C-6 / C-8）

Files: `customer-game-template.controller.ts`（新增 `POST customer/template-orders`）；
`.../application/game-dispatch-template-order.service.ts`（`create` 增加 `audience: TemplateAudienceV2` 参数，删除写死的 `TEMPLATE_ORDER_WRITER_AUDIENCE` 常量）；
`game-dispatch-template-order.controller.ts`（CS 入口显式传 `"CS"`）；
`infrastructure/prisma-game-dispatch-template-order.repository.ts`（幂等 operation 按入口区分：CS 沿用现值，客户侧用新值）；
`common/validation/api-validation-rules.ts`；集成与契约测试。

- [ ] 失败集成用例：CUSTOMER 提交 `POST customer/template-orders`（带 `Idempotency-Key`）→ 201，`staffingSummary`/`priceAdjustmentFen` 按**客户可见字段**计算，
      落库 `formValuesJson` 只含 CUSTOMER 可见值；提交 CS-only 字段的值被丢弃（不报错、不落库）；CS-only 的必填字段**不**拦客户；
      同幂等键重放返回同一单；同键不同体 422；模板归档 409；跨租户 404；PLAYER 403。
- [ ] 失败契约用例：三个新 operation 存在且 `operationId` 稳定；客户下单路径带 `Idempotency-Key` 头参数；请求体**不**接受任何端口声明字段。
- [ ] 服务层参数化：`create(tenantId, actorId, idempotencyKey, input, audience)`；两处控制器各自传入口端口；事件 `template.field_values_dropped` 保持不变。
- [ ] 幂等：`IDEMPOTENCY_OPERATION` 拆成 CS / 客户两个值（避免两个入口互相回放）。

Focused verification: `vitest run --config tests/vitest.integration.config.ts tests/integration/customer-self-service-order.spec.ts tests/integration/game-dispatch-template-order.spec.ts` → 0；
`vitest run --config tests/vitest.contract.config.ts` → 0。
Rollback: 客户入口下线（移除路由）即回到"只有客服能下单"；已建订单与快照保留。

## 5. Task 4 H5 页面升级与 v1 回退（C-7 / C-11）

Files: `apps/mobile/src/pages/customer/game-order/index.tsx`（+ 同目录 `index.config.ts`、样式文件）；
必要时 `apps/mobile/src/platform/*` 适配层（新接口调用）；`apps/mobile/src/features/customer-ui/*`（表单渲染复用）。

- [ ] 视觉与结构以原型为准：`work/prototypes/customer-self-service-v2/index.html`（四步：游戏 → 模板 → 表单 → 提交完成）；
      该原型是**本地评审产物（不入库）**，契约以规格与计划为准。
- [ ] 分流：addon 未开通或该游戏无 v2 已发布模板 → 保持现有 v1 流程；否则走 v2（不出现任何端口选择 UI，C-9）。
- [ ] 表单按服务端返回的配置渲染（字段/表格/说明、必填标记、选项加价展示）；提交带幂等键；只显示服务端返回的人数与加价。
- [ ] 双端约束：不引入 Tailwind/shadcn；`window/document/localStorage` 仅出现在 platform 适配目录。

Focused verification: `@pw/mobile` typecheck 0；`build:h5` 与 `build:weapp` 成功；本地 H5 冒烟（Playwright `mobile-h5` 项目或记录人工走查步骤）。
Rollback: 前端回退到 v1 页（保持两个文件的历史版本），后端接口仍在但无调用方。

## 6. Task 5 契约重生成与门禁收口

- [ ] `pnpm openapi:generate`（**P1：需单独授权**）→ 更新 `openapi.yaml/json` 与 `packages/api-client`。
- [ ] 全量门禁：`tsc` api/admin/mobile；`vitest run apps/api apps/admin-web/app/_lib/merchant-console`；契约、集成、租户隔离、关键路径套件；
      eslint / prettier。
- [ ] E2E（admin 项目，真实本地 API + 浏览器）：客户下单后，客服在订单详情看到该单的 CS 可见字段；客户侧看不到 CS-only 内容与文案。
- [ ] 写验收记录一节（新增 `docs/acceptance/2026-09-19-customer-self-service-v2-order.md`），列出命令、退出码、未验证项。

## 7. 执行顺序

Task 1 → 2 → 3 → 4 → 5 串行；Task 2/3 依赖 Task 1 的端口集合，Task 4 依赖 Task 3 的接口。**提交/推送/openapi 重生成各自单独授权。**

## 8. 自检

- 规格 C-1 至 C-11 全部映射到 Task 1–5；非目标在 header 列明（含 C-10 的补填接口另立切片）。
- 无 TBD；引用的文件与符号均在本仓库核实过；新增文件路径遵守既有命名与目录约定。
- 每个 Task 都有失败用例先行 + 聚焦验证 + 回滚方式；持久化副作用（订单/快照/幂等记录）沿用既有事务与回滚口径。
- 权限点已标注：端口由入口决定、请求体不含端口声明、客户侧不复用 CS 端点（C-1 / C-9）。

## 9. 排序修正（2026-09-19，评审计划时发现）

Task 1 里"把 `TEMPLATE_WRITABLE_AUDIENCES_V2` 改为两个端口"这一条**改到 Task 3 执行**，其余不变。原因：

- 若在 Task 1 就翻转端口集合，"至少一个可写端口可见"会立刻放宽，于是**只给客户可见的值类内容变成可发布**；
  而客户入口要到 Task 2/3 才存在 → 中间出现"能发布但没人能填"的窗口期，正好是要避免的死配置。
- Task 1 只做**收紧**部分（C-4：参与算价/人数的内容必须对每个可写端口可见）。此时可写端口仍只有客服，
  等价于"算价/人数必须对客服可见"——不引入窗口期，且把现在只靠运行期兜底的问题前移到发布期。
- 端口集合翻转、前端 `WRITABLE_AUDIENCES` 同步、以及"CS-only 值类内容可发布"的解禁断言，都随 Task 3（客户写入入口）一起做。

Task 1 的聚焦验证相应改为：领域单测（C-4 的拒绝与放行）+ admin 单测（同口径提示）+ api/admin typecheck；
契约与集成在 Task 2/3 之后再跑。

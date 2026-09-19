# 客户自助下单（v2 通用派单模板）设计规格 v0.1

- 状态：**方向已获用户批准**（2026-09-19「A」）；规格待审阅
- 日期：2026-09-19
- 范围：客户侧只读接口 + 客户自助下单接口、端口可见性规则放宽与收紧、H5 下单页升级与 v1 回退
- 非目标：客服建单后客户补填（两段填写的锁单与合并）、算价模型（归属报名/结算）、陪玩端与老板端渲染面、发布设置屏

## 1. 背景与事实基线（本会话已核实）

| 事实                             | 证据                                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 客户侧目前只有 **v1** 下单       | `game-dispatch.service.ts` 的 `customerTemplates` / `customerTemplate` 读 `gameDispatchTemplateField` / `gameDispatchPosition`；`customerCreateDraft` 走 v1 草稿   |
| v1 下单页读 `field.fieldKey`     | `apps/mobile/src/pages/customer/game-order/index.tsx:68,126,158`（`customer/templates`、`customer/orders`）                                                        |
| v2 的写入方只有客服              | `POST /api/v1/tenant/game-dispatch/template-orders`（`gameDispatch.manage` + S5 addon 门禁），写入端口写死为 `CS`（`TEMPLATE_ORDER_WRITER_AUDIENCE`）              |
| 客户能读到的 v2 数据只有订单快照 | `GET .../customer/orders/:orderId/select` → `game-dispatch.service.ts` 的 `view(..., "CUSTOMER")` 过滤 `formValues` 与文案                                         |
| 端口规则现状                     | `TEMPLATE_WRITABLE_AUDIENCES_V2 = ["CS"]`；发布期"值类内容必须留给可写端口"；运行期"参与算价/人数却对该端口不可见"直接报错（`buildTemplateOrderDraftForAudience`） |
| 订单写入形状                     | 订单 + `gameDispatchOrder`（`formValuesJson`）+ `gameDispatchTemplateSnapshot`（`configJson` 全量、`schemaVersion: 2`）+ 幂等记录 + 审计                           |
| 移动端有选游戏页                 | `apps/mobile/src/pages/customer/game-select`                                                                                                                       |

## 2. 决策

| 编号 | 决策                                                            | 说明                                                                                                                                           |
| ---- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| C-1  | 客户侧**新增路由**，不复用 CS 端点                              | 端口由**入口**决定，不由请求体声明；权限与视图边界清晰                                                                                         |
| C-2  | 客户自助下单是**本片唯一**的写入场景                            | 客户是发起者；"客服建单→客户补填"另立切片                                                                                                      |
| C-3  | 可写入端口集合变为 `["CS","CUSTOMER"]`                          | 现有"值类内容必须留给可写端口"自动放宽；说明类不受限                                                                                           |
| C-4  | 新增发布期约束：**参与算价/人数的内容必须对每个可写入端口可见** | 否则客户下单必失败（运行期兜底会报错），宁可在发布期拦住                                                                                       |
| C-5  | 必填只在**该端口可见**的字段上生效（沿用 V-10）                 | 客户侧不校验 CS-only 必填；客服补填时按 CS 端口校验                                                                                            |
| C-6  | 不可见字段的值仍按 V-5 **丢弃并记受控事件**                     | `template.field_values_dropped`（只记条数）                                                                                                    |
| C-7  | H5 **就地升级** `customer/game-order` 页 + v1 回退分支          | 不新开第二套下单页；未开 addon 或该游戏无 v2 已发布模板时走 v1                                                                                 |
| C-8  | 幂等沿用现有机制                                                | 与 CS 下单使用同一实现，但用**独立的 operation 值**，避免两个入口互相回放                                                                      |
| C-9  | 端口由**入口**决定，界面**不提供**端口选择                      | 客户 H5 与商家后台是两个独立入口，进门即确定端口且与身份绑定；产品里不存在「切到另一端口视角」的路径（原型里的预览开关仅供评审对照，不进产品） |

## 3. 接口契约（加性）

| Method | Path                                                              | operationId（建议）                            | 权限                             |
| ------ | ----------------------------------------------------------------- | ---------------------------------------------- | -------------------------------- |
| GET    | `/api/v1/tenant/game-dispatch/customer/published?gameId=`         | `genericGameTemplate_listPublishedForCustomer` | `order.manage` + 角色 `CUSTOMER` |
| GET    | `/api/v1/tenant/game-dispatch/customer/versions/{versionId}/form` | `genericGameTemplate_getCustomerVersionForm`   | 同上                             |
| POST   | `/api/v1/tenant/game-dispatch/customer/template-orders`           | `gameDispatchTemplateOrder_customerCreate`     | 同上                             |

- 三个路由都带 S5 的 addon 门禁（`RequireAddon`），与 CS 侧一致。
- 响应形状与 CS 侧同构：表单返回**CUSTOMER 过滤后**的发布配置；下单返回 `staffingSummary` / `priceAdjustmentFen` / `document`。
- 下单请求体与 CS 侧一致（`gameId`、`templateId`、`templateVersionId`、`values`、可选 `desiredStartAt` / `durationMinutes`），`Idempotency-Key` 头必填（长度 8–100）。
- **请求体不含任何端口声明**；端口由路由决定（安全边界）。

## 4. 数据流

1. H5：选游戏（现有 `game-select`）→ `GET customer/published?gameId=` 列模板 → 选模板 → `GET customer/versions/{versionId}/form`。
2. 表单只渲染 CUSTOMER 可见内容（服务端已过滤，前端不做安全边界）。
3. 提交 → 服务端在单事务内：幂等声明 → 模板行锁 → 版本/游戏归属/归档校验 → `readPublishedConfig` →
   `buildTemplateOrderDraftForAudience(config, values, "CUSTOMER")`（丢弃不可见值、按 CUSTOMER 端口校验必填、算人数/加价/文案）→
   写订单 + 派单 + 快照（快照 `configJson` 存全量配置，`formValuesJson` 只存该端口可见子集）+ 幂等结果 + 审计 → 返回结果。
4. 客服侧后续查看该单时按 CS 端口过滤（现有行为，不变）。

## 5. 失败处理与边界

| 场景                                          | 处理                                                       |
| --------------------------------------------- | ---------------------------------------------------------- |
| 模板已归档                                    | 409 `TEMPLATE_ARCHIVED`（沿用）                            |
| 版本不属于该模板 / 配置不可解析               | 422 `TEMPLATE_VERSION_UNAVAILABLE`（沿用）                 |
| 同幂等键重放                                  | 回放首次结果；同键不同体 422；处理中冲突按现有策略         |
| 提交了该端口不可见的字段值                    | 丢弃 + `template.field_values_dropped`，不报错（V-5）      |
| 提交配置里不存在的键                          | 422 `TEMPLATE_COMPONENT_INVALID`（沿用）                   |
| 参与算价/人数却对 CUSTOMER 不可见（历史版本） | 422 `TEMPLATE_COMPONENT_INVALID`，文案点名内容（现有兜底） |
| 跨租户模板/版本 id                            | 按不存在处理（404 / 422，沿用现有口径）                    |

**安全边界**：租户上下文一律服务端绑定；客户只能读到自己的订单（`customerOf` 校验归属）；端口不来自客户端；
CS 侧端点权限与行为零改动；新端点不暴露 CS-only 字段（服务端过滤是唯一权威）。
端口与入口一一对应：客户入口只可能拿到 CUSTOMER 过滤结果，商家入口只可能拿到 CS 过滤结果；
**界面层不出现端口切换控件**——两端的可见集差异不由用户操作产生（C-9）。

## 6. 规则变更的连带影响

- `TEMPLATE_WRITABLE_AUDIENCES_V2` 变为两个端口后，发布期的"值类内容必须留给可写端口"从"必须对客服可见"放宽为"至少对一个可写端口可见"。
- 新增的 C-4 约束会**限制店主的标法**：带加价的选项字段与人数来源必须对客服和客户都可见。编辑器需要给出对应的问题提示（沿用 `collectDraftIssues` 管道）。
- 已有已发布版本不受影响（新约束只在发布时生效）；运行期兜底继续保护历史版本。

## 7. 测试与验收

- 领域单测：写入端口参数化（CS/CUSTOMER 两条路径各自丢弃与校验）、C-4 发布期约束、必填只在该端口生效。
- 集成：客户身份读模板/表单（不含 CS-only；只含 CUSTOMER 可见）；客户下单成功且快照值只含可见子集；不可见值被丢弃且不落库；
  客户侧不因 CS-only 必填受阻；幂等回放；归档拒绝；跨租户 404。
- 契约：3 个新 operation + addon 门禁 + `Idempotency-Key` 头参数。
- E2E（admin 项目驱动真实 API + 浏览器）：客户（H5 路径）下单后，客服在订单详情按 CS 端口能看到该单与其可见字段；
  客户侧看不到 CS-only 内容与文案。
- 移动端：typecheck + H5 构建；weapp 构建（Taro 双端约束，不引入 Tailwind/shadcn）。

## 8. 发布与回滚

- 加性契约变更 → 需 `pnpm openapi:generate`（P1 授权动作）。
- 回滚：关闭 addon 或前端不调新页即回到 v1；零 DDL、零数据迁移；已建订单与快照保留。

## 9. 自检

- 无 TBD；接口、权限、失败码、测试与回滚均点名；与既有端口可见性规格（V-1 至 V-11）不冲突。
- 与"客户侧 v2 下单面不存在"的既有事实基线一致：本规格正是补上这块。
- 单一实现计划可覆盖（Task 拆分交给 `writing-plans`）。

## 10. 补充决策（2026-09-19 用户定稿「按现在这版定」）

| 编号 | 决策                                     | 说明                                                                                                                                                                     |
| ---- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C-10 | 客服侧字段由客服在**商家端后补同一张单** | 客户下单只写 CUSTOMER 可见值；CS-only 值由客服事后补。**补填需要"编辑已建订单字段值"的写接口**，本片不做，作为紧随的独立小切片（涉及审计、能否改共同字段、是否重算加价） |
| C-11 | 客户侧**不做草稿**：一次填写一次提交     | 幂等键保证重试安全；填一半不落库。                                                                                                                                       |

## 11. 原型（非生产代码）

`work/prototypes/customer-self-service-v2/index.html`（同目录 `serve.mjs` 可本地 3010 端口预览）：
四步流程 + 「两个独立入口」的可见集对照。原型里的端口预览控件仅供评审比对，
**产品不提供端口选择**（C-9）。

该原型是**本地评审产物**：按约定 `work/` 不入库，仓库里的权威记录是本规格 + §10 的决策表；
实现时以原型为视觉目标，但以规格与计划为契约。

# S4 多游戏新建派单与订单快照验收记录（2026-09-17 执行）

状态：**locally-verified**（本地代码 + 本地一次性测试库 + 真实 API 的 E2E 证据齐全；未提交、未推送、未部署）

范围：S4 Task 0–6。按「客户与游戏 → 该游戏已发布模板 → 发布快照表单」三阶段创建派单：锁定 `templateVersionId`、服务端按快照计算人数与加价、写入订单快照、幂等创建，详情文案读订单自身快照。

## 1. 数据库与迁移

| 项目 | 事实 |
| --- | --- |
| schema 变化 | **无**（零 DDL，按批准的计划方案 A） |
| 本轮是否执行迁移 | **否** |
| 使用的测试数据库 | `pw_saas_s2_task2_20260916`（本地 127.0.0.1:5433，一次性库） |
| 未访问 | `pw_saas`、`pw_saas_test`、`pw_shadow`、S1b 演练库、任何远程库 |
| 夹具 | `work/s3-e2e-seed.mjs`（S3）、`work/s4-e2e-seed.mjs`（S4，门店 `s4e2e` + 两个游戏 + 客户）；模板与发布版本由用例经**真实 API** 创建 |
| 夹具清理 | E2E 结束后执行两个 seed 脚本的 `clean`，库内 templates/orders/snapshots/idempotency/tenants 计数均为 0 |
| 回滚方式 | 前端不调用 v2 入口即停止使用；已创建订单与快照保留，不做破坏性 down migration |

## 2. 契约变化（S4 新增/扩展）

前缀沿用仓库约定 `/api/v1/tenant/...`（D-1 已确认）：

| Method | Path | operationId | 权限 |
| --- | --- | --- | --- |
| GET | `/game-dispatch-templates/published?gameId=` | `genericGameTemplate_listPublished` | `gameDispatch.manage` |
| GET | `/game-dispatch-templates/versions/{versionId}/form` | `genericGameTemplate_getVersionForm` | `gameDispatch.manage` |
| POST | `/game-dispatch/template-orders`（header `Idempotency-Key`） | `gameDispatchTemplateOrder_create` | `gameDispatch.manage` |
| GET | `/game-dispatch/orders/{orderId}`（**加性扩展**） | `gameDispatch_view` | `gameDispatch.manage` |

新增受控错误码：`TEMPLATE_IDEMPOTENCY_REQUIRED`(400)、`TEMPLATE_IDEMPOTENCY_MISMATCH`(422)、`TEMPLATE_IDEMPOTENCY_IN_FLIGHT`(409)，均为加性变更，既有 11 个模板码未动。

需要单独说明：`GET /game-dispatch/orders/{orderId}` 此前在契约里**没有响应 schema**（生成类型为 `unknown`），本轮把它具名化并新增 `document`（nullable）；旧字段 `copyText/applyUrl/bossUrl/lines/round/templateName/formValues` 全部保留。生成类型的形状从 `unknown` 变为具名对象，属"把既成事实写进契约"。

## 3. 服务端行为要点

- 创建事务顺序：幂等声明 → 模板行锁（`FOR UPDATE`）→ 版本/归属/归档校验 → 发布配置读取 → 领域编排（人数/价格/文案）→ 订单 + 派单 + 快照 + 幂等结果 + 审计 → `lastUsedAt`。
- 人数只来自 `staffingSource`（FIXED / NUMBER_FIELD / REPEATABLE_TABLE_SUM），加价只来自选项整数分；客户端提交的未知 stableKey（含伪造的 `totalCount`/`priceAdjustmentFen`）一律 422。
- 幂等：唯一索引 `[tenantId, idempotencyKey, operation]` 是机制；`responseJson` 存 `{ requestHash, result }`；同键同哈希回放、同键不同哈希 422、读到无结果记录 409（防御分支）。
- 订单文案只读该订单自己的快照（`config_json` + `form_values_json` + 快照 `created_at`）；旧订单或快照不可解析时返回 `document: null` 并打一条 warn，不回退读当前模板。

## 4. 验证证据（命令 / 退出码 / 数量）

数据库类命令的 `DATABASE_URL`、`PLATFORM_DATABASE_URL`、`PW_TEST_MIGRATION_URL`、`PW_TEST_RUNTIME_URL` 全部显式指向一次性库；集成类测试另需 `PAYMENT_PROVIDER=mock`（未配置 provider 时应用按设计硬失败）。

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `corepack pnpm --filter @pw/api typecheck` | 0 | — |
| `corepack pnpm openapi:generate` | 0 | 契约 + 客户端重生成，新 operation 与 header 参数就位 |
| `vitest run --config vitest.config.ts apps/api/src/modules/game-dispatch/domain` | 0 | 8 文件 / 47 测试 |
| `vitest run --config tests/vitest.integration.config.ts tests/integration/game-dispatch-template-order.spec.ts tests/integration/game-dispatch-template-v2.spec.ts tests/integration/game-dispatch-flow.spec.ts` | 0 | 3 文件 / 42 测试 |
| `vitest run --config tests/vitest.tenant-isolation.config.ts` | 0 | 11 文件 / 36 测试 |
| `vitest run --config tests/vitest.contract.config.ts` | 0 | 4 文件 / 18 测试 |
| `vitest run --config vitest.config.ts apps/admin-web/app/_lib/merchant-console` | 0 | 16 文件 / 108 测试 |
| `corepack pnpm --filter @pw/admin-web typecheck` / `build` | 0 / 0 | 生产构建通过 |
| `eslint` / `prettier --check`（S4 全部改动文件） | 0 / 0 | — |
| `playwright test --project=admin … -g "S3 模板管理\|S4 新建派单"` | 0 | **6 passed**（S3 3 条回归 + S4 3 条） |

## 5. E2E 覆盖（真实本地 API，非 mock）

夹具门店 `s4e2e`；游戏、模板与发布版本都由用例经真实 HTTP 创建：

1. **主路径**：建两个游戏各一个模板并发布（A 游戏模板设为默认）→ UI 登录 → 新建派单选客户与游戏 A → **只看到 A 的模板**且默认标记可见 → 选模板 → 断言发布快照渲染（需求信息、须知）→ 填必填字段、选模式、加一行人数表 → 创建 → 跳转详情 → 断言「派单文案」面板出现且表格中能看到填写的区服值。
2. **归档拒绝**：填写期间经 API 归档该模板 → 再次提交 → 服务端 409 → 页面给出"该模板已被归档，请重新选择可用模板（已填写的内容仍保留）。"且**输入仍在**（不静默换模板）。
3. **幂等**：同一 `Idempotency-Key` 连发两次相同请求 → 两次返回**同一个 dispatchOrderId**，且服务端计算人数为 1。

## 6. Task 6 期间发现并修复的缺陷

| 缺陷 | 影响 | 修复 |
| --- | --- | --- |
| 集成测试 `afterAll` 未清理订单/派单/快照/幂等行 | teardown 触发外键错误（用例本身通过），并留下残留夹具 | 按外键依赖顺序补全清理；随后手工清掉上一次失败运行的遗留数据 |
| `layoutV2Rows` 不过滤停用**区块** | 下单表单渲染出停用区块，与服务端"只有启用区块内启用组件携带值"的语义不一致 | 填写态表单按服务端口径过滤区块+组件 |
| `TEMPLATE_ARCHIVED` 时清空当前模板选择 | 用户看不到自己刚填的内容，与"保留输入、不静默换模板"冲突 | 保留当前模板与输入，只提示需要重新选择 |
| 选择器的 Esc/点外关闭 effect 被写成单行注释（实现失误） | Esc 无法关闭下拉 | 改为真正的多行 effect 并补 E2E 覆盖 |
| E2E 夹具先设默认再发布 | `default` 需要生效版本 → 夹具失败 | 改为先发布、再用发布后的 revision 设默认 |

## 7. 偏差与未验证项

- **并发重复键策略**：规格写"处理中重复 409"，实现为"在唯一索引上等待先到者提交后回放"（`api-and-interface-design` 允许的 Wait 策略）；409 分支保留为防御路径，未做真并发压测。
- **计算值不独立落库**（方案 A）：`staffingSummary` / `priceAdjustmentFen` 由发布快照确定性重算；验收按此口径。
- **没有服务端"下单预览"接口**：弹窗内不展示人数/加价，只在创建响应与订单详情展示（规格 §10 的"只显示服务端预览结果"降级为创建后展示）。
- **detail 页 `document` 降级分支**只做了单元级路径覆盖，未在集成里构造损坏快照。
- 未做视觉回归、深色模式、真机触控验证；详情页迁移后的视觉变化没有截图基线。
- 依赖开发库 `pw_saas` 的既有 E2E 用例（`loginAsOwner` 那批）超出本轮授权，未运行；原"新建 GD 派单草稿后可真实发布"已改为 mock 契约版本，真实创建+发布由本轮 S4 E2E 覆盖。
- `work/s3-e2e-seed.mjs` 与 `work/s4-e2e-seed.mjs` 都带着库名守卫，只允许 `pw_saas_s2_task2_20260916`。

## 8. 复现步骤

```powershell
# 1) 本地服务（API 3100 / admin 3005）
docker compose -f infra/docker/docker-compose.yml up -d postgres
$env:DATABASE_URL='postgresql://pw_runtime:pw_runtime_dev_only@127.0.0.1:5433/pw_saas_s2_task2_20260916?schema=public'
$env:PLATFORM_DATABASE_URL='postgresql://pw:pw_dev_only@127.0.0.1:5433/pw_saas_s2_task2_20260916?schema=public'
$env:SESSION_SECRET='s4-e2e-local-secret-0123456789-abcdefghij'
$env:PAYMENT_PROVIDER='mock'; $env:PORT='3100'
$env:ADMIN_WEB_ORIGIN='http://localhost:3005'; $env:H5_ORIGIN='http://127.0.0.1:3005'
node apps/api/dist/main.js            # 工作目录 apps/api
$env:NEXT_PUBLIC_API_ORIGIN='http://127.0.0.1:3100'
node node_modules/next/dist/bin/next dev -p 3005   # 工作目录 apps/admin-web

# 2) 夹具
$env:DATABASE_URL='postgresql://pw:pw_dev_only@127.0.0.1:5433/pw_saas_s2_task2_20260916?schema=public'
node work/s3-e2e-seed.mjs seed
node work/s4-e2e-seed.mjs seed

# 3) E2E（必须用 localhost:3005）
$env:ADMIN_ORIGIN='http://localhost:3005'; $env:S4_API_ORIGIN='http://127.0.0.1:3100'
& '.\node_modules\.bin\playwright.cmd' test --project=admin tests/e2e/merchant-console-admin.spec.ts -g "S3 模板管理|S4 新建派单"

# 4) 收尾
node work/s3-e2e-seed.mjs clean
node work/s4-e2e-seed.mjs clean
```

## 9. 结论

S4 的界面与后端能力（按游戏选已发布模板、锁定版本、服务端人数与加价计算、快照写入、幂等创建、归档拒绝、详情按快照出文案）已在本地真实 API 上端到端验证，门禁全部通过。状态为 **locally-verified**：代码已改、本地已验证；**未提交、未推送、未部署**，§7 的降级项在完成前不应对外宣称"已验收完成"。
# S5 灰度、观测与兼容收口验收记录（2026-09-17 执行）

状态：**locally-verified**（本地代码 + 本地一次性测试库 + 真实本地 API 证据；未提交、未推送、未部署）

范围：S5 Task 0–5。为通用派单模板 epic 收口：租户级开关、关键路径观测、只读审计、灰度/回退 runbook，以及旧写路径与旧列的移除评估（**本片不删除**）。

## 1. 数据库与迁移

| 项目 | 事实 |
| --- | --- |
| schema 变化 | **无**（开关复用既有 `tenant_entitlements`，零 DDL） |
| 本轮是否执行迁移 | **否** |
| 使用的测试数据库 | `pw_saas_s2_task2_20260916`（本地 127.0.0.1:5433，一次性库） |
| 未访问 | `pw_saas`、`pw_saas_test`、`pw_shadow`、S1b 演练库、任何远程库 |
| 夹具 | `work/s3-e2e-seed.mjs`、`work/s4-e2e-seed.mjs` 现在会为夹具门店写入 `addon.game_dispatch_template_v2=true`；`clean` 会删除该行 |
| 夹具清理 | 结束时执行两个 seed 的 `clean`；另清理了三次失败运行遗留的租户（`gdv2c_*`、`s5off_*`） |

## 2. 租户级开关

| 项目 | 事实 |
| --- | --- |
| 能力位 key | `addon.game_dispatch_template_v2`（加入 `entitlements/domain/features.ts` 的 addon 目录） |
| 复用机制 | 既有 `@RequireAddon(...)` + 全局 `EntitlementGuard`（`APP_GUARD`），未新造门禁 |
| 语义 | **opt-in**：没有能力位行或 `enabled=false` 即未开通；未开通返回 **403 `feature disabled: addon.game_dispatch_template_v2`** |
| 生效延迟 | **即时**（无 TTL 缓存，回退就是杀开关） |
| 覆盖入口 | 模板管理 12 条 operation + 新建派单 3 条 operation（两个控制器类级注解） |
| 前端 | 新增 `feature-flags.ts`（`isTemplateV2Enabled` + `useTemplateV2Feature`）；未开通时模板管理与新建派单渲染"该门店尚未开通通用派单模板"只读说明 |

**与计划的偏差（已确认取舍）**：

- 计划写"新增受控错误码 `TEMPLATE_FEATURE_DISABLED`"→ 实际复用既有 403 语义（`FeatureDisabledError` → `ForbiddenException`）。理由：单错误策略，避免为同一语义造第二个码；契约无需改动。
- 计划写"加短 TTL 缓存"→ 未加。理由：回退必须即时生效（灰度/回退场景下缓存是负资产）；代价是 v2 入口每次请求多一次能力位查询，作为已知取舍记录在此。

**对既有行为的影响（必须知道）**：v2 从"默认可用"变为"默认关闭"。因为本次代码尚未部署，生产没有回退风险；但**任何新租户默认不能用 v2**，必须按 runbook 开通。所有既有测试夹具（3 个集成用例 + 2 个 E2E 夹具）已改为显式开通。

## 3. 观测

8 类事件（`game-template-observability.ts`，字段走白名单：id / 受控 code / `outcome` / `durationMs` / `count`）：

`template.list`、`template.draft_save_failed`、`template.revision_conflict`、`template.publish_failed`、`template.validation_issue`、`template.document_failed`、`template.order_create_failed`、`template.version_mismatch`

接线点 15 处，分布在 S2 模板服务（列表计时、保存草稿失败/冲突、发布失败、版本不匹配、校验问题）、S4 创建派单服务、订单文案生成路径。

**真实日志样例**（本地 API 实测，GET 模板列表）：

```
[Nest] 50268 - 2026/09/17 05:49:41 LOG [TemplateV2] {"event":"template.list","tenantId":"fc324cc0-2c76-4609-ba9b-83288b5f4cfe","outcome":"ok","durationMs":17}
```

样例中不含 config、订单值、客户姓名或手机号；单测（4 条）断言"多传的 `config`/`values`/`customerName`/`mobile` 与超长文本必被丢弃"、"sink 抛错不影响业务"。

## 4. 只读审计

`scripts/audit-template-v2.mjs`：库名守卫（仅一次性测试库）+ 纯只读，输出未归类 / 无生效版本 / 重名 / 孤儿版本 / 悬空 activeVersion / NEEDS_REVIEW 计数与**仅 id** 的样例。

实测两次：

- 空库：`totalTemplates=0`，六项计数全 0；
- 造一条未归类夹具后：`unclassified=1`、`withoutActiveVersion=1`，其余 0；清理后回到全 0。

## 5. 灰度与回退 runbook

`docs/runbooks/template-v2-rollout.md`：开关含义、开通步骤（平台接口 + 紧急 SQL）、灰度顺序（开发租户 → 测试租户 → 按租户）、每步验证清单、回退步骤与"回退后必须核对的三个计数"、禁止项。

## 6. 旧写路径与旧列移除评估（S5 不删除）

| 项目 | 事实 | 移除前置条件 |
| --- | --- | --- |
| v1 路由 | `game-template.controller.ts`：`POST /game-templates`、`PATCH /:id`、`DELETE /:id`、`POST /:id/copy` | 这 4 条路由的调用方全部迁移到 v2；无外部依赖 |
| v1 写入实现 | `prisma-game-template.repository.ts` 写 `game_dispatch_template_fields` / `game_dispatch_positions` / `game_dispatch_rank_rules`（create/createMany/updateMany/deleteMany） | 上述路由下线后，删除这些写方法与其测试 |
| 旧列 | `game_dispatch_templates.copy_lines`（NOT NULL）、`block_labels`；旧子表三张 | 先完成"旧模板归类"审计（未归类为 0）与兼容审计（NEEDS_REVIEW=0） |
| 旧读路径 | 订单详情已改为读订单快照（S4 Task 3），不依赖旧列 | 已满足 |
| 结论 | **S5 不删除任何旧路径或旧列**；删除需新设计与批准，并覆盖灰度期兼容 | — |

## 7. 验证证据（命令 / 退出码 / 数量）

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `corepack pnpm --filter @pw/api typecheck` | 0 | — |
| `corepack pnpm --filter @pw/api build` | 0 | 供真实服务验证用 |
| `vitest run … templates-v2-feature-gate.spec.ts` | 0 | 3 测试（未开通 403 / 开通即时 200 / 回退即时 403 / 跨租户不受影响） |
| `vitest run … game-template-observability.spec.ts` | 0 | 4 测试（白名单、数字裁剪、成功与失败事件、sink 异常旁路） |
| `vitest run --config tests/vitest.integration.config.ts`（模板 v2 + S4 + 并发） | 0 | 3 文件 / 44 测试（夹具已显式开通） |
| 真实 API：`GET /api/v1/tenant/game-dispatch-templates` | 200 / 403 | 已开通租户 200 + `template.list` 日志；未开通租户 403 `feature disabled` |
| `node scripts/audit-template-v2.mjs` | 0 | 见 §4 两次实测 |
| `corepack pnpm --filter @pw/admin-web typecheck` / `build` | 0 / 0 | 前端开关与只读说明可编译 |

## 8. 实施中发现并修复的缺陷

| 缺陷 | 影响 | 修复 |
| --- | --- | --- |
| `listFeatures` 使用**硬编码**的 key 数组，新增 addon 只加目录不会出现在 `tenant/features` | 前端读不到该能力位 → 已开通租户被误判"未开通"，v2 入口不渲染（E2E 真实 API 用例在点击客户选择器时元素反复卸载） | 改为以 `features.ts` 的 `FEATURE_KEYS` 为单一事实源；重建 API 后接口正确返回 `{featureKey, core:false, enabled:true}` |
| 两个 E2E 夹具的开通代码被插进 `clean` 分支（seed 分支没有可锚定的删除语句） | 夹具门店实际未开通，真实 API 用例 403 | 移到 seed 分支（tenant upsert 之后），clean 仍删除该行 |

## 9. 未验证项

- **未做生产演练**：runbook 的开通/回退只在本地一次性库执行过，未在真实平台控制台点击过；未做真实多租户灰度。
- **未做指标聚合**：8 类事件是结构化日志，未接入指标/告警系统（阈值与看板留给运维侧，runbook 给了建议判定标准）。
- **未测异步行为开关**：规格提到"异步行为共同受开关控制"，当前 epic 没有与模板 v2 相关的异步任务（无队列消费者），因此无从验证；若后续引入异步，需要在消费者入口同样读能力位。
- 未做视觉回归；前端只读说明的排版未做截图基线。

## 10. 结论

S5 把 epic 可运营化所需的三件事补齐：**租户级开关（零 DDL、即时生效、可回退）**、**8 类关键路径的结构化观测（PII 白名单）**、**只读审计 + 灰度 runbook**；并给出旧写路径/旧列的移除前置条件（本片不删除）。状态为 **locally-verified**：代码已改、本地已验证；**未提交、未推送、未部署**。至此通用派单模板 epic 的 S1–S5 全部落地。
# S2 通用派单模板管理 API 验收记录（2026-09-15 计划 · 2026-09-16 执行）

状态：**locally-verified**（本地代码 + 本地测试库证据齐全；未提交、未推送、未部署）

范围：S2 Task 1–5。保留旧 `/api/v1/tenant/game-templates`（v1 只读兼容），在 `game-dispatch` 模块内新增 schemaVersion 2 的独立管理 API，共 12 条新 operation。

## 1. 数据库与迁移

| 项目 | 事实 |
| --- | --- |
| schema 变化 | **无**（S2 不需要新迁移） |
| 本轮 Task 5 是否执行迁移 | **否** |
| 使用的测试数据库 | `pw_saas_s2_task2_20260916`（本地 127.0.0.1:5433，一次性库） |
| 未访问 | `pw_saas`、`pw_saas_test`、`pw_shadow`、S1b 演练库、任何远程库 |
| 夹具清理 | 测试自建自清，结束时模板/版本/审计/租户计数均为 0 |
| 回滚方式 | 从 module 移除新 controller/provider 即关闭 S2；已发布版本保持不可变，不做破坏性 down migration |

## 2. API 变化

前缀 `/api/v1/tenant/game-dispatch-templates`。

| Method | Path | operationId | 权限 |
| --- | --- | --- | --- |
| GET | `/` | `genericGameTemplate_list` | `gameTemplate.view` |
| POST | `/` | `genericGameTemplate_create` | `gameTemplate.edit` |
| GET | `/{id}/draft` | `genericGameTemplate_getDraft` | `gameTemplate.view` |
| PATCH | `/{id}/draft` | `genericGameTemplate_saveDraft` | `gameTemplate.edit` |
| POST | `/{id}/publish` | `genericGameTemplate_publish` | `gameTemplate.publish` |
| GET | `/{id}/versions` | `genericGameTemplate_listVersions` | `gameTemplate.view` |
| POST | `/{id}/restore` | `genericGameTemplate_restore` | `gameTemplate.publish` |
| POST | `/{id}/copy` | `genericGameTemplate_copy` | `gameTemplate.edit` |
| POST | `/{id}/default` | `genericGameTemplate_setDefault` | `gameTemplate.edit` |
| POST | `/{id}/archive` | `genericGameTemplate_archive` | `gameTemplate.archive` |
| POST | `/{id}/unarchive` | `genericGameTemplate_unarchive` | `gameTemplate.archive` |
| DELETE | `/{id}` | `genericGameTemplate_remove` | `gameTemplate.archive` |

错误统一 `{ code, message, details? }`：修订冲突 details 为 `expectedRevision/currentRevision/currentEditor/currentUpdatedAt`；校验失败 details.issues 为 `code/path/componentKey?/message`；删除受限 details 为 `templateId/versionCount/snapshotCount/orderCount`。details 不含 config、订单值或凭据。

生成客户端函数：`genericGameTemplateList/Create/GetDraft/SaveDraft/Publish/ListVersions/Restore/Copy/SetDefault/Archive/Unarchive/Remove`。

## 3. 安全与数据边界（检查位置）

- 租户来源：`req.principal.tenantId`（controller 不读客户端 tenantId）。
- 行级隔离：repository 首参 tenantId + `tenantGuarded`/`withTenantContext`（`SET LOCAL app.tenant_id`）。
- RLS：templates / versions / games / audit_logs 均有 tenant 策略。
- 权限：仅 `@Permissions`，不判断角色名；客服只有 `gameTemplate.view`。
- 输入校验：严格 Zod（拒绝 tenantId/status/rendererVersion/未知字段、number 金额、越界数组）。
- 乐观锁：所有 mutation 复用 `lockTemplate` 行锁 + `assertRevision`。
- 事务审计：版本、模板状态、默认切换、删除与 `audit_logs` 同事务；不写完整 config。

## 4. 验证证据（命令 / 退出码 / 数量）

数据库类命令的 `DATABASE_URL`、`PLATFORM_DATABASE_URL`、`PW_TEST_MIGRATION_URL`、`PW_TEST_RUNTIME_URL` 全部显式指向测试库；集成测试另需 `PAYMENT_PROVIDER=mock`（未设 `REDIS_URL`）。

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `corepack pnpm openapi:generate` | 0 | 生成 yaml/json + 4 个客户端文件 |
| 生成器第二次运行 + SHA256 比对 | 0 | 6 个产物完全一致 |
| `vitest run --config tests/vitest.contract.config.ts tests/contract/game-dispatch-template-v2.spec.ts tests/contract/openapi-money.spec.ts` | 0 | 9 通过（新契约 6 + 金额 3） |
| `corepack pnpm openapi:check` | 1 | 原因见 §5（产物未提交），非契约漂移 |
| `vitest run apps/api/src/modules/game-dispatch/domain` | 0 | 6 文件 / 34 测试 |
| `vitest run tests/integration/game-dispatch-template-v2.spec.ts` | 0 | 24 测试 |
| `vitest run tests/integration/game-dispatch-template-v2-concurrency.spec.ts` | 0 | 5 测试 |
| `vitest run tests/integration/game-dispatch-template.spec.ts` | 0 | 1 测试（旧 v1 兼容） |
| `vitest run --config tests/vitest.tenant-isolation.config.ts tests/tenant-isolation/game-dispatch-template-v2.spec.ts` | 0 | 7 测试 |
| `corepack pnpm --filter @pw/api typecheck` | 0 | — |
| `corepack pnpm --filter @pw/api-client typecheck` | 0 | — |
| `eslint`（S2 源码/测试/schemas.ts） | 0 | — |
| `prettier --check`（同上 + 生成产物 + 本文档） | 0 | — |
| `git diff --check` | 0 | — |

关键行为证据（全部为测试断言）：草稿/线上分离（发布后 save 不动旧版本字节，二次发布得 versionNo=2）；发布配置由服务端加 `documentRendererVersion:1`、剔除 `legacyCompatibility`，客户端提交 `rendererVersion`/`config` 被 400 拒绝；三轮同 revision 并发发布恰一个 201/一个 409，versionNo 连续唯一、无悬空 activeVersionId；save/publish、archive/publish、并发切换默认均恰一个生效且 revision 只前进一次；客服写入全 403、读取 200，PLAYER 403；A 店对 B 店模板的读写全部 404/422 且 B 店数据零变化；未发布无引用模板可删且删除后审计保留，已发布模板返回 409 `TEMPLATE_DELETE_RESTRICTED`。

## 5. 生成契约与 openapi:check 的准确状态

- 幂等：连续两次生成后 `openapi.yaml`、`openapi.json`、`client.gen.ts`、`index.ts`、`sdk.gen.ts`、`types.gen.ts` SHA256 全部相同。
- 增量：`openapi.json` 相对 HEAD 为 +10072 / -0（纯新增）；`sdk.gen.ts` +119 / -1；`types.gen.ts` +5240 / -0。`openapi.yaml` 为 +7677 / -199，但 yaml 与 json 由同一次运行的同一文档对象序列化，且 json 零删除，因此这 199 行是 YAML 序列化顺序/引号差异，不是契约删除。
- 路径数 153 → 164（新增 10 条路径 / 12 个 operation）；旧 `game-templates` 三条路径与旧 operationId 未变。
- `openapi:check` 退出码 1 仅因 `git diff --exit-code` 检测到受版本管理的生成产物尚未提交；契约漂移已由幂等证据排除。获得提交授权并把产物与源码一起提交后，该门禁才会返回 0。

## 6. 未验证 / 降级 / 已知缺口

- 未部署、未提交、未推送；无 Linux 容器验证，不声称可部署。E2E（Playwright）未运行，属 S3 门禁。
- 合同测试依赖先生成 `openapi.json`，CI 需先生成再跑 contract。
- 线上版本内容没有对外端点（versions 只给摘要、draft detail 只给 active version 摘要）：发布配置中的 `documentRendererVersion` 与 legacy 剔除由服务端与数据库断言验证。若 S3 需预览线上版本，应在后续任务新增版本详情端点并单独确认。
- `saveDraft` 的 `validationWarnings` 恒为空数组；`UNPUBLISHED_CHANGES` 为派生状态且与 `PUBLISHED` 互斥；列表默认不含已归档；未归类旧模板以 `game.id=""` 表示（建议后续改为 nullable）。
- 默认切换依赖「锁 game 行 + 部分唯一索引」；若将来有路径绕过该锁直接写 `is_default`，需为 `gd_templates_one_default_per_game_key` 补受控 409 映射。
- 测试库 `pw_saas_s2_task2_20260916` 保留以便复跑；可单独 DROP（本记录不含任何凭据）。

## 7. Skills / 方法

- `tdd`：Task 2 时数据库缝隙尚不可执行，已如实记录为降级测试契约（未发生完整红→绿周期）；Task 3–5 均在可执行缝隙上先写测试再实现。
- `systematic-debugging`：定位并修复 Express 5 `req.query` 只读 getter 导致 query 路由 500 的根因。
- 未使用前端类 skill：S2 不含 admin/mobile UI 改动。

## 8. 下一步

S2 到此停止。S3（正式模板管理界面）需要单独批准实施计划，并以本文件 §2 的生成客户端为唯一调用入口。
# 通用派单模板 v2：灰度与回退 Runbook

适用对象：平台运维 / 值班同学。目标是在**不删数据、不停服务**的前提下按租户放开 v2 模板管理与新建派单。

## 1. 开关是什么

| 项目 | 事实 |
| --- | --- |
| 能力位 key | `addon.game_dispatch_template_v2` |
| 语义 | **opt-in**：该租户没有这一行（或 `enabled=false`）即视为未开通 |
| 存储 | `tenant_entitlements(tenant_id, feature_key, enabled)`，**无新表、无迁移** |
| 影响面 | 模板管理 12 条 operation + 新建派单 3 条 operation；未开通时返回 **403 `feature disabled: addon.game_dispatch_template_v2`** |
| 生效延迟 | **即时**（门禁每次请求读能力位，没有 TTL 缓存） |
| 前端 | 未开通时模板管理与新建派单显示"该门店尚未开通通用派单模板"只读说明，不渲染 v2 入口 |

## 2. 开通步骤（每个租户一次）

1. 平台侧调用（推荐，走统一接口与审计）：

   ```http
   POST /api/v1/platform/tenants/{tenantId}/entitlements
   { "featureKey": "addon.game_dispatch_template_v2", "enabled": true }
   ```

2. 或直接落库（仅限紧急/演练，需先确认库里只有该租户这一行）：

   ```sql
   insert into tenant_entitlements (tenant_id, feature_key, enabled)
   values ('<tenantId>', 'addon.game_dispatch_template_v2', true)
   on conflict (tenant_id, feature_key) do update set enabled = true;
   ```

3. 验证（全部通过才算开通成功）：
   - 该租户登录后 `GET /api/v1/tenant/game-dispatch-templates` 返回 **200**；
   - 模板管理页能看到列表，新建模板可用；"新建派单"能选到该游戏的已发布模板；
   - `node scripts/audit-template-v2.mjs` 的关键计数在预期范围内（未归类 / 无生效版本不因开通变化）。

## 3. 灰度顺序

1. **开发租户**：先开一个内部门店，跑通"建模板 → 发布 → 新建派单 → 详情文案"。
2. **测试租户**：再开 1–2 个测试门店，观察 24h。
3. **按租户扩大**：确认下面观测项无异常后，按名单逐个开通；每次开通后重复 §2.3 验证。

观测项（见 `apps/api/.../game-template-observability.ts`，共 8 类事件）：

- 列表延迟：`template.list` 的 `durationMs`
- 草稿保存失败：`template.draft_save_failed`（`code` 指明原因）
- 并发冲突：`template.revision_conflict`
- 发布失败：`template.publish_failed`
- 校验问题：`template.validation_issue`（`issueCode`）
- 文案生成失败：`template.document_failed`
- 创建派单失败：`template.order_create_failed`
- 版本不匹配：`template.version_mismatch`

判定标准（建议）：单个租户 24h 内 `*_failed`/`conflict` 事件为 0，或与开通前基线一致；否则先回退该租户再排查。

## 4. 回退

1. 把该租户的能力位置回关闭（即时生效）：

   ```sql
   update tenant_entitlements set enabled = false
   where tenant_id = '<tenantId>' and feature_key = 'addon.game_dispatch_template_v2';
   ```

2. 验证：该租户 `GET /api/v1/tenant/game-dispatch-templates` 返回 **403**；前端显示未开通说明。
3. 核对未受影响（回退**不得**导致数据变化）：

   ```sql
   select count(*) from game_dispatch_templates where tenant_id = '<tenantId>';
   select count(*) from game_dispatch_template_versions where tenant_id = '<tenantId>';
   select count(*) from game_dispatch_template_snapshots where tenant_id = '<tenantId>';
   ```

   —— 三个数字应与回退前完全一致。

## 5. 禁止项

- 不得删除 `game_dispatch_template_versions` / `game_dispatch_template_snapshots` / 订单来"回退"。
- 不得执行破坏性 down migration（S5 没有 schema 变更）。
- 不得把开关做成进程级全局开关：它是一个**租户级**能力位。
- 不得在未开通租户上"先放行再补开通"：门禁失败就是失败，不要绕过。

## 6. 演练状态

- 本文档的开关命令与验证清单已在本地一次性测试库上执行过（开通→200、回退→403、审计计数不变）。
- **未在生产环境演练**，也未在真实平台控制台点击过开通按钮；首次灰度前建议在测试租户按本文档走一遍。
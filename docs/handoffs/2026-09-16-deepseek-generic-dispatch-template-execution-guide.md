# 通用派单模板中心：精简执行交接

本文件保留 S4/S5 的关键不变量和执行入口，不再复制主规格、完整计划、历史任务卡或验收日志。实时事实以代码、Git 和当前 Slice 计划为准。

## 1. 新会话最小启动上下文

只读取：

1. `AGENTS.md`
2. `AI_START_HERE.md`
3. 当前获批 Slice 的计划
4. 计划点名的目标代码和最近一份相关 acceptance

不要默认读取完整主规格、`PROJECT_STATUS.md`、本文件的历史版本、其他已完成计划、OpenAPI 全文或生成客户端全文。需要产品不变量时，读取主规格对应章节即可。

建议启动指令：

```text
仓库是 D:\pw system。遵守 AGENTS.md，并按 AI_START_HERE.md 路由。
本轮只处理我明确批准的一个 Slice；先用 git status --short 和路径限定检查确认范围。
保留全部现有改动，禁止 reset/checkout、无路径完整 diff、批量格式化、自动迁移、提交或推送。
只读取当前计划、目标文件和相关测试；大型生成文件用 rg、统计、哈希或目标 operationId 检查。
```

## 2. 当前状态

- S1b：通用组件、人数/价格与确定性文案，已有验收记录。
- S2：模板管理 API、版本/并发、OpenAPI 与生成客户端，已有验收记录。
- S3：正式模板管理 UI，已有验收记录。
- S4：多游戏新建派单与订单快照，已有验收记录。
- S5：灰度、观测与兼容收口是当前剩余 Slice；以 `docs/superpowers/plans/2026-09-17-generic-dispatch-template-s5-rollout-observability.md` 和当前代码为准。
- 上述内容存在于当前分支和脏工作树；“已有验收”不等于本轮已重新验证、已提交、已推送或已部署。

## 3. 不可改变的产品不变量

1. 一个模板只归属一个游戏；跨游戏通过复制产生独立模板。
2. 保存草稿不影响线上；发布后生成不可变版本，新派单锁定具体版本。
3. 历史订单只读自身快照，不读取当前模板，不改写旧订单。
4. 人数和价格只由服务端根据 stableKey、semanticRole 和发布快照计算；不信任客户端汇总值。
5. 金额使用整数分的十进制字符串/BigInt 语义，禁止浮点。
6. tenantId 与 actorId 来自服务端上下文；客户端不得控制。
7. 客服默认只能查看模板和创建派单，不能编辑、发布、默认或归档。
8. schemaVersion 1 保持兼容只读；未知版本显式失败。
9. 审计和日志不记录完整 config、订单表单值、凭据或隐私数据。
10. 旧 API 与历史订单兼容路径不能因 v2 灰度被破坏。

## 4. 工程和数据边界

- 所有租户查询显式携带 tenantId，并在 transaction-scoped RLS 上下文执行。
- mutation 使用 expectedRevision、唯一约束、锁或幂等机制，不能静默覆盖。
- 业务写入与成功审计保持同一事务；未知数据库异常不得伪装成受控成功。
- controller 只处理协议，domain 不依赖 Nest/Prisma，repository 不做产品决策。
- 生成客户端和 OpenAPI 产物禁止手改。
- 数据库测试必须获得准确测试库授权；不得回退到 `pw_saas`、`pw_saas_test` 或远程库。

## 5. 验证与输出控制

- 先跑聚焦测试，再跑当前 Slice 明确要求的兼容门禁。
- 成功输出只保留命令、退出码和用例数量；失败只展开首个相关根因。
- Git 使用路径限定 `diff --stat`、`diff --check` 和目标文件 diff；禁止输出当前工作树的完整 diff。
- OpenAPI 使用目标 operationId、schema 片段、生成统计和二次生成无差异证明。
- 每轮结束报告实际修改文件、验证、数据库影响、未验证项和下一步；不得自动开始下一 Slice。

## 11. S4 已完成基线

S4 的稳定语义是：选择客户与游戏，只展示该游戏未归档且有 active version 的模板，锁定 templateVersionId，按发布快照渲染并创建派单。服务端校验 game/template/version 同租户且归属一致，自行计算人数与价格，在同一事务保存订单、派单、版本关联、配置快照、幂等记录和审计。订单详情从自身快照生成文案。

S4 的准确实现与验证请按需读取：

- `docs/superpowers/plans/2026-09-16-generic-dispatch-template-s4-new-order.md`
- `docs/acceptance/2026-09-17-s4-new-order-snapshot.md`
- 当前目标代码与测试

## 12. S5 当前入口

S5 只处理灰度、观测和兼容收口：

- 租户级 `gameDispatchTemplateV2` 功能开关，同时约束后端用例、API 和前端入口。
- 结构化日志/指标覆盖模板列表、草稿保存、409、发布校验、文案生成、订单创建和版本不匹配。
- 只读审计脚本只输出计数，不输出 config、订单值或 PII。
- rollout/rollback runbook 按租户灰度；回退只关闭 v2 入口并保留草稿、版本与订单快照。
- S5 不删除旧列、不做破坏性迁移、不自动发布。

唯一执行计划：`docs/superpowers/plans/2026-09-17-generic-dispatch-template-s5-rollout-observability.md`。

## 13. 停止条件

出现范围外文件、数据库目标不明确、未授权外部动作、规格与代码的实质冲突，或三个连续失败假设时停止并报告。普通本地有界修改在已有授权内可继续，不要为重复预检反复暂停。

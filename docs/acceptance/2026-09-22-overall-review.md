# 整体审查记录 · 2026-09-22

- 范围：`D:\pw system` 全仓（后端 API / admin-web / mobile / 数据与迁移 / 测试与 CI / 文档）
- 基准：起于 `141e677`，收于 `48bae79`（本地与 `origin/master` 一致）
- 本文件只记录**结论与边界**；逐条 file:line 与命令证据见当轮报告与复跑资产（见文末）

## 1. 结论

审查发现全部收敛为 **20 个可独立验收的切片**，全部完成并推送；`master` 上 CI 连续绿，且新增的数据库迁移在**三条独立路径**上验证通过（本机三个库增量应用、CI 全新 Postgres service、`container-smoke` 的生产 compose 容器路径）。

假绿已消除：本机两个 API 的库指向、dev 库迁移落后、H5 静态服务「缺失文件回 200」、E2E 缺夹具静默跳过、覆盖率阈值与文档目标不一致——均已修正或写入登记。

## 2. 完成的 20 个切片

S-A 文档口径 · S-B `template-orders` 请求体校验 · S-C 上传端点非二进制拒绝 · S-D 接单大厅 N+1 · S-D2 我的报名 N+1 · S-E H5 静态服务 404 与路径逃逸 · S-F E2E 夹具可配置、缺夹具失败 · S-F2 门店 code 读取统一 · S-G dev/`pw_saas_test` 补 7 个迁移 · S-H admin 金额整数分 · S-H2 分账试算整数分 · S-I 状态枚举文案覆盖测试 · S-J 补 slot/outbox 外键 · S-K H5 与 weapp 分目录输出 · S-L 数据与遗留物清理 · S-M1 CI 接入 Redis · S-M2 E2E `--list` 解析门禁 · S-N 报表时区口径声明 · S-O ADR-0007 租户仓库首参不变量 · S-P 去掉 `as never` · S-R CORS 多来源。

（S-A…S-R 共 20 项；S-Q 见 §4。）

## 3. 数据与环境的最终状态

- 三个库（`pw_saas` / `pw_saas_s2_task2_20260916` / `pw_saas_test`）：36 个迁移、schema up to date、新加的 6 条外键全部 validated；**28 项跨表孤儿体检全 0**。
- 一次性测试库：租户 73 → 19（删掉 54 个「无账号且无订单」的空壳租户，删前已把 45 行依赖数据导出）；无主 `outbox_events`、孤儿 `slot_evidence`、已撤销 `refresh_sessions` 全部清零。
- `data/` 已清空：4 个 evidence 目录（632 文件 / 4.40 MB）**移动**到 `work/backups/evidence-20260922/`（可恢复）。
- 遗留排练库 `pw_saas_s1b_rehearsal_20260915_0428`：导出 68 张表后 DROP。

## 4. 已撤销的结论（重要）

曾判定「legacy 派单/场次面仅被测试引用、可以删除」——**该结论是错的**。反证：

- `apps/admin-web/app/(tenant)/orders/page.tsx` 用模板串动态拼 `POST /api/v1/tenant/orders/${id}/${action}`，其中 `action ∈ {confirm, cancel, publish}`；
- `apps/mobile/src/pages/player/order-hall/index.tsx` 实际调用 `/api/v1/tenant/player/order-hall`、`/player/applications`、`/player/orders/${orderId}/applications`。

因此**没有删除任何端点**；「同一能力两套 UI + 两套端点并行」改记为 `docs/DEVELOPMENT_BACKLOG.md` 的「旧页面收敛（G4 改到即迁）」。

## 5. 未验证 / 未覆盖（不得当作已通过）

- **逐控件对接表**：本轮交付到「全量路由 × 调用方」（216 条，含生成客户端双向 0 漂移）与关键页面实测探针；**未逐控件穷举** admin-web / mobile 每个 UI 控件的端点与返回体字段。
- **平台后台口径**：只做了静态调用方比对，未做平台端页面的口径实测。
- **weapp**：本机无运行时（全部能力是 typed unsupported 桩），仅静态审查；「四端一致」应表述为「三端可运行 + weapp 未开工」。
- **agent 提供的具体数字**：`test:integration` / `tenant-isolation` / `contract` / `coverage` 的通过数与覆盖率百分比，来自审查期的子 agent、**未逐条独立复跑**（其「通过」结论已由同一提交的 CI 覆盖，但具体数字未复核）。
- **`pw_saas_test` 租户数 139 → 141 的归属**：迁移不写 `tenants`，而最新行 `created_at` 早于首次读数；未能证实来源，未归属。
- **`tenant-guard` 直通分支的可利用性**：两条独立路径均未构造出可达越权路径，故 ADR-0007 记录为机制风险与预防性约束。

## 6. 未开工 / 已登记（不是本次缺陷）

- 多时区：报表「今日」日界当前写死 `Asia/Shanghai`（三个库的 `tenants.timezone` 全部一致，故未改成读配置）。
- E2E 不进 CI：需要 3005 与 3101 两个服务、Edge 通道与走查夹具；视觉基线只有 win32。CI 侧只加 `playwright test --list` 解析门禁。
- 产品级立项项：weapp 真机与发布、真实支付/短信/AI Provider、门店收入账本、客户流失预警、平台开店草稿、Linux 容器实机验证、容量基线、发布验证。

## 7. 复跑资产（沙箱可写区，未污染仓库）

`C:\Users\Listener\.codex\visualizations\2026\09\21\01a0c64c-b07c-75a0-86de-4021dbd26c26\audit\`

- 覆盖核对：`coverage-verify.mjs` / `coverage-verify.md`（216 路由 × 双前端 × 生成客户端）
- 只读 SQL：`q.mjs` + `orphans.sql`、`fks.sql`、`exact-counts.sql`、`db-overview.sql`、`s-j-verify.sql`
- 守卫式写工具：`guarded-edit.mjs`、`exec-sql.mjs`、`commit-slices.mjs`
- 执行脚本：`s-g-preflight.mjs`、`s-g-backup.mjs`、`del-orphans.mjs`、`write-sj-migration.mjs`、`s-l-delete-shell-tenants.mjs`、`s-l-drop-rehearsal.mjs`、`restart-3300*.ps1`、`restart-3005.ps1`、`probe-3300.mjs`
- 备份：`s-g-backup/`（迁移前 7 张表）、`s-l-backup/`（54 空壳租户的 45 行 + rehearsal 库 68 表）

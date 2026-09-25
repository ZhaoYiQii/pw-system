# 项目状态（精简导航）

- 核对日期：2026-09-26（2026-09-26 完成业务资金线 8 笔提交入库与全量门禁复核）
- 当前状态：`master` @ `3c73cd4`（2026-09-26）；实时提交与工作树以 `git log -1`、`git status --short` 为准。
- 本文件只保留当前状态和导航，不再复制完整历史、文件清单或验收日志。

## 当前能力

- 平台端、商家端、陪玩端、老板端四个角色端主链路已有本地实现，承载在 admin-web 与 mobile H5 两个应用上。
- 后端基线包含多租户/RLS、认证权限、订单/派单/场次、账本结算、争议审计、通知与 Outbox、平台开店和经营工作台。
- 通用派单模板 epic 的 S1b–S5（含 v2 灰度开关与关键路径观测）与客户自助下单 v2（H5 自助下单 + 模板字段端口可见性）已于 2026-09-20 经 PR #3 合并进 master；后续状态以代码与新鲜验证为准。
- admin 新功能使用 Tailwind v4、shadcn/ui 风格组件和 TanStack Query；旧页面继续“改到即迁”。
- mobile 当前基线是 Taro 4 + React 18.3.1；**weapp 端未开工**：`apps/mobile/src/platform/weapp` 的身份、媒体、租户定位等能力全部是 typed unsupported 桩（`capabilities.ts` 六项均 `supported:false`），`build:weapp` 通过只代表可构建、不代表可用。相关变更仍需保持双端可构建。
- 异步可靠性采用 Redis 共享限流 + 数据库 Outbox，不引入 BullMQ。

## 当前工作树与环境

- 此前散落在工作树的 admin / API / 测试 / OpenAPI 生成物改动已随 PR #3 与 2026-09-26 的 8 笔提交全部入库。2026-09-26 复查：工作树仅剩 `work/` 下约 20 个本地辅助脚本与截图目录（`work/` 未被 `.gitignore` 覆盖）、`apps/admin-web/.next.stale-20260926/` 过期构建快照（eslint ignores 已补 `**/.next.*/**`），以及会被 Next 在 dev/build 时自动改写的 `apps/admin-web/next-env.d.ts`。仍然禁止无路径的批量清理、重置或格式化。
- Node 24.19.0、pnpm 10.34.5 可用。
- 2026-09-20 核对：Docker Desktop 在运行，`pw-saas-local` 的 postgres(5433) / redis(6380) / minio(9002,9003) 三个容器均在跑，集成套件本地连续 5 次全量通过。注意沙箱内进程连不上 docker pipe，docker 命令需提权执行。
- 2026-09-22 审查复核：本机 `:3300` 与 `:3100` 两个 API 实测**都指向一次性测试库 `pw_saas_s2_task2_20260916`**（该库含走查门店 `s5cwalk`），而 dev 库 `pw_saas`（含演示门店 `c1`）当前没有 API 在服务；dev 库与 `pw_saas_test` 均落后仓库 7 个迁移。凡「本机实测」结论都要先确认 API 连的是哪个库。
- `openapi.json`、`openapi.yaml` 和 `packages/api-client/src/*` 是生成产物，只能通过生成命令更新；检查时使用目标 operationId、统计、哈希和二次生成一致性，禁止全文灌入 Agent 上下文。

## 本地运行拓扑

| 端              | 地址                                     | 角色                                    |
| --------------- | ---------------------------------------- | --------------------------------------- |
| API             | http://127.0.0.1:3100（另有一份在 3300） | 统一后端（无页面）                      |
| 平台端 / 商家端 | http://localhost:3005                    | admin-web：平台登录与商家端同源不同路由 |
| 陪玩端 / 老板端 | http://localhost:3101                    | mobile H5：角色页同源不同页面           |

联调演示账号（密码均 `zcloud1024`，与 `scripts/seed-dev.mjs`、`scripts/seed-store-demo.mjs` 及各 E2E 夹具脚本一致）：`admin`（平台）、`owner`（店主）、`player`/`player2`（陪玩）、`customer`（老板），门店 code `c1`/`demo`（`c1` 只存在于 dev 库 `pw_saas`）。

## 仍开放的产品与工程项

- 门店收入账本及应收/实收/毛利口径。
- 商家端 preview/planned 模块逐项落地。
- 微信一键登录、真实支付、自动催缴和真实通知/对象存储 Provider。
- E2E 接入 CI、覆盖率债、容量基线、Linux 容器实机验证、备份恢复、真实域名与发布验证。
- 微信小程序真机、审核和发布等待账号、AppID 与独立授权。

## 当前任务如何取证

| 需要的信息         | 读取位置                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| 实时修改与范围     | `git status --short`、路径限定 `git diff --stat`                                                                     |
| 当前派单模板工作   | `docs/superpowers/plans/2026-09-17-generic-dispatch-template-s5-rollout-observability.md`、目标代码、对应 acceptance |
| 未完成产品项       | `docs/DEVELOPMENT_BACKLOG.md` 的相关条目                                                                             |
| 外部条件与未验证项 | `docs/unverified-and-deferred.md` 的相关条目                                                                         |
| 历史切片证据       | `docs/acceptance/` 和 Git 历史，按需读取单个文件                                                                     |
| 架构决策           | `docs/adr/` 中对应 ADR                                                                                               |

## 状态声明

`code-changed`、`locally-verified`、`committed`、`pushed`、`deployed`、`production-verified` 是不同状态。缺少当前命令证据时只能标记未验证；历史验收不能替代本轮验证。

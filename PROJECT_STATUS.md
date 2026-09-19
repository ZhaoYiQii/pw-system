# 项目状态（精简导航）

- 核对日期：2026-09-18
- 当前状态：`master` @ 2026-09-20（PR #3 squash 合并）；实时提交与工作树以 `git log -1`、`git status --short` 为准。
- 本文件只保留当前状态和导航，不再复制完整历史、文件清单或验收日志。

## 当前能力

- 平台端、商家端、陪玩端、老板端四端主链路已有本地实现。
- 后端基线包含多租户/RLS、认证权限、订单/派单/场次、账本结算、争议审计、通知与 Outbox、平台开店和经营工作台。
- 通用派单模板 epic 的 S1b–S5（含 v2 灰度开关与关键路径观测）与客户自助下单 v2（H5 自助下单 + 模板字段端口可见性）已于 2026-09-20 经 PR #3 合并进 master；后续状态以代码与新鲜验证为准。
- admin 新功能使用 Tailwind v4、shadcn/ui 风格组件和 TanStack Query；旧页面继续“改到即迁”。
- mobile 当前基线是 Taro 4 + React 18.3.1；weapp 开发暂缓，但相关变更仍需保持双端可构建。
- 异步可靠性采用 Redis 共享限流 + 数据库 Outbox，不引入 BullMQ。

## 当前工作树与环境

- 此前散落在工作树的 admin / API / mobile / 测试 / OpenAPI 生成物改动已随 PR #3 全部入库，工作树已干净（唯一例外：`apps/admin-web/next-env.d.ts` 会被 Next 在 dev/build 时自动改写）。仍然禁止无路径的批量清理、重置或格式化。
- Node 24.19.0、pnpm 10.34.5 可用。
- 2026-09-20 核对：Docker Desktop 在运行，`pw-saas-local` 的 postgres(5433) / redis(6380) / minio(9002,9003) 三个容器均在跑，集成套件本地连续 5 次全量通过。注意沙箱内进程连不上 docker pipe，docker 命令需提权执行。
- `openapi.json`、`openapi.yaml` 和 `packages/api-client/src/*` 是生成产物，只能通过生成命令更新；检查时使用目标 operationId、统计、哈希和二次生成一致性，禁止全文灌入 Agent 上下文。

## 本地四端运行拓扑

| 端              | 地址                  | 角色                                    |
| --------------- | --------------------- | --------------------------------------- |
| API             | http://127.0.0.1:3100 | 统一后端（无页面）                      |
| 平台端 / 商家端 | http://localhost:3005 | admin-web：平台登录与商家端同源不同路由 |
| 陪玩端 / 老板端 | http://localhost:3101 | mobile H5：角色页同源不同页面           |

联调演示账号（密码均 `Dev-Password-123`）：`admin`（平台）、`owner`（店主）、`player`/`player2`（陪玩）、`customer`（老板），门店 code `c1`/`demo`。

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

# 项目状态（精简导航）

- 核对日期：2026-09-18
- 当前分支：`feat/generic-dispatch-template-manager`；实时提交与脏工作树以 `git log -1`、`git status --short` 为准。
- 本文件只保留当前状态和导航，不再复制完整历史、文件清单或验收日志。

## 当前能力

- 平台端、商家端、陪玩端、老板端四端主链路已有本地实现。
- 后端基线包含多租户/RLS、认证权限、订单/派单/场次、账本结算、争议审计、通知与 Outbox、平台开店和经营工作台。
- 通用派单模板 epic 的 S1b、S2、S3、S4 已有本地验收记录；S5 灰度、观测与兼容收口相关改动位于当前工作树，必须以代码、当前计划和新鲜验证为准。
- admin 新功能使用 Tailwind v4、shadcn/ui 风格组件和 TanStack Query；旧页面继续“改到即迁”。
- mobile 当前基线是 Taro 4 + React 18.3.1；weapp 开发暂缓，但相关变更仍需保持双端可构建。
- 异步可靠性采用 Redis 共享限流 + 数据库 Outbox，不引入 BullMQ。

## 当前工作树与环境

- 工作树包含大量用户未提交改动，覆盖 admin、API、mobile、测试、OpenAPI 生成物、文档和工作文件；禁止清理、重置、覆盖或无路径批量格式化。
- Node 24.19.0、pnpm 10.34.5 可用。
- Docker 客户端存在，但最近核对时守护进程未运行；依赖 PostgreSQL 5433、Redis 6380、MinIO 9002/9003 的集成测试、E2E 和 seed 需重新确认环境。
- `openapi.json`、`openapi.yaml` 和 `packages/api-client/src/*` 是生成产物，只能通过生成命令更新；检查时使用目标 operationId、统计、哈希和二次生成一致性，禁止全文灌入 Agent 上下文。

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

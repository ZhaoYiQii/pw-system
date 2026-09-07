# 项目状态（2026-09-07 校对版）

- 项目：陪玩门店多租户 SaaS
- 规格版本：v1.0（2026-09-06 用户确认作为实现基线）
- 状态日期：2026-09-07
- 当前阶段：核心业务主链路已在本地跑通并全绿；剩余为业务增强、工程收尾与发布上线（H1–H6）。具体开放项见 [docs/DEVELOPMENT_BACKLOG.md](docs/DEVELOPMENT_BACKLOG.md) 与 [docs/unverified-and-deferred.md](docs/unverified-and-deferred.md)。

## 本地环境

- Node 24.19.0、pnpm 10.34.5（corepack 固定）、Turbo、Vitest、Playwright 已就绪。
- Docker：postgres:18 / redis:7 / minio 容器运行中；本机端口 postgres 5433、redis 6380、minio 9002/9003。
- Git：远程 `https://github.com/ZhaoYiQii/pw-system.git`，`origin/master` 保持同步。

## 本地四端运行拓扑

| 端 | 地址 | 角色 |
| --- | --- | --- |
| API | http://127.0.0.1:3100 | 统一后端（无页面） |
| 平台端 / 商家端 | http://localhost:3005 | admin-web：平台登录与商家端同源不同路由 |
| 陪玩端 / 老板端 | http://localhost:3101 | mobile H5：角色页同源不同页面 |

联调演示账号（密码均 `Dev-Password-123`）：`admin`（平台）、`owner`（店主）、`player`/`player2`（陪玩）、`customer`（老板），门店 code `c1`/`demo`。

## 已完成范围（截至 2026-09-07）

- 后端主线 Slice 0–11：多租户/RLS、认证与权限、门店/陪玩/客户档案、服务目录、订单状态机、派单报名选人、场次与证据、分成与账本、结算批次、争议/审计/通知、Outbox、AI 需求解析、SaaS 开通与套餐。
- 安全与质量收尾 R1–R5：OpenAPI/契约、Zod 输入校验与 RFC9457 错误、requestId/日志、/health 与 /ready、覆盖率门禁、CSRF/Origin/Fetch-Metadata、手机号加密、运行连接三分离、审计覆盖与脱敏、Redis 限流、后台 worker（订阅到期/超时确认/Outbox 消费）。
- 陪玩运营 Block1：游戏模板 CRUD 与商家可视化编辑、陪玩基础价/段位加价、通用派单、同位置多人档位、报名/取消/刷新、老板 H5 选人与确认陪玩。
- Block2 P1–P5：老板钱包与充值（模拟支付）、选人余额校验、每档场次开始/结束与开始/结束双证据、实际时长分账扣费、门店确认结算、老板 H5 钱包页。
- 前端：admin 新栈样板（Tailwind v4 + shadcn/ui + TanStack Query）及多数业务页；mobile Taro H5 登录/接单/选人/场次/证据/钱包/争议入口全部接线；微信小程序保持双端构建门禁。
- 最近门禁证据：P5 前全量 integration 98 用例全绿（Block2 P4）；P5 为前端钱包与 admin 确认结算按钮、无后端变化，mobile/admin/h5 构建与 typecheck 已绿。文档整理提交不触碰门禁。

## 仍未完成（摘要，详细见两份清单）

- 业务缺口：平台一键开店前端闭环（T1）、微信/手机验证码登录、真实线上支付、自动催缴。
- UI/体验：admin 结算批次页、旧订单筛选/独立详情、场次/证据独立视图；mobile 收入明细/争议详情独立页；G4 旧页面渐进迁移。
- 工程收尾：Playwright E2E 正式入库并替换 `test:e2e` 占位、容量基线、integration branches 60→80、可选 worker 崩溃注入测试。
- 发布上线（H1–H6）：Linux 容器化、备份/恢复演练、phase-1 acceptance、审计/日志脱敏上线复查、真实域名部署（H5 品牌运行态 + 同源反代）、统一入口设备自动跳转。

## 外部挂起

- 微信小程序真机/审核/发布（用户决定主程序完成后处理）。
- mobile React 19（等 Taro 上游支持）。
- 短信/微信通知、真实支付、AI Provider、生产对象存储所需密钥/账号。
- 真实域名/服务器/反向代理、生产 `PII_MASTER_KEY`。

## 范围决策记录

1. weapp 开发暂缓；保留 `pnpm build:weapp` 作为双端兼容性门禁。
2. mobile React 18.3.1 为当前基线（Taro 4.2.1），React 19 升版挂起。
3. admin 前端渐进迁移到 Tailwind v4 + shadcn/ui + TanStack Query；新功能一律新栈，旧页“改到即迁”。
4. 金额统一十进制字符串分/BigInt，禁止浮点。
5. Redis 共享限流 + DB Outbox 覆盖队列语义，不引入 BullMQ（2026-09-07 记录）。

## 状态更新记录

- 2026-09-07 | 本文件由 Slice 0 骨架期状态整体校对为当前主线完成状态；历史切片证据回查 git log `cce1ca0..3692450`。

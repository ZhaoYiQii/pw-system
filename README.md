# 陪玩门店多租户 SaaS

面向多家陪玩门店销售的多租户 SaaS。一期包含平台运营后台、商家端后台（店老板/店长/客服/财务）与陪玩/老板 H5；同一套移动端代码持续兼容未来独立微信小程序。

当前状态：平台端、商家端、陪玩端、老板端四端主链路已有本地实现。实时进度以代码、Git 和新鲜验证为准；精简导航见 `PROJECT_STATUS.md`。

## 给开发者与 AI

开始任何工作前只固定阅读：

1. `AGENTS.md`
2. `AI_START_HERE.md`

随后按 `AI_START_HERE.md` 的路由只读取当前任务相关章节和目标文件，不默认完整加载状态、主规格、历史计划或生成物。新功能按 `AGENTS.md` 的 Slice 规则推进，一次只实施一个 Slice。

## 技术栈（已落地）

- TypeScript Monorepo + Turbo：`apps/api`（NestJS 模块化单体）、`apps/admin-web`（Next.js 16 + Tailwind v4 + shadcn/ui + TanStack Query）、`apps/mobile`（Taro 4 + React 18.3.1，H5 / weapp 双构建）、`apps/worker`。
- PostgreSQL（RLS 多租户）+ Redis（共享限流）+ 对象存储；金额一律整数分或十进制字符串，禁止浮点。
- API 契约由 OpenAPI 生成，客户端代码不得手工修改。

## 本地与生产目标

- 本地：Windows + Docker Desktop（Linux containers）；本机端口 postgres 5433、redis 6380、minio 9002·9003。
- 构建与运行目标：Linux 容器；生产部署见 `docs/runbooks/production-deploy.md`，部署属于需要单独授权的动作。

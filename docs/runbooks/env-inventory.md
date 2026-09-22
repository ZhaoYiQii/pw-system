# 环境变量清单（P2 上线准备，草稿待批）

来源：`.env.example`、`infra/docker/env.prod.example`、`infra/docker/docker-compose.prod.yml`
以及全仓 `process.env.*` 实际使用点（`apps/**`、`packages/**`、`scripts/**`，排除 `node_modules`/`dist`）。
本文档只登记**代码里真实读取**的变量；不猜测未出现的名字。

## 1. 三套数据库连接串（A4 权限模型）

| 变量 | 角色 | 谁在用 |
| --- | --- | --- |
| `DATABASE_URL` | `pw_runtime`（非表 owner，受 RLS 约束） | api、worker 全部租户业务数据 |
| `PLATFORM_DATABASE_URL` | owner（本地 `pw` / 生产 `pw_saas`） | api 平台/跨租户模块、`/ready` 数据库探测 |
| `DATABASE_MIGRATION_URL` | owner | 仅 `pw-init` 容器：`prisma migrate deploy` 与种子脚本 |

## 2. 应用运行时（api / worker）

| 变量 | 必填 | 读取点 | 缺省/兜底 | 生产硬失败条件 |
| --- | --- | --- | --- | --- |
| `NODE_ENV` | 建议 | 多处 | 无 | 生产为 `production` 时启用下面的 mock/PII 校验 |
| `PORT` | 可选 | `apps/api/src/main.ts` | `3000` | — |
| `SESSION_SECRET` | **必填** | `identity-access.module.ts` | 无 | 未配置直接启动失败（`SESSION_SECRET is not configured`） |
| `PII_MASTER_KEY` | **生产必填** | `common/pii/phone.ts` | 本地可由 `SESSION_SECRET` 派生 | 生产缺失 → `PII_MASTER_KEY is required in production`；非 32 字节 base64 → `PII_MASTER_KEY must be 32 bytes base64` |
| `PAYMENT_PROVIDER` | **必填** | `wallet/wallet.module.ts` | 无 | 未配置 → 抛错（当前仅实现 `mock`） |
| `ALLOW_MOCK_PAYMENT` | 生产演示必填 | `wallet/wallet.module.ts` | 无 | 生产且 `!== "true"` → `mock payment is not allowed in production` |
| `SMS_PROVIDER` | 可选 | `identity-access.module.ts` | `mock` | 可选 `mock` \| `tencent`；未知值抛错且**不退回 mock**；`tencent` 缺凭证 → 启动失败并点名变量 |
| `ALLOW_MOCK_SMS` | 生产演示必填 | `identity-access.module.ts` | 无 | 生产且 `!== "true"` → `mock sms is not allowed in production`（只对 `mock` 生效，`tencent` 不需要） |
| `TENCENT_SMS_SECRET_ID` / `TENCENT_SMS_SECRET_KEY` | `SMS_PROVIDER=tencent` 时必填 | `infrastructure/tencent-sms.provider.ts` | 无 | 缺失 → 启动失败（`腾讯云短信缺少必需环境变量：…`） |
| `TENCENT_SMS_SDK_APP_ID` / `TENCENT_SMS_SIGN_NAME` / `TENCENT_SMS_TEMPLATE_ID` | `SMS_PROVIDER=tencent` 时必填 | 同上 | 无 | 同上 |
| `TENCENT_SMS_REGION` / `TENCENT_SMS_ENDPOINT` | 可选 | 同上 | `ap-guangzhou` / `sms.tencentcloudapi.com` | 内网或专线部署时覆盖 endpoint |
| `ADMIN_WEB_ORIGIN` | 建议 | `main.ts` CORS 白名单 | 空 = 关闭 CORS | 未配置时浏览器端登录会被 CORS 拦 |
| `H5_ORIGIN` | 建议 | `main.ts` CORS 白名单 | 同上 | 同上 |
| `EVIDENCE_ROOT` | 建议 | `slot-session.controller.ts` 等 | `<cwd>/data/evidence` | 生产建议 `/app/data/evidence`（挂卷，否则证据文件落在容器可写层） |
| `REDIS_URL` | 可选 | `health.service.ts` 等 | 空 = `/ready` 显示 `redis: skipped` | 生产是否需要必填未核实（本轮不宣称） |
| `OUTBOX_POLL_MS` | 可选 | `background/bootstrap.ts` | `5000` | — |
| `ORDER_CONFIRM_TIMEOUT_MS` | 可选 | `background/bootstrap.ts` | `900000` | 只影响 CLASSIC 订单 |
| `DISPATCH_ROUND_WINDOW_MS` | 可选 | `game-dispatch/domain/dispatch-window.ts`（api 建轮次、worker 读默认） | `600000`（10 分钟），范围 60000–7200000 | 非法/越界回退默认并在启动日志 `warn` |
| `DISPATCH_NO_APPLICATION_TIMEOUT_MS` | 可选 | `background/bootstrap.ts` | **缺省跟随 `DISPATCH_ROUND_WINDOW_MS`**（P3/D4 前为 300000）；显式 `0` = 关闭该规则 | 非法/负数视为未配置 |

## 3. 商家端构建期（admin 镜像 build args）

`NEXT_PUBLIC_*` 是**构建期内联**，改值必须重新 build；本地 Turbopack 会复用 `.next/cache`，
改端口时要先清 `.next`（本轮走查已踩到）。

| 变量 | 读取点 | Dockerfile 默认 |
| --- | --- | --- |
| `NEXT_PUBLIC_API_ORIGIN` | `app/_lib/api.ts` 等 | `https://api.17ai.club` |
| `NEXT_PUBLIC_TENANT_HOST_SUFFIX` | 平台端开通门店页 | `17ai.club` |
| `NEXT_PUBLIC_WILDCARD_ROOT` | `(platform)/onboard/page.tsx` | 空 |
| `NEXT_PUBLIC_H5_ORIGIN` | `(platform)/onboard/page.tsx` | 空 |

## 4. `pw-init` 一次性初始化（种子）

| 变量 | 读取点 | 缺省 |
| --- | --- | --- |
| `SEED_TENANT_CODE` / `SEED_TENANT_NAME` / `SEED_TENANT_HOSTS` | `scripts/seed-prod.mjs` | — |
| `SEED_PLATFORM_PASSWORD` / `SEED_TENANT_PASSWORD` | `scripts/seed-prod.mjs` | — |
| `SEED_PLATFORM_USER` | `scripts/seed-*.mjs` | `admin` |

## 5. 仅本地/测试（不得进入生产 .env）

| 变量 | 用途 |
| --- | --- |
| `PW_TEST_MIGRATION_URL` / `PW_TEST_RUNTIME_URL` | 集成/隔离/契约测试的三套连接串 |
| `PW_S1B_REHEARSAL_DATABASE_URL` | `scripts/rehearse-game-dispatch-template-s1b.mjs`（未配置即报错） |
| `TARO_ENV` | 移动端构建环境判定 |

## 6. 与 `env.prod.example` / `compose.prod.yml` 的差异与结清状态

（P2 本机 Linux 容器冒烟，一次性 `pw-saas-smoke` 栈 + 全新库；见 `docs/runbooks/production-deploy.md` 的记录。）

| 缺口 | 影响 | 结清状态 |
| --- | --- | --- |
| compose api 未传 `SMS_PROVIDER` / `ALLOW_MOCK_SMS` | 生产 `NODE_ENV=production` 下 SMS mock 守卫硬失败 → api 容器崩溃循环，admin/h5 因依赖不健康一并起不来 | **已证实并已修**（compose 传值，默认 `ALLOW_MOCK_SMS` 仍 fail-closed；`.env` 显式 `true` 才允许演示） |
| `env.prod.example` 缺 `ALLOW_MOCK_SMS`、`SMS_PROVIDER` | 照模板填也会踩上面那条 | **已修**（模板补两项并注释） |
| `env.prod.example` 缺 `OUTBOX_POLL_MS`、`ORDER_CONFIRM_TIMEOUT_MS`、`DISPATCH_NO_APPLICATION_TIMEOUT_MS` | 只能用代码默认值（5s / 15min / 5min） | **已补进模板**（值仍是代码默认，是否符合运营预期待产品决定） |
| compose worker 未传 `ADMIN_WEB_ORIGIN`/`H5_ORIGIN`/`EVIDENCE_ROOT` | — | **已推翻**：worker 实测启动与运行日志正常，不需要这些变量，compose 保持原样 |
| 首次部署缺 `pw` 角色引导 | 迁移 `20260906000100_tenancy` 内 `ALTER DEFAULT PRIVILEGES FOR ROLE pw` 报 `role "pw" does not exist`（P3018 / 42704），迁移中断 | **已修**：新增 `infra/docker/bootstrap-owner.sql`，写入手册第 2 步 |
| owner=pw_saas 时运行时授权缺失 | 64 张带 `tenant_isolation_runtime` 策略的表只有 2 张对 `pw_runtime` 可读（本地 owner=pw 时是 64/64，本地看不出来） | **已修**：新增 `infra/docker/grant-runtime.sql`（幂等），手册第 5 步执行后 64/64 |
| 迁移给 `pw_runtime` 的是硬编码开发口令 | 不改口令时 api 登录 500（凭据无效） | **已入手册**：第 4 步 `ALTER ROLE pw_runtime`，冒烟实测必需 |
| 生产对象存储 / 托管 PostgreSQL / 真实支付 Provider / 生产主机本身 | 当前形态仍是本机 Postgres + 本地卷存证据 + mock 支付 | 后续项（runbook 已登记待办，本轮未验证） |
| 真实短信通道 | 代码侧已完成（`SMS_PROVIDER=tencent` + TC3 签名 adapter + compose/env 模板带齐变量） | **代码侧完成**；真实送达需资质与密钥，本机未验证（S2） |
| CI 不构建镜像、不起容器 | 上述三个容器缺陷 CI 全都拦不住 | 未处理（待决定是否新增 CI 容器冒烟 job） |

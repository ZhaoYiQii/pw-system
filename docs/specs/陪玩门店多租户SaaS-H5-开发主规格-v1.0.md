# 陪玩门店多租户 SaaS + H5 第一期开发主规格与 AI 实施计划

Goal: 建设一套面向多家陪玩门店销售的多租户 SaaS，第一期交付平台运营后台、门店后台和 H5 客户/陪玩端，并从第一天保证未来独立微信小程序只增加平台适配与门店授权配置，不重构核心业务、数据库或页面流程。

Architecture: 使用 TypeScript 单体仓库与 NestJS 模块化单体后端；所有门店共享一套应用和数据库结构，通过强制租户上下文、复合约束与 PostgreSQL 行级安全实现数据隔离。移动端统一采用 Taro React 编写，同时持续构建 H5 与微信小程序产物；微信登录、支付、分享、通知、文件选择等差异全部封装在平台适配层。

Tech stack: Node.js 24 LTS、pnpm 10、TypeScript strict、Next.js 16、React 19、NestJS 12（ESM + Express）、Taro 4（React）、Prisma ORM 7、PostgreSQL 18、Redis + BullMQ、Zod、OpenAPI、Vitest、Playwright、Docker Compose。

Spec: 本文件第 1—19 章；依据用户于 2026-09-06 确认的“多租户 SaaS + H5 第一期上线、独立小程序仅做适配层”方向。

Scope and non-goals: 第一期包含租户开通、权限、陪玩与客户、服务目录、订单、派单、计时证据、核算结算、审计通知、基础 AI 辅助和 H5 上线准备；不包含真实线上收款、自动向陪玩或门店打款、微信小程序提交发布、自由陌生人社交、直播语音房、代练代打、每店独立代码分支、微服务拆分。

Permission gates: 安装依赖、创建 Git 仓库或分支、提交或推送代码、下载或运行安全扫描器、连接云服务、执行远程数据库迁移、上传源码、部署 H5、开通微信支付、提交或发布小程序均需分别取得当次、目标明确的授权。本文件本身不授予这些权限。

Completion evidence: 规定的 lint、类型检查、单元测试、数据库集成测试、API 契约测试、租户隔离测试、Playwright H5 端到端测试、H5 构建和微信小程序构建必须在同一版本上全部成功；人工验收清单必须有记录；缺少微信 AppID 时只能声称“微信构建通过”，不得声称“小程序实机验证或已上线”。

---

## 0. 文档状态与 AI 使用协议

- 文档版本：1.0
- 基线日期：2026-09-06
- 架构方向：已确认
- 本详细规格状态：待产品负责人书面审核
- 代码实施授权：未包含在本次文档编写请求中
- 目标读者：产品负责人、技术负责人、开发工程师、测试工程师、执行开发任务的 AI

执行 AI 必须遵守以下顺序：

1. 完整读取本文件，不得只读取当前切片。
2. 读取项目根目录及更近层级的 `AGENTS.md`、现有 ADR、数据库迁移和测试约定。
3. 报告当前仓库状态、已存在技术栈、可用命令和冲突点。
4. 只领取一个被用户明确授权的切片，不得自动推进下一个切片。
5. 先建立失败测试或明确的前置证据，再修改产品代码。
6. 只修改该切片列出的文件；发现需要越界时立即停止并说明原因。
7. 执行该切片的验证命令，读取完整退出码和关键输出。
8. 用“已改代码、已本地验证、已提交、已推送、已部署、已生产验证”精确描述状态，禁止混用。

任何 AI 都不得承诺“零幻觉”。本规格通过以下机制降低幻觉和返工：

- 证据优先级固定为：当前仓库与迁移文件 > 已批准规格与 ADR > 锁定版本的官方文档 > 新鲜测试输出 > 推断。
- 推断不能作为实现依据。缺少字段、接口、版本、账号、资质或业务规则时必须停止并提出一个具体问题。
- 不允许凭记忆猜测第三方 SDK 方法、环境变量、微信接口、支付接口或数据库行为；必须查对应锁定版本的官方文档。
- 不允许创建“看似成功”的空实现、始终返回成功的 provider、吞掉异常的 `catch`、跳过测试或伪造命令输出。
- 开发/测试 Fake Provider 必须在生产环境启动时硬失败，不能静默启用。
- 测试失败后只允许提出一个可证伪假设并执行最小诊断；连续三个假设失败必须回到设计，不得继续盲改。

---

## 1. 业务术语与系统边界

为避免“老板”一词在不同场景混淆，代码、数据库和 API 使用以下固定术语：

| 中文业务称谓 | 系统术语 | 含义 |
|---|---|---|
| 你的公司 | Platform | SaaS 运营方，不直接作为每笔陪玩服务的提供者 |
| 陪玩店 | Tenant / Store | 购买 SaaS 的门店，是业务与数据隔离边界 |
| 店老板 | Tenant Owner | 门店最高管理员 |
| 客服 | Customer Service Agent | 确认需求、派单、调整订单 |
| 财务 | Finance Operator | 核算与结算复核 |
| 陪玩 | Player | 报名并完成游戏陪伴服务的人 |
| 来下单的“老板” | Customer | 购买服务的客户 |
| 一笔需求 | Order | 客户的一次业务订单 |
| 一次实际开玩记录 | Service Session | 订单中的一次服务场次，可开始、结束、补时或调整 |
| 报名 | Application | 陪玩针对订单的候选申请 |
| 选人结果 | Assignment | 订单与最终陪玩的绑定 |
| 截图 | Evidence Asset | 开始、结束或争议处理的证据文件 |
| 陪玩应收 | Earning | 根据已确认场次形成的应付金额 |
| 周结/月结单 | Settlement Batch | 门店对一个或多个陪玩的结算批次 |

平台不是公开的多门店交易市场。第一期每个 H5 入口只展示一个门店，客户不能跨门店搜索陪玩，门店之间不能共享客户、订单、陪玩或资金数据。

---

## 2. 成功标准与明确非目标

### 2.1 第一期成功标准

1. 平台人员可以在 15 分钟内通过配置开通一家新门店，无需改代码、复制数据库或重新部署后端。
2. 门店可以配置品牌、人员、游戏服务、价格、派单规则和结算周期。
3. 客服可以从需求确认一直处理到服务完成和待结算。
4. 陪玩可以在 H5 中报名、确认指派、开始、结束、上传截图并查看收入。
5. 客户可以在 H5 中确认需求、查看候选人、选人、查看过程、确认完成和发起售后。
6. 所有金额、时长、状态变化和人工调整均可追溯。
7. 任意跨租户读取、更新、关联和文件访问均被拒绝并有测试覆盖。
8. 相同移动端源码在 CI 中同时通过 H5 与微信小程序生产构建。
9. 未来启用独立小程序时，仅新增或配置微信平台适配器、AppID 映射、隐私配置和发布流程。

### 2.2 第一期非目标

- 不做客户充值余额或储值卡。
- 不做微信、支付宝真实在线收款。
- 不做自动向陪玩转账或代门店清算。
- 不做陪玩自主开店、自主定价或直接向客户收款。
- 不做公开动态、陌生人私信、附近的人、恋爱陪聊、语音房或直播。
- 不做代练、代打、账号租售、外挂或代登录客户游戏账号。
- 不做可执行脚本式工作流、任意低代码页面或租户自定义 SQL。
- 不为单个门店创建独立代码分支、独立业务逻辑或独立数据库。
- 不在第一期拆分微服务、Kafka、Kubernetes 或复杂事件溯源系统。

---

## 3. 架构总览

```text
                           ┌───────────────────────┐
                           │ Platform Admin Web    │
                           │ SaaS运营、租户、套餐  │
                           └───────────┬───────────┘
                                       │
┌───────────────────────┐   ┌─────────▼───────────┐   ┌───────────────────────┐
│ Tenant Admin Web      │   │ NestJS Modular      │   │ Taro Mobile App       │
│ 门店后台              ├──►│ Monolith API        │◄──┤ H5 / WeChat Mini      │
└───────────────────────┘   └─────────┬───────────┘   └───────────────────────┘
                                      │
                     ┌────────────────┼────────────────┐
                     │                │                │
             ┌───────▼───────┐ ┌─────▼─────┐ ┌────────▼────────┐
             │ PostgreSQL 18 │ │ Redis     │ │ Object Storage │
             │ 数据与账本    │ │ Queue     │ │ 截图与附件     │
             └───────┬───────┘ └─────┬─────┘ └─────────────────┘
                     │               │
               ┌─────▼───────────────▼────┐
               │ Worker / Outbox / AI     │
               │ 通知、提醒、AI异步任务   │
               └──────────────────────────┘
```

### 3.1 核心架构决策

| ADR | 决策 | 原因 |
|---|---|---|
| ADR-001 | 模块化单体，不使用微服务 | 保持事务一致性和交付速度，避免早期分布式复杂度 |
| ADR-002 | 共享数据库、共享 Schema、行级租户隔离 | 新增门店成本低，统一迁移和运维 |
| ADR-003 | 管理后台使用 Next.js，移动端使用 Taro React | 后台适合数据密集 Web；移动端可同时产出 H5 和小程序 |
| ADR-004 | 所有微信/H5差异通过适配器 | 未来小程序不触碰领域业务和页面用例 |
| ADR-005 | 配置与套餐功能开关代替客户分支 | 一套代码支持所有门店差异 |
| ADR-006 | PostgreSQL 为唯一业务事实源 | Redis、搜索和报表不能反向覆盖业务事实 |
| ADR-007 | 订单、场次、结算使用独立状态机 | 避免一个状态字段承担多种语义 |
| ADR-008 | 金额使用整数分，时长使用整数秒 | 禁止浮点金额与字符串时长造成误差 |
| ADR-009 | 业务写入与 Outbox 同事务 | 防止订单成功但通知/AI任务丢失 |
| ADR-010 | AI 只给建议，不直接改钱、封禁、结算 | 保留人工责任和审计能力 |
| ADR-011 | API 以 OpenAPI 为契约并生成客户端 | 防止前后端自行猜测字段和接口 |
| ADR-012 | 数据迁移使用 expand-contract | 支持安全回滚，禁止同版本破坏性迁移 |

所有 ADR 必须保存到 `docs/adr/`。修改 ADR 的 AI 必须先说明被新证据推翻的原决策，等待产品负责人批准后再修改。

---

## 4. 技术基线与版本规则

### 4.1 固定技术栈

| 层 | 技术基线 | 约束 |
|---|---|---|
| Runtime | Node.js 24 LTS | 使用 24.15 或更高的 24.x；不使用 Current 非 LTS 版本 |
| Package manager | pnpm 10.x | 根 `package.json` 固定 `packageManager`；只保留一个 lockfile |
| Language | TypeScript strict | 开启 `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes` |
| Monorepo | pnpm workspaces + Turborepo | 不使用多个包管理器 |
| Admin Web | Next.js 16 App Router + React 19 | 平台后台和门店后台为一个应用的两个隔离入口 |
| Admin UI | Tailwind CSS + shadcn/ui + TanStack Table | 组件留在仓库内；不得从运行时远程加载组件代码 |
| Mobile | Taro 4 + React 19 | 同源产出 H5 和 `weapp`；业务代码禁止直接调用 `window` 或 `wx` |
| API | NestJS 12 ESM + Express adapter | 控制器只处理协议；领域规则不得写在控制器 |
| Validation | Zod 4 + Nest Standard Schema | 所有入口做结构、长度、枚举和范围校验 |
| API contract | OpenAPI 3.0 + generated TypeScript client | 客户端不得手写重复请求类型 |
| ORM | Prisma ORM 7.x | 锁定 7.x，禁止执行 AI 记忆中的 Prisma 8 API |
| Database | PostgreSQL 18.6 | 生产不可用时允许 17.11，但必须形成 ADR 并保持开发/CI/生产主版本一致 |
| Cache/queue | Redis 7+ + BullMQ | Redis 不保存唯一业务事实；任务必须幂等 |
| Unit/integration | Vitest + Nest testing + Supertest | Nest 12 使用 Vitest，不混用 Jest |
| Browser E2E | Playwright | Chromium 为阻断门禁；WebKit 和移动视口为发布门禁 |
| Local infrastructure | Docker Compose v2 | PostgreSQL、Redis 和 S3 兼容开发存储 |
| Object storage | S3-compatible provider adapter | 本地使用 MinIO；生产可接 COS/OSS，不向领域层暴露 SDK |
| Observability | OpenTelemetry-compatible tracing + structured logs | 日志必须包含 requestId 和 tenantId，禁止记录凭据及完整隐私数据 |

### 4.2 版本锁定规则

1. Slice 0 只允许在取得依赖安装授权后解析确切 patch 版本。
2. 解析版本时只使用官方文档和官方包注册表；把结果写入 `docs/adr/0000-version-baseline.md`。
3. `package.json` 使用精确版本，不使用 `latest`、`*`、`^` 或 `~`。
4. `pnpm-lock.yaml` 是唯一依赖事实源；任何升级单独成任务，不能夹在功能切片里。
5. Prisma 固定 7.x。升级到 Prisma 8 属于架构迁移，必须有独立设计、迁移计划和回归测试。
6. Node 使用 `.nvmrc`、`.node-version` 和 `package.json#engines` 三处一致声明 24.x。
7. CI 必须拒绝 lockfile 漂移和非锁定 Node 版本。

官方基线参考：

- [Node.js 发布与 LTS 状态](https://nodejs.org/en/about/previous-releases)
- [Next.js 16 安装要求](https://nextjs.org/docs/app/getting-started/installation)
- [NestJS 12 Node.js 要求](https://docs.nestjs.com/first-steps)
- [Taro H5 与微信小程序构建命令](https://docs.taro.zone/docs/GETTING-STARTED)
- [NestJS OpenAPI 与 Standard Schema](https://docs.nestjs.com/openapi/introduction)
- [PostgreSQL 18 行级安全](https://www.postgresql.org/docs/18/ddl-rowsecurity.html)
- [Playwright 测试项目](https://playwright.dev/docs/test-projects)

---

## 5. 目标仓库结构

```text
/
├─ apps/
│  ├─ api/
│  │  ├─ src/
│  │  │  ├─ bootstrap/
│  │  │  ├─ common/
│  │  │  └─ modules/
│  │  └─ test/
│  ├─ worker/
│  │  ├─ src/
│  │  └─ test/
│  ├─ admin-web/
│  │  ├─ app/(platform)/
│  │  ├─ app/(tenant)/
│  │  ├─ components/
│  │  └─ test/
│  └─ mobile/
│     ├─ src/pages/customer/
│     ├─ src/pages/player/
│     ├─ src/platform/contracts/
│     ├─ src/platform/h5/
│     ├─ src/platform/weapp/
│     ├─ src/features/
│     └─ test/
├─ packages/
│  ├─ api-client/
│  ├─ config-schema/
│  ├─ database/
│  │  ├─ prisma/schema.prisma
│  │  ├─ prisma/migrations/
│  │  └─ src/
│  ├─ domain-kernel/
│  ├─ test-fixtures/
│  ├─ ui-tokens/
│  ├─ eslint-config/
│  └─ tsconfig/
├─ tests/
│  ├─ contract/
│  ├─ integration/
│  ├─ tenant-isolation/
│  ├─ e2e/
│  └─ performance/
├─ infra/
│  ├─ docker/docker-compose.yml
│  ├─ docker/api.Dockerfile
│  ├─ docker/worker.Dockerfile
│  └─ docker/admin-web.Dockerfile
├─ docs/
│  ├─ adr/
│  ├─ api/
│  ├─ runbooks/
│  └─ acceptance/
├─ .github/workflows/ci.yml
├─ package.json
├─ pnpm-workspace.yaml
├─ turbo.json
├─ tsconfig.base.json
└─ .env.example
```

`packages/api-client` 只能由 OpenAPI 生成，不允许手工修改生成文件。后端领域实体不得共享给前端；前端只依赖公开契约。

---

## 6. 模块边界

每个后端模块采用：

```text
module-name/
├─ domain/          实体、值对象、状态机、领域事件；不得依赖 Nest 或 Prisma
├─ application/     用例、命令、查询、端口接口
├─ infrastructure/  Prisma repository、provider 实现
├─ interface/       HTTP controller、schema、presenter
└─ module.ts        Nest 组装，只导出公开 application port
```

### 6.1 核心模块

| 模块 | 责任 | 不得承担 |
|---|---|---|
| `tenancy` | 租户、域名、AppID绑定、状态、时区 | 订单和用户业务 |
| `identity-access` | 登录、会话、账号、角色、权限 | 租户识别和业务审批 |
| `entitlements` | 套餐、功能开关、额度 | UI自行判断后的安全授权 |
| `tenant-config` | 品牌、流程、结算、通知配置及版本 | 任意脚本与自定义 SQL |
| `customers` | 客户档案、备注、黑名单 | 订单状态 |
| `players` | 陪玩档案、技能、接单状态 | 订单价格与结算 |
| `catalog` | 游戏、区服、服务产品、统一售价和陪玩成本规则 | 历史订单价格修改 |
| `orders` | 需求、报价快照、订单主状态机 | 报名、场次和资金混写 |
| `dispatch` | 发布、报名、候选、选人、指派锁 | 修改订单金额 |
| `service-sessions` | 开始、结束、时长、调整、证据关联 | 直接形成结算付款 |
| `files` | 上传授权、元数据、对象键、访问权限 | 信任用户文件名或 MIME 声明 |
| `ledger` | 平衡账本、收入与陪玩应付 | 直接调用支付 SDK |
| `settlements` | 结算批次、复核、确认、冲正 | 修改已入账记录 |
| `disputes` | 客诉、证据、处理结果、结算冻结 | 隐式回退订单状态 |
| `notifications` | 站内通知、短信/微信 provider、重试 | 决定业务状态 |
| `audit` | 不可变操作审计 | 存储密码、token、截图内容 |
| `ai-assistant` | 需求抽取、匹配建议、异常提示、报告 | 自主改价、封禁、结算或支付 |
| `reporting` | 只读聚合、经营指标 | 作为交易事实源 |

模块之间只能通过公开 application port、领域事件或只读投影交互。禁止跨模块直接 import 对方 repository 或 Prisma model。

---

## 7. 角色与授权模型

### 7.1 固定角色

- `PLATFORM_SUPER_ADMIN`：管理租户和平台配置；生产跨租户数据访问必须写审计理由。
- `PLATFORM_SUPPORT`：默认不能查看订单截图和财务明细；临时授权有过期时间。
- `TENANT_OWNER`：单租户最高权限，不可管理其他租户。
- `TENANT_ADMIN`：人员、目录、流程配置。
- `CUSTOMER_SERVICE`：客户、订单、派单、场次调整申请。
- `FINANCE`：核算、结算复核和确认，不能篡改场次证据。
- `PLAYER`：仅查看可见订单、自己的报名、指派、场次和收入。
- `CUSTOMER`：仅查看自己的需求、候选、订单、证据摘要与售后。

### 7.2 授权规则

1. 默认所有 API 需要认证；公开路由必须使用显式 `@Public()` 并有测试。
2. 每次授权同时检查：主体、租户、角色、资源归属、订单状态、套餐权限。
3. 前端隐藏按钮不是授权；后端必须重复检查。
4. 平台员工和门店员工使用不同 token audience，不能互换。
5. 支持人员跨租户查看必须输入原因、选择时长、生成审计事件；第一期禁止支持人员跨租户写入。
6. 客服调整时长或金额后，财务角色必须复核；同一账号不能同时发起和批准自己的财务调整。

---

## 8. 多租户隔离规范

### 8.1 租户解析

`TenantContext` 只能由服务端根据可信来源生成：

```ts
type TenantContext = {
  tenantId: string;
  tenantCode: string;
  source: 'host' | 'app_binding' | 'platform_scope';
  requestId: string;
};
```

可信来源：

- H5：已验证域名或平台生成的门店短码。
- 微信小程序：服务端维护的 AppID / ext tenant code 绑定。
- 门店后台：登录会话中的 tenant membership 与访问域名同时匹配。
- 平台后台：专用 platform token 和显式 platform scope。

请求 Body、Query、Header 中由客户端自由传入的 `tenantId` 不能决定租户。若接口路径需要租户编码，必须与已解析 `TenantContext` 再次比对。

### 8.2 数据库隔离

1. 所有租户业务表必须有 `tenant_id UUID NOT NULL`。
2. 所有唯一约束优先包含 `tenant_id`，例如 `(tenant_id, order_no)`。
3. 跨业务表外键同时包含 `tenant_id`，防止把 A 店订单关联到 B 店陪玩。
4. PostgreSQL 对租户表启用并强制 RLS；无匹配 policy 时默认拒绝。
5. 运行时数据库角色不是表 owner，且不得拥有 `BYPASSRLS`。
6. 每个业务事务执行 `SET LOCAL app.tenant_id = <uuid>`，所有查询必须使用同一事务连接。
7. 数据迁移使用独立 migration role；应用运行时凭据无 DDL 权限。
8. 平台跨租户操作使用独立数据库角色与专用 repository，且每次写入 audit log。
9. RLS 不是唯一防线；application repository 仍显式携带 `tenantId`。
10. 租户隔离测试必须覆盖读、写、更新、删除、唯一约束、外键、文件下载和队列消费者。

PostgreSQL 官方说明表 owner 和具有 `BYPASSRLS` 的角色会绕过行级安全，因此运行时角色配置和 `FORCE ROW LEVEL SECURITY` 属于阻断性验收项。

### 8.3 配置层级

```text
Platform Default
  → Product Package Default
    → Tenant Override
      → Time-bounded Campaign Override
```

有效配置必须由 `packages/config-schema` 的 Zod schema 解析。无效配置拒绝保存；读取到历史无效配置时门店进入 `CONFIG_ERROR`，相关功能失败关闭，不使用猜测默认值。

---

## 9. 功能模块与套餐权限

### 9.1 永久启用的核心功能

- `core.tenancy`
- `core.identity`
- `core.audit`
- `core.customers`
- `core.players`
- `core.catalog`
- `core.orders`
- `core.dispatch`
- `core.sessions`
- `core.settlements`

### 9.2 可销售的增值功能

- `addon.customer_self_service`
- `addon.player_order_hall`
- `addon.ai_requirement_parser`
- `addon.ai_match_recommendation`
- `addon.ai_anomaly_detection`
- `addon.advanced_reports`
- `addon.custom_domain`
- `addon.independent_miniprogram`
- `addon.online_payment`
- `addon.enterprise_wechat_notifications`
- `addon.chain_stores`
- `addon.open_api`

功能开关必须同时控制：

1. 后端用例授权。
2. API 暴露行为。
3. 前端菜单和路由。
4. 异步任务创建。
5. 用量记录。

仅隐藏前端菜单但 API 仍可用，视为严重缺陷。

---

## 10. 状态机与业务不变量

### 10.1 订单状态

```text
DRAFT
  → CONFIRMED
  → DISPATCHING
  → ASSIGNED
  → READY
  → IN_PROGRESS
  → PENDING_CONFIRMATION
  → COMPLETED

DRAFT / CONFIRMED / DISPATCHING / ASSIGNED / READY
  → CANCELLED
```

| 迁移 | 允许角色 | 必要条件 |
|---|---|---|
| `DRAFT → CONFIRMED` | 客服、客户 | 需求字段完整；价格快照已生成 |
| `CONFIRMED → DISPATCHING` | 客服 | 至少一个有效服务项目；计划时间有效 |
| `DISPATCHING → ASSIGNED` | 客服、客户选人用例 | 候选申请有效；陪玩未冲突；原子创建唯一指派 |
| `ASSIGNED → READY` | 客服、陪玩 | 陪玩确认；客户未取消 |
| `READY → IN_PROGRESS` | 陪玩、客服代操作 | 创建场次开始事件；记录服务器时间和操作者 |
| `IN_PROGRESS → PENDING_CONFIRMATION` | 陪玩、客服代操作 | 已结束场次；必要截图齐全；计算时长 |
| `PENDING_CONFIRMATION → COMPLETED` | 客户、客服超时确认用例 | 金额核算完成；无开放争议 |
| 可取消状态 `→ CANCELLED` | 有权限主体 | 记录原因、责任方和费用影响 |

禁止直接更新状态字段。唯一入口是状态机用例；每次迁移写入 `order_events` 和 `audit_logs`。

### 10.2 报名状态

```text
APPLIED → SHORTLISTED → SELECTED
APPLIED / SHORTLISTED → WITHDRAWN | REJECTED | EXPIRED
```

同一陪玩对同一订单只能有一个有效报名；订单一旦指派，其余报名原子变为 `EXPIRED`。

### 10.3 场次状态

```text
SCHEDULED → STARTED → ENDED → CONFIRMED
                         └──→ ADJUSTMENT_PENDING → CONFIRMED
```

- 开始与结束使用服务器接收时间。
- 客户端时间仅保存为诊断字段，不参与默认计费。
- 重复点击开始或结束必须通过 idempotency key 返回同一结果。
- 调整不能覆盖原始时间；新增 adjustment 记录并保留调整前后值、原因、发起人、复核人。

### 10.4 结算状态

```text
DRAFT → REVIEWED → APPROVED → PAID
   └──────────────→ VOID
```

- `PAID` 后不得编辑；错误通过 reversal 和新批次修正。
- 存在开放争议的 earning 不能进入批次。
- 发起人不能批准自己的结算批次。

### 10.5 金额与时长不变量

- 货币固定 `CNY`，金额保存为 `bigint` 分。
- 时长保存为整数秒；展示时再转换小时/分钟。
- 价格快照包含售价、陪玩成本、取整规则、优惠和配置版本。
- 历史订单不读取当前目录价格重新计算。
- 任一账本 transaction group 的借方总额必须等于贷方总额。
- 账本记录只追加，不更新、不删除。

---

## 11. 数据模型基线

下列模型名称是实现契约。AI 不得自行改名、合并或增加替代实体；确有必要时先提交 ADR。

### 11.1 平台与租户

- `platform_accounts`
- `tenants`
- `tenant_domains`
- `tenant_app_bindings`
- `tenant_accounts`
- `tenant_account_roles`
- `tenant_entitlements`
- `tenant_config_versions`
- `tenant_subscriptions`

### 11.2 人员与目录

- `customer_profiles`
- `player_profiles`
- `player_skills`
- `player_availability`
- `games`
- `game_regions`
- `service_products`
- `pricing_rules`

### 11.3 订单与履约

- `orders`
- `order_requirements`
- `order_price_snapshots`
- `order_events`
- `dispatch_publications`
- `applications`
- `assignments`
- `service_sessions`
- `session_events`
- `session_adjustments`
- `evidence_assets`
- `disputes`
- `dispute_events`

### 11.4 财务、异步与治理

- `ledger_accounts`
- `ledger_transactions`
- `ledger_entries`
- `earnings`
- `settlement_batches`
- `settlement_items`
- `manual_payment_records`
- `idempotency_records`
- `outbox_events`
- `notification_deliveries`
- `ai_runs`
- `ai_suggestions`
- `audit_logs`
- `refresh_sessions`

### 11.5 必要字段约定

所有租户业务表至少包含：

```text
id UUID
tenant_id UUID
created_at timestamptz
updated_at timestamptz
version integer
```

不可变事件和账本表不含 `updated_at`。业务编号如 `order_no` 只在租户内唯一。删除采用明确状态或 `deleted_at`；账本、审计、订单事件、场次事件不得软删或硬删。

索引至少覆盖：

- `(tenant_id, status, created_at DESC)`
- `(tenant_id, customer_id, created_at DESC)`
- `(tenant_id, player_id, status, scheduled_at)`
- `(tenant_id, order_no)` 唯一
- `(tenant_id, idempotency_key, operation)` 唯一
- `outbox_events(status, available_at)`

---

## 12. API 契约

### 12.1 基础规范

- 基础路径：`/api/v1`
- 数据格式：JSON；文件采用受控 multipart 或预签名直传。
- 时间：ISO 8601 UTC，数据库使用 `timestamptz`。
- 金额：JSON 中使用十进制字符串表示分，避免 JavaScript 大整数精度丢失。
- 分页：cursor-based；禁止无上限列表。
- 写接口：支持 `Idempotency-Key`。
- 并发修改：实体带 `version`，冲突返回 HTTP 409。
- 认证失败：401；授权失败：403；租户资源不存在对外统一返回 404，避免枚举。

### 12.2 错误结构

```json
{
  "type": "/problems/order-transition",
  "title": "Order transition rejected",
  "status": 409,
  "code": "ORDER_STATE_CONFLICT",
  "detail": "The order is no longer in DISPATCHING state.",
  "requestId": "req_01JY7X2M8FK7A6N4P3Q2R1S0TV",
  "fieldErrors": []
}
```

`type` 第一期统一使用仓库内相对问题标识 `/problems/{problem-code}`；只有在正式 API 文档域名已经配置并通过契约测试后，才允许整体切换为绝对 URI。

### 12.3 接口分组

- `/platform/tenants`
- `/platform/subscriptions`
- `/auth/*`
- `/tenant/config`
- `/tenant/accounts`
- `/customers`
- `/players`
- `/catalog/*`
- `/orders`
- `/orders/{orderId}/transitions`
- `/orders/{orderId}/applications`
- `/orders/{orderId}/assignment`
- `/orders/{orderId}/sessions`
- `/sessions/{sessionId}/events`
- `/files/upload-intents`
- `/settlements`
- `/disputes`
- `/notifications`
- `/ai/suggestions`

每个 operation 必须有稳定 `operationId`，生成到 `packages/api-client`。CI 比较生成结果；存在未提交契约差异即失败。

---

## 13. H5 与微信小程序适配契约

这是“未来小程序不重构”的核心约束。

### 13.1 平台能力接口

`apps/mobile/src/platform/contracts/` 必须声明以下小接口：

```ts
export type RuntimeKind = 'h5' | 'weapp';

export interface IdentityAdapter {
  login(input: LoginInput): Promise<LoginResult>;
  refresh(): Promise<LoginResult>;
  logout(): Promise<void>;
}

export interface TenantLocatorAdapter {
  resolveHint(): Promise<{
    runtime: RuntimeKind;
    host?: string;
    appId?: string;
    extTenantCode?: string;
  }>;
}

export interface MediaAdapter {
  chooseImages(input: { maxCount: number }): Promise<LocalMedia[]>;
  upload(input: UploadIntent): Promise<UploadedMedia>;
}

export interface ShareAdapter {
  shareOrder(input: { orderId: string; title: string }): Promise<void>;
}

export interface NotificationPermissionAdapter {
  request(input: { templateKeys: string[] }): Promise<PermissionResult>;
}

export interface PaymentAdapter {
  capabilities(): Promise<{ supported: boolean; reason?: string }>;
  pay(input: PaymentRequest): Promise<PaymentResult>;
}
```

Phase 1 的支付 entitlement 关闭。H5 `PaymentAdapter` 返回明确的 `unsupported` capability；页面不得显示假支付成功。Phase 2 获得支付方案批准后再实现真实 provider。

### 13.2 强制可移植规则

1. `apps/mobile/src/platform/h5/` 之外禁止访问 `window`、`document`、`navigator`、`localStorage`、浏览器文件对象。
2. `apps/mobile/src/platform/weapp/` 之外禁止访问 `wx` 或微信专属 SDK。
3. 页面和 feature 只能依赖 `platform/contracts`，不能判断 `TARO_ENV`；构建配置文件除外。
4. UI 基础节点优先使用 Taro `View`、`Text`、`Image`、`Button`、`Input`、`ScrollView`。
5. 不引入只支持 DOM 的移动端核心组件库。
6. H5 和 weapp 使用同一页面路由声明、同一 API client、同一状态机和同一表单 schema。
7. 每个移动端切片必须同时运行 `build:h5` 与 `build:weapp`。
8. ESLint 使用 `no-restricted-globals` 和 `no-restricted-imports` 阻断越界平台调用。
9. 适配器有 contract test，同一 Fake Adapter 测试业务页面行为。
10. 微信小程序上线时允许新增微信适配文件、AppID配置、隐私声明和审核资料，不允许复制业务页面或新增 `weapp-only` 业务流程。

### 13.3 独立小程序增值服务所需工作

当租户购买 `addon.independent_miniprogram`，执行的是：

1. 创建或授权租户自己的微信小程序主体与 AppID。
2. 在 `tenant_app_bindings` 绑定 AppID 与 tenantId。
3. 配置微信登录、订阅消息、合法域名、隐私协议和服务类目。
4. 启用 `weapp` 平台适配器。
5. 应用统一小程序代码模板与该租户品牌配置。
6. 运行微信开发者工具人工烟雾测试。
7. 取得独立授权后提交审核和发布。

不应修改订单、派单、场次、账本、结算、客户、陪玩或 API 核心模块。

---

## 14. 文件、证据与通知

### 14.1 文件安全

- 允许格式：JPEG、PNG、WebP。
- 单文件上限：10 MiB；一次最多 4 张。
- 不能只信任扩展名或请求 MIME，必须验证文件内容 magic bytes 并实际解码图片。
- 对象键由服务端生成：`tenant/{tenantId}/evidence/{yyyy}/{mm}/{uuid}`。
- 用户文件名只作为经过长度限制和字符清洗的展示元数据，不参与路径。
- 下载必须验证租户、角色和资源归属；对象存储 bucket 不公开。
- 预签名 URL 有效期不超过 5 分钟，且绑定对象键、大小和 content type。
- 上传完成后计算 SHA-256，用于重复截图提示，不作为真实性证明。
- 默认删除 EXIF 地理位置元数据；保留服务器上传时间。

### 14.2 通知可靠性

- 业务事务只写 `outbox_events`，不在数据库事务内调用短信、微信或 AI。
- Worker 至少一次消费；每个消费者按 eventId 幂等。
- 重试采用指数退避和最大次数；最终失败进入 dead-letter 状态并可人工重放。
- 通知失败不回滚已完成业务状态，但必须告警并在后台可见。
- Redis Pub/Sub 不承担可靠通知；可靠任务使用 BullMQ 持久化队列和数据库 Outbox。

---

## 15. AI 智能化设计

### 15.1 第一期 AI 能力

1. `RequirementParser`：把客服粘贴的客户文字转换为订单草稿。
2. `MissingFieldChecker`：列出缺失的游戏、区服、服务时间、时长、人数和预算信息。
3. `MatchRecommender`：按技能、可用时间、冲突、门店规则、历史完成率给出候选排序。
4. `AnomalyDetector`：提示时间重叠、异常时长、重复截图、价格偏离和频繁调整。
5. `SettlementSummary`：生成结算批次说明，不改变金额。

### 15.2 AI 输出契约

所有输出必须为结构化 schema：

```ts
type AiSuggestion<T> = {
  runId: string;
  type: string;
  status: 'SUGGESTED' | 'NEEDS_REVIEW' | 'REJECTED';
  confidence: number;
  data: T;
  evidenceRefs: string[];
  missingFields: string[];
  promptVersion: string;
  modelProvider: string;
  modelId: string;
};
```

AI 不得：

- 直接创建已确认订单。
- 编造不存在的价格、游戏、区服或陪玩能力。
- 绕过套餐、角色、租户或状态机。
- 修改账本、结算状态或支付状态。
- 自动处罚、封禁或裁定客诉。
- 把 A 店数据用于 B 店提示词或检索。

当输入缺少关键字段或 schema 校验失败，返回 `NEEDS_REVIEW`，不得用常识补齐。AI 每次建议保存 prompt 版本、模型、耗时、token 用量、输入摘要、输出和人工采纳结果；日志不保存完整手机号、token、密码或不必要截图内容。

### 15.3 AI Provider 边界

- 领域模块只调用 `AiProviderPort`。
- Provider endpoint、model 和密钥来自受控配置，不接受客户输入的任意 URL，防止 SSRF。
- 生产密钥只来自 secret manager 或环境注入，不写入源码、日志、错误响应或数据库明文。
- AI 超时或失败只影响建议，不阻塞订单主流程。
- 建立固定去标识化评测集；每次 prompt/model 变更运行回归评测。

---

## 16. 安全与隐私规则

### 16.1 身份与会话

- 密码使用平台成熟密码哈希实现，不自行设计加密算法。
- JWT 必须验证签名、issuer、audience、expiration 和 key id；禁止仅 decode。
- Access token 最长 15 分钟；refresh token 为高熵随机值，只在数据库保存哈希并轮换。
- H5 refresh token 使用 `HttpOnly`、`Secure`、`SameSite=Lax` host-only cookie；状态修改接口校验 Origin/Fetch Metadata 和 CSRF token。
- 微信小程序使用独立认证 transport，不把 H5 cookie 方案硬搬过去。
- 登出、密码修改、账号停用和租户停用必须撤销 refresh session。
- 登录、验证码、找回密码和高风险操作有速率限制与审计。

### 16.2 输入与输出

- 所有 API 输入通过 Zod schema 验证；额外字段默认拒绝。
- 禁止拼接 SQL；ORM raw SQL 只允许参数化并集中在 repository。
- 用户文本按纯文本渲染；禁止 `dangerouslySetInnerHTML`，确有富文本需求必须使用允许列表消毒并单独评审。
- 外部 URL 只允许预配置 provider host；禁止服务端抓取用户任意 URL。
- 文件路径和对象键由服务端生成，不接受客户端路径。
- 租户主题只能填写受限 design token，禁止自定义 JavaScript、CSS URL 或任意 HTML。

### 16.3 资金与并发

- 创建指派、开始场次、结束场次、形成 earning、加入结算批次均使用数据库事务与唯一约束。
- 不采用“先查询再写入”的无锁模式处理唯一指派或重复结算。
- 外部副作用必须在事务提交后通过 Outbox 执行。
- 支付 webhook 在 Phase 2 实现时必须验签、幂等、主动查单；客户端支付成功回调不能作为入账事实。

### 16.4 数据最小化

- 默认不采集身份证号、游戏账号密码、精确位置或通讯录。
- 手机号加密存储，另保存租户范围内不可逆查询哈希。
- 日志对手机号、OpenID、邮箱和地址做脱敏。
- 证据图片默认保留 365 天；开放争议和法定留存记录使用 legal hold，不自动删除。
- 用户数据导出和删除必须验证身份、记录审计，并排除依法或合同必须留存的账本与审计数据。

---

## 17. 可观测性、性能与恢复目标

### 17.1 日志与指标

结构化日志固定字段：

```text
timestamp, level, service, environment, requestId, traceId,
tenantId, actorId, actorRole, operationId, orderId, errorCode
```

禁止记录：密码、JWT、refresh token、API key、完整手机号、完整身份证、支付密钥、截图二进制和完整 AI 隐私输入。

阻断性指标：

- API 5xx 比例
- P95 / P99 延迟
- RLS 拒绝与跨租户测试结果
- 状态迁移冲突率
- Outbox 待处理数量和最老事件年龄
- BullMQ 重试与 dead-letter 数量
- 文件上传失败率
- AI schema 失败率与人工采纳率
- 账本不平衡检查结果

### 17.2 第一期容量验收基线

在 4 vCPU / 8 GiB API 节点、独立托管 PostgreSQL、100 个租户、100 万历史订单的种子数据下：

- 只读 API：100 RPS，P95 不高于 300 ms。
- 核心写 API：50 RPS，P95 不高于 500 ms。
- 错误率低于 0.5%，不包含预期 4xx。
- 队列在 1,000 个普通通知任务积压后 10 分钟内清空。
- 任意查询不得因为缺少 `tenant_id` 导致全表扫描；关键查询保存 `EXPLAIN ANALYZE` 证据。

容量目标是第一期工程验收基线，不是销售承诺。生产 SLA 需在真实云资源和监控数据基础上另行批准。

### 17.3 备份与回滚

- 生产数据库启用每日全量备份与不高于 15 分钟的时间点恢复能力。
- 目标 RPO：15 分钟；目标 RTO：4 小时。
- 每季度执行一次恢复演练并记录结果。
- 数据库迁移采用 expand-contract：先新增兼容结构，应用切换后观察，再在独立发布中删除旧结构。
- 同一发布不得同时删除数据库列并依赖新代码。
- 租户配置版本化，错误配置可回滚到上一已验证版本。
- 代码回滚不得反向执行可能丢数据的 down migration。

---

## 18. 开发规则与禁止项

### 18.1 TypeScript 与代码组织

- 全仓 `strict`，禁止无说明的 `any`、`@ts-ignore`、非空断言滥用。
- 导出的函数、类、schema 和事件必须显式类型。
- controller 不包含业务分支；repository 不包含业务决策。
- 领域层不得 import NestJS、Prisma、Taro、React、Redis 或云 SDK。
- 每个模块只通过自己的 `public.ts` 或 `index.ts` 暴露公共接口。
- 禁止循环依赖；发现循环依赖先调整边界，不能使用 `forwardRef` 掩盖设计问题。
- 单文件超过 400 行、单函数超过 50 行时必须解释并在评审中确认；声明式 schema 和映射表例外。
- 状态、角色、权限、事件名来自集中定义，禁止散落魔法字符串。
- 时间通过 `ClockPort`，UUID 通过 `IdGeneratorPort`，测试不得依赖真实当前时间或随机值。

### 18.2 数据与事务

- 金额禁止 `number` 元单位和浮点计算。
- 日期禁止保存本地时区字符串；数据库统一 UTC，显示按租户时区转换。
- Prisma 查询必须在 repository 中执行。
- 事务内所有查询使用同一 transaction client；不得在 transaction callback 中使用全局 client。
- 事务内不得发送短信、调用 AI、上传文件或请求支付接口。
- 所有列表必须有最大 page size，默认 20、最大 100。
- 所有更新使用 optimistic version 或数据库锁，不能静默覆盖并发修改。

### 18.3 前端

- 服务端状态使用 TanStack Query；不把服务端数据复制到全局 store。
- 本地跨页状态使用 Zustand；表单临时状态留在组件。
- 所有按钮在请求处理中禁用并防重复提交，但后端仍必须幂等。
- 权限和 feature flag 由服务端返回；前端仅用于展示，不能成为安全边界。
- 移动端禁止 platform API 越过适配层。
- 颜色、圆角、字号、间距使用 `packages/ui-tokens`，租户只能覆盖允许的 token。
- 页面必须处理 loading、empty、error、offline/retry、permission denied 五种状态。
- 表单错误必须映射到具体字段；不能只弹“操作失败”。

### 18.4 测试纪律

- 每个行为变更先写失败测试，再写最小实现，再重构。
- 禁止提交 `.only`、`.skip`、注释掉的断言或总是成功的测试替身。
- 测试必须验证行为和不变量，不能只验证函数被调用。
- 关键状态机、金额、时长、租户隔离和幂等分支达到 100% branch coverage。
- 全仓最低 coverage：statements 80%、branches 80%、functions 80%、lines 80%。
- 快照测试只用于稳定结构，不得用大快照替代业务断言。
- E2E 使用语义定位器和自动重试断言，不使用固定 sleep。

### 18.5 Git 与变更范围

- 每个切片独立评审；不混入依赖升级、格式化全仓或无关重构。
- 禁止隐式 `git add .`；提交仅包含任务拥有的路径，且提交动作需要单独授权。
- 迁移、API 契约和 feature flag 变更必须在变更说明中列出。
- 任何远程 push、部署、数据库迁移或小程序发布均需要独立授权。

---

## 19. 验收体系

### 19.1 根命令契约

Slice 0 必须在根 `package.json` 创建以下命令；之后所有切片复用：

```text
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:critical
pnpm test:integration
pnpm test:tenant-isolation
pnpm test:contract
pnpm test:e2e
pnpm build
pnpm build:h5
pnpm build:weapp
pnpm openapi:generate
pnpm openapi:check
pnpm db:migrate:check
pnpm db:seed:test
```

命令不存在、被替换为空命令或只打印成功均视为失败。

### 19.2 每个切片的验收循环

1. **Ready**：需求、角色、状态、输入输出、错误码、权限和租户边界明确。
2. **Red**：目标测试因缺少行为而失败，记录失败原因。
3. **Green**：最小实现使目标测试通过。
4. **Refactor**：消除重复，重新运行目标测试。
5. **Contract**：生成 OpenAPI 客户端并确认无未声明差异。
6. **Isolation**：运行相关跨租户负面测试。
7. **Portability**：移动端切片同时构建 H5 和 weapp。
8. **UI evidence**：用真实交互完成该切片最短路径，检查控制台错误。
9. **Review**：检查模块边界、安全、日志和迁移。
10. **Report**：列出文件、命令、退出码、证据和残余风险。

### 19.3 第一阶段最终验收矩阵

| 类别 | 必须证明 |
|---|---|
| 租户隔离 | A 店任何角色不能读取、修改、关联或下载 B 店数据 |
| 权限 | 客服不能批准财务调整；财务不能改原始场次；陪玩只能看自己的收入 |
| 状态机 | 非法迁移返回 409 且不产生部分写入 |
| 幂等 | 重复开始、结束、指派、结算请求只产生一个业务结果 |
| 并发 | 两名客服同时选人时只有一个指派成功；陪玩冲突被原子拒绝 |
| 金额 | 价格快照稳定；所有账本 transaction group 平衡；冲正不修改原记录 |
| 文件 | 越权下载、伪装 MIME、超大文件和路径注入被拒绝 |
| AI | schema 失败进入人工复核；AI 不能直接确认订单或修改金额 |
| H5 | 客户、陪玩、客服、财务四条关键路径可完成，无阻断控制台错误 |
| 小程序准备 | 同一 mobile 源码 `build:weapp` 成功；无业务代码直接调用 DOM 或 `wx` |
| 运维 | 健康检查、结构化日志、队列重试、备份恢复说明存在且可执行 |

---

## 20. 纵向切片实施计划

每个切片必须同时交付领域规则、数据库、API、必要 UI、测试和文档。不得先堆完整数据库再补业务，也不得先做静态页面后补权限。

### Slice 0：仓库骨架与双端可构建基线

**目标**：建立可重复开发环境，并证明移动端同一源码能构建 H5 和 weapp。

**主要路径**：

- `/package.json`
- `/pnpm-workspace.yaml`
- `/turbo.json`
- `/tsconfig.base.json`
- `/.env.example`
- `/apps/api/`
- `/apps/worker/`
- `/apps/admin-web/`
- `/apps/mobile/`
- `/packages/eslint-config/`
- `/packages/tsconfig/`
- `/infra/docker/docker-compose.yml`
- `/docs/adr/0000-version-baseline.md`
- `/.github/workflows/ci.yml`

**前置与权限**：安装依赖、拉取 Docker 镜像和创建 Git 仓库分别需要明确授权。

**步骤**：

- [ ] 记录 Node、pnpm、Docker、微信开发工具能力为 available/degraded/unavailable。
- [ ] 固定精确依赖版本并创建单一 lockfile。
- [ ] 建立 ESM、TypeScript strict、lint、format、test、build 命令。
- [ ] 创建 Nest 健康接口、Next 最小页面、Taro 最小共享页面。
- [ ] 创建空平台适配 contracts、H5 adapter 和 weapp adapter 骨架；未实现能力返回 typed unsupported，不返回成功。
- [ ] 配置 CI 同时构建 H5 与 weapp。
- [ ] 创建本地 PostgreSQL、Redis、MinIO Compose 配置。

**验收**：

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm build:h5
pnpm build:weapp
```

全部退出 0；H5 显示 runtime=`h5`，weapp 产物中不包含 H5 adapter。缺少微信开发者工具时只验证编译产物。

**恢复**：只删除该切片新建的未使用骨架文件和本地容器；不得删除用户已有文件或 Docker volume，除非再次确认精确目标。

### Slice 1：租户开通与隔离

**目标**：平台管理员创建租户，H5 根据域名/短码加载正确门店，数据库拒绝跨租户访问。

**主要路径**：

- `/packages/database/prisma/schema.prisma`
- `/packages/database/prisma/migrations/20260906000100_tenancy/`
- `/packages/database/src/tenant-transaction.ts`
- `/apps/api/src/modules/tenancy/`
- `/apps/api/src/common/tenant-context/`
- `/apps/admin-web/app/(platform)/tenants/`
- `/apps/mobile/src/platform/contracts/tenant-locator.ts`
- `/apps/mobile/src/platform/h5/tenant-locator.ts`
- `/tests/tenant-isolation/tenancy.spec.ts`

**公共接口**：`TenantContext`、`CreateTenantCommand`、`ResolveTenantQuery`、`TenantLocatorAdapter`。

**红测试**：A 店 context 查询 B 店记录必须得到空结果或 404；使用 B 店 ID 给 A 店写关联必须失败。

**步骤**：

- [ ] 创建 tenant、domain、app binding 和基础 RLS migration。
- [ ] 创建非 owner runtime role 和 transaction-scoped tenant setting。
- [ ] 实现 host/短码解析，拒绝客户端自报 tenantId。
- [ ] 实现平台租户列表、新建、停用和配置错误状态。
- [ ] H5 显示租户名称与状态；停用租户返回统一不可用页。
- [ ] 覆盖 SELECT、INSERT、UPDATE、DELETE、FK 五类隔离测试。

**验收**：`pnpm test:tenant-isolation`、`pnpm test:integration`、`pnpm build:h5`、`pnpm build:weapp` 全部成功。

**恢复**：代码可回退；数据库只允许保留向前兼容的 tenancy 表，不执行丢数据 down migration。

### Slice 2：身份、会话与 RBAC

**目标**：平台、门店员工、陪玩、客户使用隔离账号登录，并在服务端执行资源授权。

**主要路径**：

- `/apps/api/src/modules/identity-access/`
- `/apps/api/src/common/auth/`
- `/apps/admin-web/app/(platform)/login/`
- `/apps/admin-web/app/(tenant)/login/`
- `/apps/mobile/src/features/auth/`
- `/apps/mobile/src/platform/h5/identity-adapter.ts`
- `/apps/mobile/src/platform/weapp/identity-adapter.ts`
- `/tests/integration/auth.spec.ts`
- `/tests/tenant-isolation/authz.spec.ts`

**公共接口**：`AuthSession`、`AccessPrincipal`、`PermissionKey`、`IdentityAdapter`。

**红测试**：未验证签名 JWT、错误 audience、停用账号、跨租户 token、撤销 refresh token 均被拒绝。

**步骤**：

- [ ] 建立 tenant account、roles、refresh sessions 和平台账号独立模型。
- [ ] 实现短期 access token 与旋转 refresh token。
- [ ] 全局启用认证 guard，公开路由显式标记。
- [ ] 实现 RBAC 与资源归属 policy。
- [ ] H5 实现账号登录；weapp adapter 只暴露接口与明确未配置状态。
- [ ] 加入 CSRF、Origin、速率限制和会话撤销测试。

**验收**：认证集成测试、权限矩阵测试、H5 登录 E2E、双端构建成功。

### Slice 3：门店配置、套餐与品牌主题

**目标**：新门店通过配置而非代码差异获得品牌、流程和功能模块。

**主要路径**：

- `/packages/config-schema/src/tenant-config.ts`
- `/packages/ui-tokens/`
- `/apps/api/src/modules/tenant-config/`
- `/apps/api/src/modules/entitlements/`
- `/apps/admin-web/app/(tenant)/settings/`
- `/apps/admin-web/app/(platform)/packages/`
- `/apps/mobile/src/features/runtime-config/`
- `/tests/contract/tenant-config.spec.ts`

**公共接口**：`TenantConfigV1`、`FeatureKey`、`EffectiveConfigQuery`、`EntitlementGuard`。

**红测试**：禁用增值模块时直接请求其 API 返回 403；无效颜色、任意 URL、脚本字符串和未知配置字段被拒绝。

**步骤**：

- [ ] 定义 versioned Zod schema 与迁移函数。
- [ ] 实现平台默认、套餐默认、租户覆盖、活动覆盖合并。
- [ ] 保存配置版本和审计记录，支持回滚上一版本。
- [ ] 后端和 UI 同时执行 entitlement。
- [ ] H5 动态显示品牌 token，不接受自定义 HTML/CSS/JS。

**验收**：配置契约、模块关闭 API/UI、配置回滚和双端主题构建测试成功。

### Slice 4：客户、陪玩与服务目录

**目标**：门店可以建立客户、陪玩、技能、游戏服务和统一价格。

**主要路径**：

- `/apps/api/src/modules/customers/`
- `/apps/api/src/modules/players/`
- `/apps/api/src/modules/catalog/`
- `/apps/admin-web/app/(tenant)/customers/`
- `/apps/admin-web/app/(tenant)/players/`
- `/apps/admin-web/app/(tenant)/catalog/`
- `/apps/mobile/src/pages/player/profile/`
- `/apps/mobile/src/pages/player/availability/`
- `/tests/integration/catalog.spec.ts`

**公共接口**：`CustomerId`、`PlayerId`、`ServiceProduct`、`PricingRule`、`MoneyFen`、`DurationSeconds`。

**红测试**：浮点金额、负价格、跨租户技能关联、重叠不可用时间和禁用产品下单均失败。

**步骤**：

- [ ] 实现客户和陪玩档案及状态。
- [ ] 实现游戏、区服、服务产品和价格规则。
- [ ] 实现陪玩技能与可用时间。
- [ ] 实现后台列表、筛选、编辑和批量导入预览；导入确认属于独立写操作。
- [ ] 实现陪玩 H5 个人资料和接单状态。

**验收**：CRUD 权限、跨租户隔离、价格边界、导入错误报告、H5/weapp 构建成功。

### Slice 5：需求确认与订单创建

**目标**：客服从客户需求创建订单草稿，生成不可变价格快照并确认订单。

**主要路径**：

- `/apps/api/src/modules/orders/`
- `/apps/admin-web/app/(tenant)/orders/new/`
- `/apps/admin-web/app/(tenant)/orders/[orderId]/`
- `/apps/mobile/src/pages/customer/order-create/`
- `/apps/mobile/src/pages/customer/order-detail/`
- `/tests/integration/order-state-machine.spec.ts`
- `/tests/e2e/customer-order.spec.ts`

**公共接口**：`CreateOrderCommand`、`ConfirmOrderCommand`、`OrderState`、`OrderPriceSnapshot`。

**红测试**：缺失必要需求不能确认；产品价格改变后旧订单快照不变；重复创建 idempotency key 返回同一订单。

**步骤**：

- [ ] 实现草稿、需求、价格快照和订单事件。
- [ ] 实现合法状态迁移和 409 错误。
- [ ] 实现客服创建与客户自助创建两条入口，共用 application use case。
- [ ] 实现订单详情时间线。
- [ ] 写入同事务 Outbox 事件，不直接发送通知。

**验收**：状态机 100% branch coverage、快照稳定、幂等、客户权限和端到端创建成功。

### Slice 6：派单、报名、候选与选人

**目标**：客服发布订单、陪玩报名、客户选人，并原子锁定唯一指派。

**主要路径**：

- `/apps/api/src/modules/dispatch/`
- `/apps/admin-web/app/(tenant)/dispatch/`
- `/apps/mobile/src/pages/player/order-hall/`
- `/apps/mobile/src/pages/player/application-detail/`
- `/apps/mobile/src/pages/customer/candidates/`
- `/tests/integration/dispatch-concurrency.spec.ts`
- `/tests/e2e/dispatch-selection.spec.ts`

**公共接口**：`PublishOrderCommand`、`ApplyOrderCommand`、`ShortlistCommand`、`AssignPlayerCommand`。

**红测试**：两个并发选人请求只能一个成功；时间冲突陪玩不能被指派；指派后其余报名过期。

**步骤**：

- [ ] 实现发布与报名状态机。
- [ ] 实现陪玩可见性、技能和时间初筛。
- [ ] 实现客服候选管理和客户选人。
- [ ] 使用事务、唯一约束和必要行锁创建 assignment。
- [ ] 写入订单迁移、事件、审计和 Outbox。

**验收**：50 次并发竞争测试无双指派；跨租户、越权和重复报名被拒绝；双端构建成功。

### Slice 7：开始、结束、截图与时长调整

**目标**：陪玩完成可审计的服务场次，系统使用服务器时间核算时长。

**主要路径**：

- `/apps/api/src/modules/service-sessions/`
- `/apps/api/src/modules/files/`
- `/apps/mobile/src/pages/player/session/`
- `/apps/mobile/src/platform/h5/media-adapter.ts`
- `/apps/mobile/src/platform/weapp/media-adapter.ts`
- `/apps/admin-web/app/(tenant)/sessions/`
- `/tests/integration/session-idempotency.spec.ts`
- `/tests/integration/file-security.spec.ts`
- `/tests/e2e/player-session.spec.ts`

**公共接口**：`StartSessionCommand`、`EndSessionCommand`、`RequestAdjustmentCommand`、`MediaAdapter`。

**红测试**：重复开始/结束只产生一个事件；伪装图片、超大文件、越权下载、客户端篡改时间均失败。

**步骤**：

- [ ] 实现场次与事件状态机。
- [ ] 实现服务端 authoritative clock。
- [ ] 实现上传 intent、内容验证、对象键和授权下载。
- [ ] 实现 H5 选择与上传；weapp adapter 完成可编译实现。
- [ ] 实现调整申请与客服/财务复核，不覆盖原始事件。

**验收**：时钟、幂等、文件安全、调整审计和 H5 场次 E2E 成功；weapp 构建成功。

### Slice 8：核算、账本与陪玩结算

**目标**：完成订单核算、生成平衡账本和不可变结算批次；第一期只记录线下付款结果。

**主要路径**：

- `/apps/api/src/modules/ledger/`
- `/apps/api/src/modules/settlements/`
- `/apps/admin-web/app/(tenant)/finance/earnings/`
- `/apps/admin-web/app/(tenant)/finance/settlements/`
- `/apps/mobile/src/pages/player/earnings/`
- `/tests/integration/ledger-invariants.spec.ts`
- `/tests/integration/settlement-concurrency.spec.ts`
- `/tests/e2e/finance-settlement.spec.ts`

**公共接口**：`CompleteOrderAccountingCommand`、`LedgerTransaction`、`CreateSettlementBatchCommand`、`MarkSettlementPaidCommand`。

**红测试**：不平衡账本拒绝提交；同一 earning 不能进入两个活动批次；开放争议阻止结算；已支付批次不能编辑。

**步骤**：

- [ ] 从价格快照和已确认场次生成 earning。
- [ ] 原子生成平衡 ledger transaction 和 entries。
- [ ] 实现结算批次的创建、复核、批准、线下已付记录和冲正。
- [ ] 实现职责分离。
- [ ] 实现陪玩收入与批次详情 H5。

**验收**：账本不变量 100% branch coverage；并发结算无重复；金额全程整数分；财务 E2E 成功。

### Slice 9：客诉、审计、通知与重试

**目标**：异常流程不破坏原状态，所有关键操作可追溯，通知可重试。

**主要路径**：

- `/apps/api/src/modules/disputes/`
- `/apps/api/src/modules/audit/`
- `/apps/api/src/modules/notifications/`
- `/apps/worker/src/outbox/`
- `/apps/worker/src/notifications/`
- `/apps/admin-web/app/(tenant)/disputes/`
- `/apps/admin-web/app/(tenant)/audit/`
- `/apps/mobile/src/pages/customer/dispute/`
- `/tests/integration/outbox-recovery.spec.ts`
- `/tests/integration/dispute-freeze.spec.ts`

**公共接口**：`OpenDisputeCommand`、`ResolveDisputeCommand`、`AuditEvent`、`NotificationProviderPort`。

**红测试**：开放争议 earning 不能结算；worker 崩溃后事件可重放且不重复发送业务结果；审计不能更新删除。

**步骤**：

- [ ] 实现独立 dispute 状态机和 settlement hold。
- [ ] 实现审计字段、脱敏和查询权限。
- [ ] 实现 Outbox relay、BullMQ 消费、退避、dead-letter 和人工重放。
- [ ] 实现站内通知；短信/微信 provider 未配置时明确 degraded，不伪装送达。

**验收**：故障恢复、幂等、争议冻结、审计不可变和通知失败可见性测试成功。

### Slice 10：AI 辅助需求与匹配

**目标**：AI 提供可审计的结构化建议，失败不阻塞人工主流程。

**主要路径**：

- `/apps/api/src/modules/ai-assistant/`
- `/apps/worker/src/ai/`
- `/apps/admin-web/app/(tenant)/ai/`
- `/packages/test-fixtures/src/ai-evaluation/`
- `/tests/integration/ai-schema.spec.ts`
- `/tests/integration/ai-tenant-boundary.spec.ts`

**公共接口**：`AiProviderPort`、`AiSuggestion<T>`、`ParseRequirementCommand`、`RecommendPlayersCommand`。

**前置与权限**：调用外部模型、发送样本数据和配置 API key 均需明确授权。没有授权时使用确定性 Fake Provider 运行测试，并把生产能力标记 unavailable。

**红测试**：模型返回非法 JSON、跨租户证据引用、虚构价格或低置信度时必须进入 `NEEDS_REVIEW`。

**步骤**：

- [ ] 定义 provider port、结构化 schema、超时、重试和熔断。
- [ ] 实现需求解析和缺失字段检查。
- [ ] 实现基于数据库确定性条件的候选过滤，AI 只能在合法候选中排序。
- [ ] 记录 prompt/model 版本和人工采纳结果。
- [ ] 建立去标识化回归评测集。

**验收**：AI provider 关闭时人工流程完整可用；schema、租户边界、错误降级和评测门禁成功。

### Slice 11：SaaS 运营、套餐与门店开通向导

**目标**：平台运营人员无需改代码即可开通门店、选择套餐、配置品牌并完成验收。

**主要路径**：

- `/apps/admin-web/app/(platform)/tenants/`
- `/apps/admin-web/app/(platform)/subscriptions/`
- `/apps/admin-web/app/(platform)/onboarding/`
- `/apps/api/src/modules/tenancy/`
- `/apps/api/src/modules/entitlements/`
- `/apps/api/src/modules/platform-billing/`
- `/tests/e2e/tenant-onboarding.spec.ts`

**公共接口**：`OnboardTenantCommand`、`AssignPackageCommand`、`ActivateTenantCommand`、`OnboardingChecklist`。

**红测试**：配置不完整不能激活；套餐到期后增值 API 关闭但核心数据仍可导出；停用租户不能登录。

**步骤**：

- [ ] 实现平台租户生命周期和订阅记录。
- [ ] 实现开通向导：基本信息、品牌、员工、目录、规则、域名、测试单。
- [ ] 实现套餐变更的立即/周期末生效规则和审计。
- [ ] 实现店铺健康和用量视图。

**验收**：新门店 15 分钟内完成配置并跑通测试订单；无需重启和部署；套餐权限即时正确。

### Slice 12：H5 发布候选与小程序适配完整性证明

**目标**：形成可部署但尚未部署的 H5 发布候选，并证明未来独立小程序无需业务重构。

**主要路径**：

- `/tests/e2e/critical-journeys/`
- `/tests/performance/`
- `/docs/acceptance/phase-1.md`
- `/docs/runbooks/deploy-h5.md`
- `/docs/runbooks/rollback.md`
- `/docs/runbooks/restore-tenant.md`
- `/apps/mobile/src/platform/weapp/`
- `/.github/workflows/ci.yml`

**步骤**：

- [ ] 运行客户、陪玩、客服、财务四条端到端关键路径。
- [ ] 运行全量租户隔离、并发、账本、文件和 AI 降级测试。
- [ ] 在 Chromium、WebKit、移动 Chrome 与移动 Safari 视口运行关键 E2E。
- [ ] 运行容量基线并保存结果。
- [ ] 审查 mobile 源码，确认平台 API 只存在于 adapter 目录。
- [ ] 构建 weapp 生产产物并记录大小、警告和缺失的真实 AppID 验证项。
- [ ] 完成发布、回滚、备份恢复和事故处理 runbook。

**全量验收命令**：

```text
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:critical
pnpm test:integration
pnpm test:tenant-isolation
pnpm test:contract
pnpm test:e2e
pnpm build
pnpm build:h5
pnpm build:weapp
pnpm openapi:check
pnpm db:migrate:check
```

只有全部退出 0 且人工清单通过，才能标记“第一期本地发布候选”。这不代表已部署、已提交小程序或已生产验证。

### Slice 13（第二阶段）：独立微信小程序租户激活

**目标**：在不修改业务模块的情况下，为一个已购增值服务的租户上线独立小程序。

**允许新增/修改范围**：

- `/apps/mobile/src/platform/weapp/`
- `/apps/mobile/config/`
- `/apps/api/src/modules/tenancy/infrastructure/weapp-binding*`
- `/apps/api/src/modules/identity-access/infrastructure/weapp-auth*`
- `/apps/api/src/modules/notifications/infrastructure/weapp*`
- `/docs/runbooks/weapp-onboarding.md`
- 微信隐私、服务类目、合法域名和模板发布配置

**禁止修改范围**：

- 订单、派单、场次、价格、账本、结算领域状态机
- H5 与 weapp 共用页面的业务分支
- 为该租户创建独立 repository 或数据库表

**权限点**：创建/授权 AppID、配置微信密钥、提交审核、发布小程序和开通支付分别需要目标明确的授权。

**验收**：

- 相同 API contract 下，H5 和 weapp 跑通同一套非支付关键业务用例。
- AppID 只能解析到一个租户；未知、重复或停用绑定失败关闭。
- 小程序退出登录后会话失效。
- 分享卡片只能打开当前租户和当前有权限的资源。
- 微信开发者工具无阻断错误，真机完成客户和陪玩关键路径。
- 微信审核和发布返回终态成功后，才能声称“小程序已上线”。

---

## 21. AI 每个切片的交付报告模板

执行 AI 完成一个切片后必须使用以下格式，不得只回答“已完成”：

```text
切片：Slice N - 名称
状态：code-changed / locally-verified / blocked

实现范围：
- 对应规格条目
- 实际新增或修改的文件

数据库变化：
- migration 名称
- 是否向前兼容
- 回滚方式

API变化：
- operationId
- 请求/响应 schema
- OpenAPI 是否重新生成并无差异

安全边界：
- 租户检查位置
- 权限检查位置
- 输入验证位置
- 幂等/并发控制

验证证据：
- 命令
- 退出码
- 关键输出摘要
- H5 构建结果
- weapp 构建结果

未完成或降级能力：
- 明确列出，不得省略

下一步：
- 只提出下一切片，不自动执行
```

---

## 22. 发布与权限边界

本文档完成后允许的状态只有“规格已编写”。用户批准规格并授权某个切片后，AI 才能实现该切片。

以下动作永远不能从“请开发系统”一次性推断获得授权：

- 安装或升级依赖。
- 创建 Git 分支或提交。
- 推送远程仓库或上传源码。
- 执行安全扫描器或下载扫描规则。
- 创建或修改云数据库、对象存储、Redis、域名和证书。
- 执行预览或生产部署。
- 运行生产数据库迁移。
- 申请、提交、审核或发布微信小程序。
- 开通微信支付或发起真实付款。
- 删除、回滚远程资源或生产数据。

每个动作必须在执行前列出精确目标、影响和恢复方式，并取得新的确认。

---

## 23. 设计自检结果

- 多租户 SaaS、H5 第一期、可选独立小程序均有明确边界。
- 独立小程序通过 adapter、双端持续构建和禁止平台 API 越界得到结构性保障。
- 所有关键金额、时长和状态有不可变快照或事件。
- 跨租户访问由应用上下文、复合约束和 PostgreSQL RLS 多层阻断。
- 所有外部副作用通过 provider port 与 Outbox 解耦。
- AI 不能直接改变资金、处罚或业务终态。
- 每个切片可独立演示、测试和拒收。
- 测试、迁移、发布、回滚和权限点均有明确证据。
- 没有为单店定制代码、微服务、在线支付和自由社交等超出第一期范围的隐式实现。

本规格仍需产品负责人书面批准后才能作为实现基线。批准时必须引用文档版本 `v1.0`；任何范围变更先修改版本并重新审批。

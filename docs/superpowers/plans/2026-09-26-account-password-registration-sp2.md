# 账号密码自助注册（SP2）实施计划

Goal: 交付两个新 operation——`POST /api/v1/auth/register`（租户内自助建 `CUSTOMER` 账号并直接签发会话）与 `POST /api/v1/auth/password`（初次免验原密码、修改必验，分支由服务端按 `password_set_by_user` 判定）——并配套 H5 注册页/设置密码页与入口。

Architecture: 服务端完全落在既有 `identity-access` 模块的三层内（interface `auth.controller.ts` → application `auth.service.ts` → infrastructure `auth.repository.ts`，端口在 `application/auth-ports.ts`）；唯一 schema 变更是已执行的 `tenant_accounts.password_set_by_user`，本轮不再有迁移。前端在 `apps/mobile` 内按既有「纯逻辑 feature 模块（可单测，不 import 平台别名）+ 平台适配 feature 模块（页面只依赖它）」两层拆分。`player-applications` 模块零改动（陪玩意向走客户端两段式）。

Tech stack: TypeScript 5 / Node 22、NestJS 12、Prisma 7.10.0 + PostgreSQL 18（RLS 多租户）、vitest（单元 + 集成 + 租户隔离）、supertest、`@nestjs/swagger` + `@hey-api/openapi-ts` 生成契约、Taro 4 + React 18.3.1（H5 + weapp 双端）。

Spec: `docs/superpowers/specs/2026-09-26-account-password-registration-design.md`（§4 SP2、§5.1、§5.2、§6、§7、§8.1、§9.1–§9.4、§10）
ADR: `docs/adr/0009-account-password-registration-and-multi-role-authz.md`（决定三 D、决定 5、决定 8）

## Scope and non-goals

范围（全部来自 spec）：

1. `POST /api/v1/auth/register`：`@Public()` + 独立限流键；单事务写 `tenant_accounts` + `tenant_account_roles(CUSTOMER)` + `customer_profiles`；可选手机号绑定（需短信码）；201 + `Set-Cookie` refresh + `csrfToken`。
2. `POST /api/v1/auth/password`：`platform` 与 `tenant` 两 scope 均可用；服务端按 `password_set_by_user` 分支；审计 `auth.password.set`。
3. 契约产物再生成（`openapi.json` / `openapi.yaml` / `packages/api-client/src`）。
4. mobile：注册页、设置密码页、首页与两个 profile 页入口、纯逻辑两段式编排 + 单测。

非目标（spec §1.2、§8.2，逐条不实现）：跨租户账号；修改/解绑手机号、找回密码、邮箱验证；改 `phone-login` 的自动注册语义；账号合并；`PENDING` 账号态；weapp 真机/审核；`player-applications` 模块任何改动；密码复杂度策略升级；改密后撤销其他 refresh 会话；`apps/admin-web` 任何改动。**v1 不在前端隐藏陪玩端入口**（spec §8.1「与 F9 的关系」，属 §12 待定项）。

## Permission gates

本计划执行时**不需要**新的授权；以下各点在计划内不包含，若实施中发现需要，必须停下单独申请（AGENTS.md）：

- **数据库迁移**：已授权并已执行完毕（2026-09-26，`ALTER TABLE "tenant_accounts" ADD COLUMN "password_set_by_user" …`）。本计划**不含**任何新迁移；若出现新 schema 需求 → 停下申请。
- **Git**：不提交、不推送、不建分支（本 slice 结束时状态为 `locally-verified`）。
- **依赖**：不安装、不升级任何依赖与 CLI（`openapi-ts`、`taro` 均已在 devDependencies）。
- **部署/云资源**：不涉及（`pnpm --filter @pw/mobile build:weapp` 是本地构建产物验证，不是发布；小程序提交与发布需单独授权）。
- **远程数据库**：不涉及；集成测试只写本地 `pw_saas_test`（既有测试夹具惯例）。
- **契约产物**：`pnpm openapi:generate` 会重写 `openapi.json` / `openapi.yaml` / `packages/api-client/src/*`（生成产物，不得手工编辑），并运行 `@pw/api` 的 `tsc -p tsconfig.build.json`。

## 全局约束（逐字抄自 spec / AGENTS.md）

- 「以下动作不得从普通开发请求推断获得授权：安装、删除或升级依赖与 CLI；初始化 Git、创建分支、提交、推送或上传源码；下载或运行安全扫描器及规则集；启动会改变数据的容器或服务；修改本地非测试数据、远程数据库或云资源；执行数据库迁移、部署、回滚；配置真实密钥、微信 AppID/AppSecret、支付或 AI Provider；提交、审核或发布微信小程序。每次请求授权时必须列出准确目标、命令、影响和恢复方式。」
- 「禁止业务代码包含 Windows 绝对路径」；「文本使用 UTF-8 与 LF；导入路径大小写必须与文件名完全一致」。
- 「不得创建空实现、始终成功的 Provider、吞异常的 catch、伪造命令输出或空测试脚本」。
- 「移动端业务代码必须同时面向 H5 和 weapp；window、document、localStorage、wx 只能出现在平台适配目录」。
- 「每个租户资源必须在服务端绑定 TenantContext；禁止信任客户端提交的 tenantId」。
- 「使用 TypeScript strict；不得以 any、忽略类型或关闭规则绕过错误」。
- 「API 契约来自 OpenAPI；生成客户端不得手工修改」。
- 「只修改当前 Slice 拥有的文件；需要越界时停止并说明原因」；「不得自动进入下一 Slice」。
- 状态用语只允许 `code-changed` / `locally-verified` / `committed` / `pushed` / `preview-deployed` / `production-deployed` / `production-verified`。
- 实施期发现必须先读 `apps/api`/`apps/mobile` 既有同类实现再动手（登录/手机登录/微信登录是最接近的样板）。

## 接缝地图（已核实的事实，实施时不必重新发现）

| 事实                                               | 位置                                                                                                                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 控制器前缀与限流常量                               | `apps/api/src/modules/identity-access/interface/auth.controller.ts:44-45`（`LOGIN_WINDOW_MS = 15*60*1000`、`LOGIN_MAX_FAILURES = 5`）、`@Controller("api/v1/auth")` 在 `:84`                      |
| 控制器局部工具                                     | `requiredString` `:59-64`、`tenantIdOf` `:66-71`、`originAllowed` `:73-82`                                                                                                                        |
| 登录/手机登录的响应与 Cookie 写法                  | `auth.controller.ts:126-160`（login）、`:162-218`（phone-login：`setRefreshCookie` + `setCsrfCookie` + `{ data: { accessToken, principal, expiresInSeconds, csrfToken } }`）                      |
| 守卫规则：不加 scope 装饰器即接受两种 audience     | `apps/api/src/common/auth/auth.guard.ts:36-49`（`requiredScope` 缺省 → `[AUD_PLATFORM, AUD_TENANT]`）                                                                                             |
| 装饰器                                             | `apps/api/src/common/auth/decorators.ts`（`Public` / `PlatformScope` / `TenantScope` / `Permissions`）                                                                                            |
| 服务端主角色与角色集                               | `application/auth.service.ts:51-67`（`tenantPrincipal`：`sortRolesByPriority` → `roles[0]`，签发 `role` + `roles`）                                                                               |
| 会话签发（建 refresh 会话 + 签 access）            | `application/auth.service.ts:339-357`（`issue`）                                                                                                                                                  |
| 手机自动建号样板（随机密码 + `customer_profiles`） | `application/auth.service.ts:140-176`、`infrastructure/auth.repository.ts:147-191`                                                                                                                |
| 短信码校验                                         | `application/phone-verification.service.ts:114`（`consumeCode(tenantId, phone, code, "register_login")`）；错误类 `application/phone-verification.errors.ts`                                      |
| 密码哈希                                           | `infrastructure/password.ts:17`（`hashPassword`）、`:23`（`verifyPassword`，哈希格式不合法时返回 `false` 而不抛）                                                                                 |
| 账号记录映射                                       | `infrastructure/auth.repository.ts:33-53`（`mapTenant`），调用点 `:97`、`:132`、`:179`、`:249`、`:371`                                                                                            |
| 租户解析                                           | `auth.repository.ts:111-117`（`findTenantIdByCode`，只返回 id）                                                                                                                                   |
| 审计写入                                           | `auth.repository.ts:424-436`（`recordAudit` → `audit_logs`，`summary` 截断 500）                                                                                                                  |
| `audit_logs.tenant_id` 为 **NOT NULL**             | `packages/database/prisma/schema.prisma:1011`                                                                                                                                                     |
| 唯一约束（P2002 来源）                             | `schema.prisma:176` `@@unique([tenantId, username])`、`:177` `@@unique([tenantId, phoneHash])`                                                                                                    |
| P2002 识别的既有范式                               | `apps/api/src/modules/customers/infrastructure/prisma-customers.repository.ts:19-26`                                                                                                              |
| 用户名/密码/昵称规则常量所在                       | `application/tenant-accounts.service.ts:44-60`（`assertUsername` / `assertPassword`，模块私有）                                                                                                   |
| 全局异常过滤器（未知错误 → 500）                   | `apps/api/src/common/http/http-error.filter.ts:37-98`                                                                                                                                             |
| 契约由控制器自动扫描生成                           | `apps/api/src/openapi/contract.ts:20-47`（`SwaggerModule.createDocument`）；auth 端点当前无 requestBody schema（`openapi.json` 实测 `rb=None`）                                                   |
| mobile 平台别名                                    | `apps/mobile/tsconfig.json:14-23`（`@platform-api` / `@platform-session` / `@platform-locator` / `@platform-identity`）                                                                           |
| mobile 单测只跑 features 下的 alias-free 文件      | 根 `vitest.config.ts` include `apps/mobile/src/features/**/*.spec.ts`，`environment: "node"`，无别名解析                                                                                          |
| 纯逻辑 / 平台适配两层范式                          | `apps/mobile/src/features/wechat-pay/wechat-pay.ts`（纯，有 spec）vs `pay-flow.ts`（import 平台路径，无 spec）                                                                                    |
| H5 传输与登录样板                                  | `apps/mobile/src/platform/h5/api-adapter.ts:5-39`、`apps/mobile/src/features/customer-ui/session.ts:25-58`（`phoneLogin` / `customerLogin` / `resolveTenantCode` / `sendPhoneCode`）              |
| 页面注册与配置范式                                 | `apps/mobile/src/app.config.ts:2-22`、`apps/mobile/src/pages/customer/profile/index.config.ts`（`definePageConfig`）                                                                              |
| 首页入口位置                                       | `apps/mobile/src/pages/index/index.tsx:118-150`（两张 `role-card`，`openPlayer` / `openBoss`）                                                                                                    |
| 登录卡文案                                         | `apps/mobile/src/components/customer-ui/index.tsx:225-227`                                                                                                                                        |
| 两个 profile 页的按钮位置                          | `pages/customer/profile/index.tsx:155-164`（退出登录）、`pages/player/profile/index.tsx:264-266`（安全退出）                                                                                      |
| 陪玩申请端点契约                                   | `apps/api/src/modules/player-applications/player-applications.controller.ts:38-56`（`POST`，`{ intro }`，`@TenantScope()` + `@Permissions("tenant.view")`，要求 `principal.role === "CUSTOMER"`） |

## 计划新增/修改的文件总表

服务端（Task 1 + Task 2）：

| 文件                                                                          | 动作                                                                                         |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `apps/api/src/modules/identity-access/domain/account-credentials.ts`          | 新增（用户名/密码/昵称规则常量）                                                             |
| `apps/api/src/modules/identity-access/domain/errors.ts`                       | 修改（4 个新错误类 + `PhoneAlreadyBoundError` 可选消息）                                     |
| `apps/api/src/modules/identity-access/application/tenant-accounts.service.ts` | 修改（`assertUsername`/`assertPassword` 改用共享常量，行为不变）                             |
| `apps/api/src/modules/identity-access/application/auth-ports.ts`              | 修改（`TenantAccountRecord.passwordSetByUser`、`RegisterTenantCustomerInput`、4 个仓储方法） |
| `apps/api/src/modules/identity-access/infrastructure/auth.repository.ts`      | 修改（`mapTenant` + 5 处调用点 + 4 个新方法 + P2002 转译）                                   |
| `apps/api/src/modules/identity-access/application/auth.service.ts`            | 修改（`setPassword`、`registerTenantCustomer`）                                              |
| `apps/api/src/modules/identity-access/interface/auth.controller.ts`           | 修改（`@Post("password")`、`@Post("register")` + 常量）                                      |
| `apps/api/src/modules/identity-access/application/auth-password.spec.ts`      | 新增（单测）                                                                                 |
| `apps/api/src/modules/identity-access/application/auth-register.spec.ts`      | 新增（单测）                                                                                 |
| `tests/integration/account-registration.spec.ts`                              | 新增（集成测，§9.2 全部用例）                                                                |
| `openapi.json`、`openapi.yaml`、`packages/api-client/src/*`                   | 再生成（不得手工编辑）                                                                       |

前端（Task 3）：

| 文件                                                                                 | 动作                                         |
| ------------------------------------------------------------------------------------ | -------------------------------------------- |
| `apps/mobile/src/features/account-ui/register.ts`                                    | 新增（**纯逻辑**：两段式编排）               |
| `apps/mobile/src/features/account-ui/register.spec.ts`                               | 新增（单测）                                 |
| `apps/mobile/src/features/account-ui/actions.ts`                                     | 新增（平台适配：注册 / 设置密码 / 申请陪玩） |
| `apps/mobile/src/pages/register/index.tsx` + `index.config.ts` + `index.css`         | 新增                                         |
| `apps/mobile/src/pages/account/password/index.tsx` + `index.config.ts` + `index.css` | 新增                                         |
| `apps/mobile/src/app.config.ts`                                                      | 修改（pages 数组 + 2 条）                    |
| `apps/mobile/src/pages/index/index.tsx`                                              | 修改（注册入口）                             |
| `apps/mobile/src/components/customer-ui/index.tsx`                                   | 修改（文案下加两个入口）                     |
| `apps/mobile/src/pages/customer/profile/index.tsx`                                   | 修改（设置密码 + 申请成为陪玩入口）          |
| `apps/mobile/src/pages/player/profile/index.tsx`                                     | 修改（设置密码入口）                         |

文档（Task 4）：spec、ADR-0009、`docs/DEVELOPMENT_BACKLOG.md`、`docs/unverified-and-deferred.md`。

---

## Task 1 · 服务端：改密端点 `POST /api/v1/auth/password`

**目标**：按 spec §5.2 交付「初次免验、修改必验」的设密码/改密端点，含审计。**契约**：请求 `{ newPassword: string, currentPassword?: string }`；响应 200 `{ data: { ok: true } }`；错误 **400 / 401**（原写「400 / 401 / 403」：spec §5.2 的错误集只有 400/401，账号停用与门店停用按 `login` 同款处理为 401，见「一致性与偏差」D2；**已按 401 实施**）。

**消费/产出的接口**（Task 2 会复用）：

```ts
// auth-ports.ts（Task 1 产出的部分）
export interface TenantAccountRecord {
  // …既有字段
  passwordSetByUser: boolean; // 新增
}
export interface AuthRepository {
  // …既有方法
  updateTenantAccountPassword(
    tenantId: string,
    accountId: string,
    passwordHash: string,
  ): Promise<void>;
  updatePlatformAccountPassword(
    accountId: string,
    passwordHash: string,
  ): Promise<void>;
}
```

**步骤**

- [x] 1.1（红灯）新增 `apps/api/src/modules/identity-access/application/auth-password.spec.ts`，按 `application/auth-phone-binding.spec.ts` 的手写 stub 范式（`as unknown as AuthRepository`）构造 `AuthService`，覆盖：tenant 初次（`passwordSetByUser: false`，不传 `currentPassword`）→ 成功、`updateTenantAccountPassword` 被调用一次、审计 `auth.password.set` 且 `summary === "初次设置密码"`；tenant 修改（`true` + 正确 `currentPassword`）→ 成功、`summary === "修改密码"`；tenant 修改传错 → `CurrentPasswordInvalidError` 且 `updateTenantAccountPassword` **0 次**；tenant 修改缺 `currentPassword` → 同上；platform scope 传对 `currentPassword` → 调 `updatePlatformAccountPassword` 且**不**调 `recordAudit`；platform 传错/缺 → `CurrentPasswordInvalidError`；`newPassword` 长度 7 与 129 → `AuthInputError`（消息「密码长度需为 8-128 字符」）；账号不存在 → `InvalidCredentialsError`。
- [x] 1.2 运行 `pnpm exec vitest run --config vitest.config.ts apps/api/src/modules/identity-access/application/auth-password.spec.ts`，确认**红灯**（`setPassword is not a function`，不是 setup 错误），记录命令与输出。
- [x] 1.3 新增 `domain/account-credentials.ts`，只放规则常量（不 import 任何平台/基础设施）：

```ts
export const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{2,64}$/;
export const USERNAME_RULE_MESSAGE = "用户名需为 2-64 位字母/数字/_/-";
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_RULE_MESSAGE = "密码长度需为 8-128 字符";
export const DISPLAY_NAME_MAX_LENGTH = 50;
export const DISPLAY_NAME_RULE_MESSAGE = "昵称需为 1-50 字符";
```

- [x] 1.4 `domain/errors.ts` 追加（消息逐字对齐 spec §5.1/§5.2 的错误表）：

```ts
/** 注册/改密端点的输入校验失败（控制器映射 400）。 */
export class AuthInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthInputError";
  }
}
/** 注册：用户名在该租户已存在（409）。 */
export class UsernameTakenError extends Error {
  constructor() {
    super("该用户名已被使用");
    this.name = "UsernameTakenError";
  }
}
/** 注册：tenantCode 未命中租户（404）。 */
export class TenantNotFoundError extends Error {
  constructor() {
    super("门店不存在");
    this.name = "TenantNotFoundError";
  }
}
/** 改密：修改分支的原密码缺失或不匹配（400）。 */
export class CurrentPasswordInvalidError extends Error {
  constructor() {
    super("原密码不正确");
    this.name = "CurrentPasswordInvalidError";
  }
}
```

并把既有 `PhoneAlreadyBoundError` 改为可选消息（默认值保持原文本，既有调用点不变）：`constructor(message = "该手机号已绑定其他账号，请联系门店处理")`。

- [x] 1.5 `application/tenant-accounts.service.ts:44-60` 改用共享常量（**纯等价重构**，消息文本与抛错类型一字不变）。

- [x] 1.6 `application/auth-ports.ts`：`TenantAccountRecord` 加 `passwordSetByUser: boolean`（必填，让漏映射在 typecheck 期暴露）；`AuthRepository` 加 `updateTenantAccountPassword` / `updatePlatformAccountPassword`。
- [x] 1.7 `infrastructure/auth.repository.ts`：`mapTenant` 的入参类型加 `passwordSetByUser: boolean` 并写入返回值；`passwordSetByUser` 透传到 5 处调用点（`:97`、`:132`、`:179`、`:249`、`:371`）；新增两个方法：

```ts
async updateTenantAccountPassword(tenantId: string, accountId: string, passwordHash: string): Promise<void> {
  await withTenantContext(this.runtime, tenantId, async (tx: DbTransaction) => {
    await tx.tenantAccount.update({ where: { id: accountId }, data: { passwordHash, passwordSetByUser: true } });
  });
}
async updatePlatformAccountPassword(accountId: string, passwordHash: string): Promise<void> {
  await this.client.platformAccount.update({ where: { id: accountId }, data: { passwordHash } });
}
```

说明：`platform_accounts` **不加** `passwordSetByUser`（spec §10「未加列」）；`tenant_accounts.phoneEnc/phoneHash` 等字段不变。

- [x] 1.8 `application/auth.service.ts` 新增：

```ts
/**
 * 设置/修改当前账号密码（spec §5.2）。分支由服务端判定：tenant 账号看 password_set_by_user，
 * platform 账号无自助激活路径，一律按「修改」处理。校验全部通过后才计算哈希与写库。
 */
async setPassword(input: {
  scope: Scope; accountId: string; tenantId?: string;
  newPassword: string; currentPassword?: string;
}): Promise<{ mode: "set" | "change" }>
```

行为（顺序即实现顺序）：① `newPassword` 长度不合法 → `AuthInputError(PASSWORD_RULE_MESSAGE)`；② `scope === "platform"` → `findPlatformAccountById`；不存在或 `status !== "ACTIVE"` → `InvalidCredentialsError`；`currentPassword` 缺失或 `verifyPassword` 失败 → `CurrentPasswordInvalidError`；通过则 `hashPassword` + `updatePlatformAccountPassword`，返回 `{ mode: "change" }`，**不写审计**（见「一致性与偏差」C1）；③ tenant → `tenantId` 缺失 → `InvalidCredentialsError`；`findTenantAccountById(accountId, tenantId)` → 空则 `InvalidCredentialsError`；`tenantStatus !== "ACTIVE"` → `TenantInactiveError`；`status !== "ACTIVE"` → `AccountDisabledError`；`mode = account.passwordSetByUser ? "change" : "set"`，`change` 时必须 `verifyPassword(currentPassword, account.passwordHash)` 通过，否则 `CurrentPasswordInvalidError`；④ `hashPassword(newPassword)` → `updateTenantAccountPassword` → `recordAudit({ tenantId, actorType: "tenant_account", actorId: accountId, action: "auth.password.set", resourceType: "tenant_account", resourceId: accountId, summary: mode === "set" ? "初次设置密码" : "修改密码" })`，返回 `{ mode }`。审计 **不写入任何密码或哈希**。

- [x] 1.9 `interface/auth.controller.ts` 新增路由（**不加** scope 装饰器 → 两种 audience 都接受；`AuthGuard` 保证未认证 401）：

```ts
@Post("password")
async setPassword(@Req() req: AuthenticatedRequest, @Body() body: PasswordBody) {
  const principal = req.principal;
  if (!principal) throw new HttpException("missing bearer token", HttpStatus.UNAUTHORIZED);
  const newPassword = requiredString(body.newPassword, "newPassword");
  const input: { scope: Scope; accountId: string; newPassword: string; tenantId?: string; currentPassword?: string } =
    { scope: principal.scope, accountId: principal.sub, newPassword };
  if (principal.tenantId !== undefined) input.tenantId = principal.tenantId;
  if (typeof body.currentPassword === "string") input.currentPassword = body.currentPassword;
  try {
    await this.auth.setPassword(input);
    return { data: { ok: true } };   // spec §5.2 的响应体就是 { data: { ok: true } }，不加额外字段
  } catch (error) {
    if (error instanceof CurrentPasswordInvalidError || error instanceof AuthInputError)
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    if (error instanceof InvalidCredentialsError)
      throw new HttpException(error.message, HttpStatus.UNAUTHORIZED);
    // spec §5.2 的错误集只有 400/401：账号停用/门店停用按 login 同款处理（见 D2，此处已修正）
    if (error instanceof AccountDisabledError || error instanceof TenantInactiveError)
      throw new HttpException(error.message, HttpStatus.UNAUTHORIZED);
    throw error;
  }
}
```

`interface PasswordBody { newPassword?: unknown; currentPassword?: unknown }`。

- [x] 1.10 绿灯：重跑 1.2 的命令，确认全部通过；再跑 `pnpm --filter @pw/api typecheck`（`mapTenant` 漏映射会在此暴露）。
- [x] 1.11（集成红灯→绿）新增 `tests/integration/account-registration.spec.ts`，先按 `tests/integration/phone-register.spec.ts:1-71` 的夹具范式建骨架：`PW_TEST_MIGRATION_URL` owner 直连（`envOrThrow`）+ `Test.createTestingModule({ imports: [AppModule] })` + `tenantCode = "acctreg_" + Date.now().toString(36)` + `afterAll` 按 `auditLog → phoneVerificationCode → customerProfile → playerApplication → tenantAccountRole → tenantAccount → tenant` 倒序清理（该顺序已被 `phone-register.spec.ts` 证明无外键阻塞）。先写本 Task 的三条改密用例：
  - 「改密：初次免验」：`POST /auth/phone-verification-code` 取 `debugCode` → `POST /auth/phone-login`（`passwordSetByUser=false`）→ 用响应里的 `principal.username` + `POST /auth/password { newPassword }`（**不传** `currentPassword`）→ 200；owner 直连断言 `password_set_by_user = true`；`POST /auth/login { kind: "tenant", tenantCode, username, password: newPassword }` → 201；`audit_logs` 中 `action = "auth.password.set"` 恰 1 条。
  - 「改密：修改必验」：承上再 `POST /auth/password { newPassword: newPassword2 }`（不传 `currentPassword`）→ **400**；`audit_logs` 仍 1 条（**没写库**）；用 `newPassword` 登录仍 201。
  - 「改密：原密码错误」：承上传错 `currentPassword` → **400**；仍 1 条审计；`newPassword` 仍可登录。
- [ ] 1.12 先跑 `pnpm exec vitest run --config tests/vitest.integration.config.ts tests/integration/account-registration.spec.ts` 记录**红灯**（400 而非预期的 200），再跑一次确认**绿灯**，两条证据都留档。**未取得红灯证据**（实现先于集成用例落地，只有绿灯）——见 D5，Task 4 报告明写。
- [x] 1.13（超出 spec 的最小补充，需回执）追加一条单元用例：「门店停用（`tenantStatus: "INACTIVE"`）→ `TenantInactiveError`」，用于钉住「停用门店不得改密」。见「一致性与偏差」B1。

**回滚**：本 Task 只新增代码与测试，无 schema 变更、无数据写入（集成测试写的是本地测试库且 `afterAll` 清理）。回滚 = 撤掉本 Task 的文件与 hunk。

**验证证据**：1.2 / 1.10 / 1.12 的命令与退出码；`pnpm --filter @pw/api typecheck` 退出码 0。

---

## Task 2 · 服务端：注册端点 `POST /api/v1/auth/register` + 契约产物再生成

**目标**：按 spec §5.1 交付自助注册（`CUSTOMER` only、手机号可选绑定、直接签发会话、独立限流键 5 次/15 分钟），并再生成契约产物。

**消费**：Task 1 的 `AuthInputError` / `TenantNotFoundError` / `UsernameTakenError` / `account-credentials.ts` 常量 / `TenantAccountRecord.passwordSetByUser`。

**产出接口**：

```ts
// auth-ports.ts
export interface RegisterTenantCustomerInput {
  username: string;
  passwordHash: string;
  displayName: string;
  phoneEnc?: string;
  phoneHash?: string;
}
export interface AuthRepository {
  /** 解析租户 code → { id, status }；注册必须在建号前拒绝停用门店。 */
  findTenantByCode(
    tenantCode: string,
  ): Promise<{ id: string; status: string } | null>;
  registerTenantCustomer(
    tenantId: string,
    input: RegisterTenantCustomerInput,
  ): Promise<TenantAccountRecord>;
}
```

**步骤**

- [x] 2.1（红灯）新增 `application/auth-register.spec.ts`（沿用 stub 范式），覆盖 spec §9.1 的注册行 + 2 条补充：注册成功路径（调 `registerTenantCustomer` 且 `passwordHash` 非明文、`passwordSetByUser` 由仓储写入）→ 返回 bundle 的 `principal.roles === ["CUSTOMER"]`、`principal.role === "CUSTOMER"`、`principal.tenantId` 正确、审计 `auth.register`；用户名非法（`/^[a-zA-Z0-9_-]{2,64}$/` 不符，如 `"a"` / `"中文名"`）→ `AuthInputError`；密码 7 与 129 字符 → `AuthInputError`；`displayName` 51 字符 → `AuthInputError`；`displayName` 缺省 → `用户${username.slice(-4)}`；租户不存在 → `TenantNotFoundError`；租户停用 → `TenantInactiveError` 且**不调用** `registerTenantCustomer`；带 `phone` 缺 `code` → `AuthInputError("缺少短信验证码")` 且不调 `consumeCode`；短信码错误 → 原样抛 `PhoneVerificationCodeMismatchError` 且不建号；手机号已占用 → `PhoneAlreadyBoundError` 且不建号。
- [x] 2.2 运行 `pnpm exec vitest run --config vitest.config.ts apps/api/src/modules/identity-access/application/auth-register.spec.ts` → 记录**红灯**。
- [x] 2.3 `auth.repository.ts` 新增 `findTenantByCode`（`this.runtime.tenant.findUnique({ where: { code }, select: { id: true, status: true } })`）与 `registerTenantCustomer`：

```ts
async registerTenantCustomer(tenantId: string, input: RegisterTenantCustomerInput): Promise<TenantAccountRecord> {
  return withTenantContext(this.runtime, tenantId, async (tx: DbTransaction) => {
    const dup = await tx.tenantAccount.findFirst({ where: { tenantId, username: input.username }, select: { id: true } });
    if (dup) throw new UsernameTakenError();
    let account;
    try {
      account = await tx.tenantAccount.create({
        data: {
          tenantId, username: input.username, passwordHash: input.passwordHash,
          passwordSetByUser: true,                       // 用户本人设定 → 此后改密必验原密码
          ...(input.phoneEnc !== undefined ? { phoneEnc: input.phoneEnc } : {}),
          ...(input.phoneHash !== undefined ? { phoneHash: input.phoneHash } : {}),
          roles: { create: [{ tenantId, role: "CUSTOMER" }] },
        },
        include: { roles: true },
      });
    } catch (error) {
      // 预查重与 create 之间有竞态：以 DB 唯一约束兜底，按 meta.target 定位是哪一个唯一索引
      if (isUniqueViolation(error, "phone_hash"))
        throw new PhoneAlreadyBoundError("该手机号已绑定其他账号，请改用手机号登录后在「设置密码」中激活");
      if (isUniqueViolation(error, "username")) throw new UsernameTakenError();
      throw error;
    }
    await tx.customerProfile.create({
      data: {
        tenantId, tenantAccountId: account.id, name: input.displayName,
        ...(input.phoneEnc !== undefined ? { mobileEnc: input.phoneEnc } : {}),
        ...(input.phoneHash !== undefined ? { mobileHash: input.phoneHash } : {}),
      },
    });
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { status: true } });
    return mapTenant({ id: account.id, tenantId: account.tenantId, tenantStatus: tenant?.status ?? "ACTIVE",
      username: account.username, passwordHash: account.passwordHash, passwordSetByUser: account.passwordSetByUser,
      status: account.status, roles: account.roles, wechatOpenid: account.wechatOpenid });
  });
}
```

配套模块级 helper（照 `prisma-customers.repository.ts:19-26` 的判型写法，但读 `meta.target`）：

```ts
function isUniqueViolation(error: unknown, column: string): boolean {
  if (error === null || typeof error !== "object" || !("code" in error))
    return false;
  const e = error as { code?: string; meta?: { target?: unknown } };
  if (e.code !== "P2002") return false;
  const target = e.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target)];
  return fields.some((f) => f.includes(column));
}
```

- [x] 2.4 `application/auth.service.ts` 新增：

```ts
/** 自助注册（spec §5.1）：只建 CUSTOMER；手机号可选，绑定时短信码先于建号校验；单事务三处写入。 */
async registerTenantCustomer(input: {
  tenantCode: string; username: string; password: string;
  displayName?: string; phone?: string; code?: string;
}): Promise<SessionBundle>
```

行为：① `findTenantByCode(input.tenantCode)` → 空 → `TenantNotFoundError`；`status !== "ACTIVE"` → `TenantInactiveError`（**建号前**拒绝，避免给停用门店留下账号）；② `username = input.username.trim()`，不合 `USERNAME_PATTERN` → `AuthInputError(USERNAME_RULE_MESSAGE)`；③ `password` 长度不合 → `AuthInputError(PASSWORD_RULE_MESSAGE)`；④ `displayName = (input.displayName ?? "").trim() || \`用户${username.slice(-4)}\``，长度 > 50 → `AuthInputError(DISPLAY_NAME_RULE_MESSAGE)`；⑤ 若给了 `phone`：`code` 缺失 → `AuthInputError("缺少短信验证码")`；`consumeCode(tenantId, phone, code, "register_login")`（错误原样上抛）；`phoneCipher = encryptPhone(tenantId, phone)`；`findTenantAccountByPhoneHash` 命中 → `PhoneAlreadyBoundError(注册文案)`；⑥ `hashPassword(password)` → `registerTenantCustomer`（带上 `phoneEnc/phoneHash`）→ ⑦ `issue(this.tenantPrincipal(account))` → ⑧ `recordAudit({ tenantId, actorType: "tenant_account", actorId: bundle.principal.sub, action: "auth.register", resourceType: "tenant_account", resourceId: bundle.principal.sub, summary: \`自助注册成功：${username}\` })` → 返回 bundle。**不读请求体里的任何 tenantId**。

- [x] 2.5 `interface/auth.controller.ts` 新增常量与路由：

```ts
const REGISTER_WINDOW_MS = 15 * 60 * 1000;
const REGISTER_MAX_ATTEMPTS = 5;

@Public()
@Post("register")
async register(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response, @Body() body: RegisterBody) {
  const tenantCode = requiredString(body.tenantCode, "tenantCode");
  const rateKey = (req.ip ?? "unknown") + ":register:" + tenantCode;
  if (await this.rateLimit.isBlocked(rateKey, REGISTER_MAX_ATTEMPTS, REGISTER_WINDOW_MS))
    throw new HttpException("尝试次数过多", HttpStatus.TOO_MANY_REQUESTS);
  // 注册按「尝试次数」计数（§5.1）：成功也要占额度，故无条件记一次
  await this.rateLimit.recordFailure(rateKey, REGISTER_WINDOW_MS);
  try {
    const bundle = await this.auth.registerTenantCustomer({
      tenantCode,
      username: requiredString(body.username, "username"),
      password: requiredString(body.password, "password"),
      ...(typeof body.displayName === "string" ? { displayName: body.displayName } : {}),
      ...(typeof body.phone === "string" ? { phone: body.phone } : {}),
      ...(typeof body.code === "string" ? { code: body.code } : {}),
    });
    setRefreshCookie(res, bundle.refreshToken);
    const csrfToken = setCsrfCookie(res);
    return { data: { accessToken: bundle.accessToken, principal: bundle.principal, expiresInSeconds: bundle.expiresInSeconds, csrfToken } };
  } catch (error) {
    if (error instanceof UsernameTakenError || error instanceof PhoneAlreadyBoundError)
      throw new HttpException(error.message, HttpStatus.CONFLICT);
    if (error instanceof TenantNotFoundError) throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    if (error instanceof TenantInactiveError) throw new HttpException(error.message, HttpStatus.FORBIDDEN);
    if (error instanceof AuthInputError || error instanceof PhoneVerificationInputError ||
        error instanceof PhoneVerificationExpiredError || error instanceof PhoneVerificationCodeMismatchError ||
        error instanceof PhoneVerificationConsumedError)
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    throw error;
  }
}
```

POST 默认 201，与 spec §5.1 一致；`interface RegisterBody { tenantCode?: unknown; username?: unknown; password?: unknown; displayName?: unknown; phone?: unknown; code?: unknown }`。

- [x] 2.6 绿灯：重跑 2.2 的命令 → 全绿；`pnpm --filter @pw/api typecheck` → 退出码 0。
- [x] 2.7（集成红灯→绿）在 `tests/integration/account-registration.spec.ts` 追加注册用例。**限流键是 `{ip}:register:{tenantCode}`，同租户共享 5 次额度**，故用例按租户分组，避免互相挤占（本计划的分配即为此设计，不得改动分组）：

  | 组  | tenantCode 后缀         | 用例（消耗次数）                                                                                                                                        |
  | --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | A   | `_a`                    | 注册→密码登录（1）；用户名重复=同租户二次注册同名 409（2）；绑定手机号后手机登录命中同一 `accountId`（3）；手机号已被占用 → 409 且不产生第二个账号（4） |
  | B   | `_b`                    | 跨租户同名 → 201（1，证明租户内唯一）                                                                                                                   |
  | C   | `ne_<suffix>`（不存在） | 租户不存在 → 404（1）                                                                                                                                   |
  | D   | `_rl`                   | 限流：5 次 `{ tenantCode: d, username: "x" }`（用户名非法 → 400）→ 第 6 次 → **429**（6）                                                               |
  | E   | `_code`                 | 短信码错误 → 400 且不产生账号（1）                                                                                                                      |

  补充断言：注册成功的 `principal.role === "CUSTOMER"`、`principal.roles` 含 `CUSTOMER`、`tenantId` 等于夹具租户；`customer_profiles` 有对应行；`audit_logs` 有 `action = "auth.register"`；D 组的 6 次尝试中失败路径均**未**在 D 租户下产生任何 `tenant_accounts` 行；A 组第 4 条的 409 之后 `tenant_accounts` 计数不变。

- [ ] 2.8 跑 `pnpm exec vitest run --config tests/vitest.integration.config.ts tests/integration/account-registration.spec.ts`：先记录**红灯**（新用例在实现前失败；若与 2.6 的顺序对调，则红灯证据取 2.7 前的一次运行），实现后**绿灯**。**未取得红灯证据**（同 1.12：实现先于集成用例落地）——见 D5，Task 4 报告明写。
- [x] 2.9 契约产物：先记录基线 `git status --short -- openapi.json openapi.yaml packages/api-client/src` 与 `git diff --stat -- openapi.json openapi.yaml packages/api-client/src`；再跑 `pnpm openapi:generate`（含 `@pw/api` 的 tsc build、`openapi-ts` 再生成、`@pw/api-client typecheck`）。验证：`openapi.json` 出现 `/api/v1/auth/register`（operationId `auth_register`）与 `/api/v1/auth/password`（operationId `auth_setPassword`），且 `git diff --stat` 相对基线的**增量只包含这两个路径**（auth 端点无 requestBody schema 是既有事实，不需要为此补 DTO；若生成器报错则停下报告，不改生成产物）。
- [x] 2.10 契约幂等性：重跑一次 `pnpm openapi:generate`，确认第二次不再产生新的 `git diff`（幂等）。若 `pnpm openapi:check` 因**基线已有**的无关 diff 而非零退出，保留该输出并说明其与本次改动无关，不得手工改生成产物。

**回滚**：撤销本 Task 的文件与 hunk 即可；已注册数据只落在既有表，无孤儿行（spec §10 回滚①）。契约产物回滚 = 重新执行 `pnpm openapi:generate`。

**验证证据**：2.2 / 2.6 / 2.8 的命令与退出码；2.9 的 `git diff --stat` 前后对照与 `openapi.json` 命中；2.10 的幂等性结论。

---

## Task 3 · mobile（Taro H5 + weapp 双端可构建）：注册页与设置密码页

**目标**：按 spec §8.1 交付前端页面与入口，纯逻辑单测覆盖两段式的部分失败分支（§9.1 末行）。

**约束**：业务代码不得直接使用 `window`/`document`/`localStorage`/`wx`；只经 `@platform-api` / `@platform-session` / `@platform-locator`。新页面必须双端可构建。**不改** `apps/admin-web`。

**步骤**

- [x] 3.1（红灯）新增 `features/account-ui/register.ts`（**纯逻辑，不 import 平台别名**，否则根 vitest 的 node 环境解析不到别名）：

```ts
export interface RegisterSession {
  accessToken: string;
  csrfToken?: string;
  username: string;
}
export interface RegisterPorts {
  register(body: Record<string, unknown>): Promise<RegisterSession>; // 第 1 段：建号 + 会话
  applyAsPlayer(token: string, intro: string): Promise<void>; // 第 2 段：既有陪玩申请端点
}
export type PlayerApplication = "skipped" | "submitted" | "failed";
export interface RegisterOutcome {
  session: RegisterSession;
  playerApplication: PlayerApplication;
  playerError?: string;
}
export function defaultDisplayName(username: string): string; // `用户${username.slice(-4)}`
export function registerBody(input: RegisterInput): Record<string, unknown>; // 只带上真正有值的字段
export async function runRegistration(
  ports: RegisterPorts,
  input: RegisterInput,
): Promise<RegisterOutcome>;
```

`runRegistration` 行为：第 1 段失败 → 原样抛出（页面显示服务端消息，**不得**吞掉）；成功后若 `asPlayer === false` → `playerApplication: "skipped"`；若 `asPlayer === true` → 调 `applyAsPlayer`，失败时**不抛错**，返回 `{ playerApplication: "failed", playerError: message }`（message 由 `error instanceof Error ? error.message : String(error)` 提取）。

- [x] 3.2 新增 `features/account-ui/register.spec.ts`（同目录，根 vitest 会跑到），覆盖：不勾选陪玩 → 第 2 段**不被调用**且 `playerApplication === "skipped"`；勾选且申请成功 → `"submitted"`；勾选但申请失败 → `"failed"` + `playerError` 等于原始消息 + **不抛错** + 账号会话仍在返回值里（「账号已建、申请未提交」）；第 1 段失败 → 抛出且不调 `applyAsPlayer`；`defaultDisplayName("boss88") === "用户ss88"`；`registerBody` 不产生 `undefined` 值字段（`exactOptionalPropertyTypes` 语义）。
- [x] 3.3 运行 `pnpm exec vitest run --config vitest.config.ts apps/mobile/src/features/account-ui/register.spec.ts` → 记录**红灯**（`runRegistration is not a function`），实现 3.1 后转**绿灯**。
- [x] 3.4 新增 `features/account-ui/actions.ts`（平台适配层，页面只依赖它）：

```ts
export async function registerAccount(
  input: RegisterInput,
): Promise<RegisterOutcome>;
export async function setAccountPassword(input: {
  newPassword: string;
  currentPassword?: string;
}): Promise<void>;
export async function applyAsPlayer(intro: string): Promise<void>;
```

实现要点：`registerAccount` 用 `apiAdapter.request<{ accessToken: string; csrfToken?: string; principal: { username: string } }>("/api/v1/auth/register", { method: "POST", body })` 作为第 1 段端口、成功后 `session.setToken` + `session.setCsrf`，第 2 段端口用 `apiAdapter.request("/api/v1/tenant/player-applications", { method: "POST", body: { intro }, token: accessToken })`；`setAccountPassword` 调 `POST /api/v1/auth/password`（带 `session.getToken()`）；`applyAsPlayer` 供 profile 页单独使用。**不复用** `features/customer-ui/session.ts` 里的 `sendPhoneCode` 之外的登录函数（注册是独立入口）。

- [x] 3.5 新增注册页 `pages/register/index.tsx` + `index.config.ts`（`definePageConfig({ navigationBarTitleText: "注册账号" })`）+ `index.css`：字段 = 门店码（`useLoad` 时用 `tenantLocator.resolveTenant()` 预填，可手改）、用户名、密码、确认密码（两次不一致 → 本地提示，不发请求）、昵称（可选）、手机号 + 验证码（可选，验证码按钮复用 `sendPhoneCode`，倒计时与 `phone-register` 页现有实现一致）、「我是陪玩」勾选 + 申请说明输入。提交 → `registerAccount` → 成功且 `playerApplication === "failed"` 时显示「账号已创建，陪玩申请未提交，可重试」+ 重试按钮（只重试第 2 段，调 `applyAsPlayer`）；`playerApplication === "submitted"` → `Taro.redirectTo` 到 `/pages/customer/home/index`；`skipped` → 同样进老板端首页。
- [x] 3.6 新增设置密码页 `pages/account/password/index.tsx` + `index.config.ts`（「设置密码」）+ `index.css`：字段 = 新密码、确认新密码、原密码（**仅当服务端返回 400 且消息为「原密码不正确」时**才显示/要求填写——首屏默认只显示新密码两项，符合「初次免验」；一旦服务端要求原密码，就地把输入框显示出来并提示「该账号已设置过密码，需验证原密码」）。提交 → `setAccountPassword` → 成功提示「密码已设置，可用账号密码登录」并 `Taro.navigateBack()`。
- [x] 3.7 `app.config.ts` 的 `pages` 数组追加 `"pages/register/index"` 与 `"pages/account/password/index"`（放在 `"pages/index/index"` 之后）。
- [x] 3.8 `pages/index/index.tsx`：在两张 `role-card` 下方新增「还没有账号？注册」按钮 → `Taro.navigateTo({ url: "/pages/register/index" })`（**不动**现有 `openPlayer`/`openBoss` 两个入口——spec §8.1 明确 v1 不隐藏陪玩端入口）。
- [x] 3.9 `components/customer-ui/index.tsx:225-227`：在「首次登录会自动创建本店老板账号与客户档案。」下方追加两个入口按钮（注册 / 设置密码），沿用 `cu-button cu-button-outline cu-button-full` 样式与 `onNavigate` 回调（新增可选 prop，缺省不渲染 → 不影响既有调用点）。
- [x] 3.10 `pages/customer/profile/index.tsx`（在 `:155-164` 的退出按钮**上方**）新增两个按钮：「设置密码」→ `/pages/account/password/index`；「申请成为陪玩」→ 展开 `Textarea` 填申请说明 → `applyAsPlayer(intro)` → 成功后显示「已提交，等待老板审核」（失败显示服务端消息）。`pages/player/profile/index.tsx`（在 `:264-266` 上方）新增「设置密码」按钮。
- [x] 3.11 双端可构建 + 类型：`pnpm --filter @pw/mobile typecheck` 与 `pnpm --filter @pw/mobile build:weapp` 退出码 0；再跑 `pnpm --filter @pw/mobile build:h5` 退出码 0。weapp 适配器保持 typed unsupported 桩，不新增 weapp 专属实现。

**回滚**：删掉新增页面与 feature 文件、还原 4 个被修改文件的 hunk。

**验证证据**：3.3 的命令与红/绿输出；3.11 的三条命令与退出码。

---

## Task 4 · 门禁、文档同步与完成报告

**步骤**

- [x] 4.1 回归门禁（逐条记录命令与退出码）：`pnpm test` → `pnpm test:integration` → `pnpm test:tenant-isolation` → `pnpm typecheck` → `pnpm openapi:generate`（幂等）。任何一条红 → 停下按 `systematic-debugging` 定位，不得跳过。全部绿，见下方「Task 4.1 门禁证据」。
- [x] 4.2 文档同步（spec 状态行改为「SP1 已实施（`locally-verified`，未提交），SP2 已实施（`locally-verified`，未提交）」）：
  - spec §7 限流行的措辞消歧：把「且短信码校验失败不消耗建号名额」改为「且短信码校验失败**不写任何行、不建号**（限流计数仍按 §5.1 无条件记一次）」——原文与 §5.1「无条件 `recordFailure`」互相矛盾，以 §5.1 为准。
  - spec §5.1 错误表补 `403`（门店停用）与审计说明；§5.2 的审计 bullet 补「platform scope 无可归属租户，不写 `audit_logs`」（偏差 C1）；§9.1 表补注册写审计与门店停用两条用例；§9.2 表把新增用例行与租户分组说明写进去。
  - spec §12 追加：**phone-login 对停用门店的既有缺陷**（`auth.service.ts:160` 的 `TenantInactiveError` 在 `phone-login` 控制器未被捕获 → 全局过滤器返回 **500**，且该路径会先建号再抛错）——本轮**不修**（不属本 slice），登记为独立加固项；`register` 已按 403 正确处理。同时更新 §12 中「未决与未验证」的完成状态。
  - spec 批准记录追加：2026-09-26 SP2 实施完成条目（含状态 `locally-verified`、未提交）。
  - `docs/adr/0009-account-password-registration-and-multi-role-authz.md`：状态行补 SP2 实施完成；批准记录追加同一条目（含偏差 C1 与「platform 分支不写审计」的记录）。
  - `docs/DEVELOPMENT_BACKLOG.md` §三：SP2 条目由 `[~] 已批准待实施` 改为实施完成（保留 `locally-verified`/未提交口径）。
  - `docs/unverified-and-deferred.md`：§C 中「（2026-09-26 SP2 前置，**待授权**）… 当前状态：**未执行**」整条改为**已执行**（命令、退出码、`password_set_by_user | boolean | nullable=NO | default=false`、两库 44 migrations 全部核对通过、`prisma generate` 已产出该字段），并把 SP2 交付摘要写入 §E 归档。
  - 格式门禁：`pnpm exec prettier --check <改动的、未被 .prettierignore 排除的文件>`（`docs/adr/**` 与 `docs/specs/**` 在忽略清单内，`docs/superpowers/specs/**` **不在**，必须格式化通过）。
- [x] 4.3 按 spec §9.4 输出交付报告（7 项）：①准确文件清单（含 Task 1 `tenant-accounts.service.ts` 的等价重构与理由）；②迁移与回滚（已执行命令 + 退出码 + `ALTER TABLE "tenant_accounts" DROP COLUMN "password_set_by_user";`，并说明本计划未新增迁移）；③契约变化（2 个 operation + 再生成结果与 `git diff --stat`）；④租户/权限/输入/幂等/并发检查位置（§7 各行 → §9.2 用例的对应表）；⑤本次调用/读取的 skill 清单（名称、`SKILL.md` 路径、状态）；⑥实际命令、退出码与关键输出；⑦未验证/降级/未完成能力（含 spec §12 全部条目与下方的已知项）。
- [x] 4.4 状态判定：全部证据齐备才可标 `locally-verified`；**不做任何 Git 动作**（保持未提交）。判定见「Task 4.3 交付报告」末节。

**已知、本轮不做**（报告中必须列出）：陪玩端入口显隐未接线（spec §12）；端上下文判别字段仍是单值（约 60 处）；改密后不撤销其他 refresh 会话；手机号枚举 / 用户名枚举的 409 文案；`findTenantAccountById` 的 `where` 不带 `tenantId`（依赖 GUC + RLS）；phone-login 停用门店 500 缺陷；`player-applications` 的「一人一申请」并发窗口（既有实现，本轮不碰）。

## Task 4.1 门禁证据（2026-09-26）

| #   | 命令                         | 退出码 | 关键输出                                                                                                                                                                |
| --- | ---------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `pnpm test`                  | 0      | 103 个文件（102 通过 / 1 跳过）；940 条用例（939 通过 / 1 跳过）                                                                                                        |
| 2   | `pnpm test:integration`      | 0      | 61 个文件 / 310 条用例全部通过（含本 slice 新增 `account-registration.spec.ts` 13 条与 SP1 回归用例）                                                                   |
| 3   | `pnpm test:tenant-isolation` | 0      | 12 个文件 / 44 条用例全部通过                                                                                                                                           |
| 4   | `pnpm typecheck`             | 0      | 10 个 turbo 任务全绿 + `typecheck:tests`                                                                                                                                |
| 5   | `pnpm openapi:generate`      | 0      | **幂等**：连续第三次执行后 `git diff --stat -- openapi.json openapi.yaml packages/api-client/src` 与前一次完全一致（5 files changed, 73 insertions(+), 3 deletions(-)） |

契约增量的实际内容（`git diff` 增行）只含两个新路径：`/api/v1/auth/password`、`/api/v1/auth/register`。

## Task 4.2 实施状态（2026-09-26）

- 全部子项完成：spec（状态行 / §7 措辞 / §5.1 403+审计 / §5.2 C1 / §9.1 两条用例 / §9.2 用例与租户分组 / §12 四条 / 批准记录）、ADR-0009（状态行 / 决定 5 的 C1 例外 / 批准记录两条）、`docs/DEVELOPMENT_BACKLOG.md`（SP2 条目改 `[x]`）、`docs/unverified-and-deferred.md`（§C 迁移条目改「已执行」+ §E 归档摘要）。
- 格式门禁：`pnpm exec prettier --check` 于改动的 4 个受管文件（spec、本计划、`DEVELOPMENT_BACKLOG.md`、`unverified-and-deferred.md`）——spec 与本计划首轮报 warn，已 `prettier --write`（仅这两个文件）后复检 **All matched files use Prettier code style!**，退出码 0。`docs/adr/**` 在 `.prettierignore` 内（门禁不覆盖）。
- **D12（实施记录：文档指针偏差）**：4.2 原文写「`docs/DEVELOPMENT_BACKLOG.md` **§三**」，实际 SP2 条目在 **§一.3「登录与支付」**（`DEVELOPMENT_BACKLOG.md:31`），已就地修改，未移动条目位置。另原写「§C 中…整条改为已执行」——实际还补了 4.2 未列的两点：§C 新增「phone-login 停用门店 500」与「`player-applications` 并发窗口」两条登记，§E 新增 SP2 归档摘要。
- **D13（实施记录：迁移为手写单行 SQL）**：4.2 引用的 `docs/unverified-and-deferred.md` 迁移条目在改写时，如实记录了「`--create-only` 生成的 diff 会顺带重写历史手写迁移与 `schema.prisma` 的既有偏差，故按授权所附兜底改为手写单行 `ALTER TABLE`」——这是 4.2 未预料但必须落到台账的事实（迁移文件 `20260926095348_add_password_set_by_user/migration.sql` 内含该理由注释）。核验为**只读复验**：两库 `information_schema` 读出 `boolean | nullable=NO | default=false`、两库各 44 条已应用迁移且最新一条即本迁移。

---

## 一致性与偏差（需用户回执的两处 + 一处已定口径 + 实施期偏差 D2–D11）

- **A1（补充，超出 spec §5.1 原文）**：注册成功写审计 `auth.register`。理由：同模块的登录/手机登录/微信登录三条路径**都**写审计（`auth.service.ts:124-132`、`:166-174`、`:207-215`），自助建号不写会形成审计缺口。若你要求严格按 spec 字面执行，删掉 2.4 的第 ⑧ 步与 §9.1 的对应断言即可。
- **B1（补充，spec 未定义）**：停用门店（`tenants.status !== "ACTIVE"`）注册 → **403**，且在建号前拒绝。理由：spec 未给该场景的码，但给停用门店建号是明确的数据缺陷；`phone-login` 在此场景下会 500（既有缺陷，见 Task 4.2 的登记）。若你更希望与登录保持一致（401），改 2.5 的一行即可。
- **C1（偏差，受 schema 约束）**：`platform` scope 改密**不写 `audit_logs`**。`audit_logs.tenant_id` 是 `NOT NULL`（`schema.prisma:1011`），平台账号自助改密没有可归属的租户；既有平台动作的审计一律挂在**被操作租户**上（`platform-billing.service.ts:201-208`），不存在「无租户」的写法。要审计平台自助改密需另立 schema 变更（`tenant_id` 变可空或新建平台审计表）——超出 SP2 范围，故本计划按「不写」实现并在 spec §5.2 记录。
- **D1（已定口径）**：spec §7「短信码校验失败不消耗建号名额」与 §5.1「无条件 `recordFailure`」冲突，以 §5.1 为准（失败与成功都计一次），Task 4.2 改 §7 措辞。
- **D2（实施期偏差，已按 spec 修正）**：`POST /api/v1/auth/password` 对 `AccountDisabledError` / `TenantInactiveError` 返回 **401**，不是 1.9 原稿的 403。依据：spec §5.2 的错误集只有 400/401，且 `login` 对这两个错误同样按 401（`auth.controller.ts:154-162`）。1.9 代码块与本 Task 目标行已同步。**注意**：`register` 的 `TenantInactiveError` 仍按 **403**（B1 的补充，Task 4.2 在 spec §5.1 补 403）——两个端点的选择不同，是因为两节的 spec 错误集不同。
- **D3（实施期偏差）**：`isUniqueViolation` 先归一化（去下划线 + 转小写）再 `includes` 匹配，而非 2.3 原稿的直接 `f.includes(column)`。原因：`meta.target` 的形态随 Prisma/驱动版本可能是 `phoneHash`（字段名）、`phone_hash`（DB 列名）或完整约束名，原稿只覆盖后两者。调用方不变（`"phone_hash"` / `"username"`）。
- **D4（实施记录：schema 改动必须重建 `@pw/database`）**：`packages/database/package.json` 的 `types` 指向 `dist/index.d.ts`，所以改完 schema 只跑 `prisma generate` 会让消费方 `tsc` 读到**过期 dist**（本次实际踩到：7 个 TS2339/TS2353，`passwordSetByUser` 在生成类型里存在但 dist 里没有）。正确顺序：`prisma generate` → `pnpm --filter @pw/database build`（本次已执行，退出码 0）。另：集成夹具按 1.11 的顺序清理，但未清 `player_application`（本 slice 用例不产生陪玩申请行）。
- **D5（证据降级，如实记录）**：Task 1 与 Task 2 的**单元层都有完整红→绿**（11 条 `setPassword is not a function` → 11 通过；13 条 `registerTenantCustomer is not a function` → 13 通过）。但两段的**集成层只有绿灯**：实现先于集成用例落地（顺序与 2.8 所述的「对调」情形相反），红灯未取到。集成用例对同一行为的断言以单元层的红证据为前置，此点在 Task 4 报告里明写。
- **D6（实施记录：Task 3 的两处计划指针有误）**：3.5 写的「倒计时与 `phone-register` 页现有实现一致」有两处错——(a) 仓库里**没有** `phone-register` 页面（`apps/mobile/src/pages` 只有 `index` / `customer` / `player` 三个目录；手机号登录/注册的实际实现是 `pages/customer/home/index.tsx` 未登录态的 `CustomerPhoneLoginCard`）；(b) 全仓**没有**任何倒计时实现，既有形态只是一个 `sending` 布尔量（`components/customer-ui/index.tsx`）。注册页照既有形态实现（`sending` 标志 + `/^1\d{10}$/` 前置校验），未新造倒计时组件。
- **D7（偏差：未新建页面级 CSS）**：3.5/3.6 原列 `index.css`，实际两个新页面全部复用共享的 `cu-*` 类，故未新建 CSS 文件（`pages/customer` 的 12 个页面中只有 `candidates` 有页面级 CSS，无 CSS 才是本仓常态）。另按 3.8 给门户页 `pages/index/index.css` 追加了 `.register-entry*` 三条规则（该页自带 CSS，风格与既有 `role-*` / `retry-btn` 一致）。
- **D8（偏差，需用户知晓）**：3.9 只在登录卡片上加了「注册」入口，**没有**加「设置密码」入口。原因：`CustomerPhoneLoginCard` 只在 `!token`（未登录）时渲染，而 `POST /api/v1/auth/password` 需要 Bearer 会话——未登录点进去必然是死路（密码页会显示「登录状态已失效，请重新登录后再设置密码」）。「设置密码」入口由 3.10 的两个 profile 页承担（已登录态，正是「存量随机密码账号补设置密码」的场景）。若要保留计划字面行为，需另立「未登录如何设置密码」的产品设计（SP2 无短信重置密码端点）。
- **D9（实施记录：mobile 相对导入不得带 `.js`）**：`actions.ts` 起初按 API 包（NodeNext ESM）的写法写成 `from "./register.js"`，`typecheck` 通过但 `build:weapp` 直接失败（webpack 字面找 `register.js` 文件：`doesn't exist`）。mobile 的既有约定是无扩展名相对导入（`components/customer-ui/index.tsx` 的 `"./modules"`）。已改回无扩展名（`actions.ts` 与 `register.spec.ts` 各一处）。
- **D10（实施记录：3.1/3.2 顺序对调）**：按 TDD 取红灯，先落类型骨架 + spec 再补实现（与 2.8 所述的「对调」同因）。3.3 的红灯为 **6 条 `registerBody is not a function`**（`pnpm exec vitest run --config vitest.config.ts apps/mobile/src/features/account-ui/register.spec.ts`），实现后同命令 6/6 通过。
- **D11（实施记录：3.4 的 ports 不导出）**：`actions.ts` 中接线的 `ports` 常量保持模块私有，只导出计划列出的三个函数（`registerAccount` / `setAccountPassword` / `applyAsPlayer`）——页面只依赖这三个。另：`registerPage` 的 `新用户`/`原生页面` 路径深度不同（`pages/register/` 是 2 层、`pages/account/password/` 是 3 层），相对导入已按各自深度写对。

## Task 3 实施状态（2026-09-26）

- 3.1–3.11 全部完成：`pnpm --filter @pw/mobile typecheck` → 退出码 0；`build:weapp` → 0；`build:h5` → 0（h5 仅一条既有入口体积 warning，非错误）；纯逻辑层 6/6 通过（红灯见 D10）。
- 未创建的类型：页面级 CSS（见 D7）。
- Task 3 无集成层步骤，故不存在红灯缺失问题。

## 自检（writing-plans 清单）

1. spec §4 SP2 与 §5–§10 的每一条都能落到 Task 1/2/3；§1.2 的非目标逐条在「Scope and non-goals」中排除。
2. 无 TBD / 「类似 Task N」/ 未命名接口：所有新增符号（`AuthInputError`、`UsernameTakenError`、`TenantNotFoundError`、`CurrentPasswordInvalidError`、`findTenantByCode`、`registerTenantCustomer`、`updateTenantAccountPassword`、`updatePlatformAccountPassword`、`setPassword`、`runRegistration`、`registerAccount`、`setAccountPassword`、`applyAsPlayer`）都在本计划内首次定义并给出签名。
3. 文件路径、命令、常量、行锚点均已对照仓库核实（见「接缝地图」）；`REGISTER_MAX_ATTEMPTS`/`REGISTER_WINDOW_MS` 与 §5.1 一致；集成用例的租户分组规避了限流键互相挤占。
4. 任务边界可独立评审：Task 1（改密）不依赖 Task 2；Task 3 只依赖两个端点的既有契约；Task 4 是门禁与文档。
5. 每个 Task 都有红→绿证据命令与退出码要求；持久副作用有二，均有回滚方式——契约产物重跑 `openapi:generate`；**一次新增列迁移**（2026-09-26 因 F4 修正追加，见 §10 与 D13）回滚为 `DROP COLUMN`。无 Git 动作、无部署。
6. 无任何步骤暗含安装依赖、提交、推送、上传、部署或改远程环境的授权。

---

## Task 4.3 交付报告（2026-09-26，spec §9.4 七项）

状态用语：本 slice 为 **`locally-verified`**（本地可复现的命令与退出码齐备），**未提交**（无任何 Git 动作）。以下逐项给出，缺项显式标注。

### ① 修改的准确文件清单

**SP1（多角色授权解析，前置）**

| 文件                                                                | 改动                                                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `apps/api/src/modules/identity-access/domain/roles.ts`              | 新增 `ROLE_PRIORITY`、`sortRolesByPriority`、`permissionsForAny`                      |
| `apps/api/src/modules/identity-access/domain/principal.ts`          | `AccessPrincipal` 增加 `roles?: readonly RoleKey[]`（越界，已获用户 2026-09-26 授权） |
| `apps/api/src/modules/identity-access/infrastructure/tokens.ts`     | JWT 签发/校验 `roles` claim                                                           |
| `apps/api/src/common/auth/permissions.guard.ts`                     | 权限按角色集求并集；缺 `roles` 回退 `[role]`（越界，已获授权）                        |
| `apps/api/src/modules/identity-access/application/auth.service.ts`  | 主角色由 `roles[0]` 改为按 `ROLE_PRIORITY` 排序取首个                                 |
| `apps/api/src/common/auth/permissions.guard.spec.ts`（新增）        | 并集 / 回退 / 无 principal 放行 / 缺权限 403                                          |
| `apps/api/src/modules/identity-access/domain/roles.spec.ts`（新增） | `sortRolesByPriority` 确定性                                                          |
| `tests/integration/player-application.spec.ts`                      | 追加「多角色（SP1 回归）」用例（修复前红灯 `expected 200 "OK", got 403 "Forbidden"`） |

**SP2（注册与改密）**

| 文件                                                                                                                                         | 改动                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/modules/identity-access/domain/account-credentials.ts`（新增）                                                                 | 用户名/密码/昵称规则常量，供自助注册、改密与后台建号三处共用                                                                                                                                  |
| `apps/api/src/modules/identity-access/domain/errors.ts`                                                                                      | 新增 `AuthInputError` / `UsernameTakenError` / `TenantNotFoundError` / `CurrentPasswordInvalidError` 等                                                                                       |
| `apps/api/src/modules/identity-access/application/auth.service.ts`                                                                           | 新增 `registerTenantCustomer`、`setPassword`                                                                                                                                                  |
| `apps/api/src/modules/identity-access/application/auth-ports.ts`                                                                             | 端口扩展（注册/改密所需的仓储方法签名）                                                                                                                                                       |
| `apps/api/src/modules/identity-access/application/tenant-accounts.service.ts`                                                                | **等价重构**：改用 `account-credentials.ts` 的共享常量（详见下方「Task 1 等价重构」）                                                                                                         |
| `apps/api/src/modules/identity-access/infrastructure/auth.repository.ts`                                                                     | 新增 `registerTenantCustomer`（单事务三写）、`updateTenantAccountPassword`、`updatePlatformAccountPassword`、`findTenantByCode`、`findPlatformAccountById`；唯一约束冲突按 `meta.target` 转译 |
| `apps/api/src/modules/identity-access/interface/auth.controller.ts`                                                                          | 新增 `POST register` 与 `POST password` 两个 handler 及其错误映射                                                                                                                             |
| `apps/api/src/modules/identity-access/application/auth-register.spec.ts`（新增）                                                             | §9.1 注册单测 13 条                                                                                                                                                                           |
| `apps/api/src/modules/identity-access/application/auth-password.spec.ts`（新增）                                                             | §9.1 改密单测 11 条                                                                                                                                                                           |
| `apps/api/src/modules/identity-access/application/auth.service.spec.ts`                                                                      | 既有用例随签发/守卫变更同步                                                                                                                                                                   |
| `apps/api/src/modules/identity-access/application/auth-phone-binding.spec.ts`                                                                | 同上                                                                                                                                                                                          |
| `tests/integration/account-registration.spec.ts`（新增）                                                                                     | §9.2 集成 13 条（8 注册 + 5 改密）                                                                                                                                                            |
| `packages/database/prisma/schema.prisma`                                                                                                     | `tenant_accounts.passwordSetByUser`（`@map("password_set_by_user")`）                                                                                                                         |
| `packages/database/prisma/migrations/20260926095348_add_password_set_by_user/`（新增）                                                       | 手写单行迁移（理由见文件内注释与 D13）                                                                                                                                                        |
| `openapi.json` / `openapi.yaml` / `packages/api-client/src/{index.ts,sdk.gen.ts,types.gen.ts}`                                               | 契约再生成（生成产物，未手工编辑）                                                                                                                                                            |
| `apps/mobile/src/features/account-ui/register.ts`（新增）                                                                                    | 两段式纯逻辑层                                                                                                                                                                                |
| `apps/mobile/src/features/account-ui/register.spec.ts`（新增）                                                                               | 两段式单测 6 条（红灯 6 条 `registerBody is not a function`，见 D10）                                                                                                                         |
| `apps/mobile/src/features/account-ui/actions.ts`（新增）                                                                                     | 平台适配层（页面只依赖它）                                                                                                                                                                    |
| `apps/mobile/src/pages/register/{index.tsx,index.config.ts}`（新增）                                                                         | 注册页                                                                                                                                                                                        |
| `apps/mobile/src/pages/account/password/{index.tsx,index.config.ts}`（新增）                                                                 | 设置密码页（两端共用）                                                                                                                                                                        |
| `apps/mobile/src/app.config.ts`                                                                                                              | 注册两个新页                                                                                                                                                                                  |
| `apps/mobile/src/components/customer-ui/index.tsx`                                                                                           | `CustomerPhoneLoginCard` 增加 `onRegister?`（仅注册入口，见 D8）                                                                                                                              |
| `apps/mobile/src/pages/index/index.tsx` + `index.css`                                                                                        | 门户页「注册新账号」入口 + `.register-entry*` 三条规则                                                                                                                                        |
| `apps/mobile/src/pages/customer/home/index.tsx`                                                                                              | 传入 `onRegister`                                                                                                                                                                             |
| `apps/mobile/src/pages/customer/profile/index.tsx`                                                                                           | 「设置密码」入口 + 「申请成为陪玩」（含申请说明表单）                                                                                                                                         |
| `apps/mobile/src/pages/player/profile/index.tsx`                                                                                             | 「设置密码」入口                                                                                                                                                                              |
| `docs/superpowers/specs/2026-09-26-account-password-registration-design.md`                                                                  | 状态行、§5.1、§5.2、§7、§9.1、§9.2、§12、批准记录                                                                                                                                             |
| `docs/adr/0009-account-password-registration-and-multi-role-authz.md`                                                                        | 状态行、决定 5（C1 例外）、批准记录                                                                                                                                                           |
| `docs/DEVELOPMENT_BACKLOG.md`、`docs/unverified-and-deferred.md`                                                                             | 台账同步（§C 迁移改「已执行」、§E 归档 SP2 摘要、SP2 条目改 `[x]`）                                                                                                                           |
| `docs/superpowers/plans/2026-09-26-multi-role-authz-resolution.md`、`docs/superpowers/plans/2026-09-26-account-password-registration-sp2.md` | 两份实施计划（含偏差与证据记录）                                                                                                                                                              |

**不属于本 slice 的工作区改动（不得随本 slice 一起提交）**：`apps/admin-web/app/_lib/api.ts`（+74，会话自动刷新 single-flight）、`apps/admin-web/app/_lib/api.spec.ts`（未跟踪，同上）、`apps/admin-web/app/(platform)/login/page.tsx`、`apps/admin-web/app/(tenant)/store/login/page.tsx`、`apps/admin-web/app/_lib/data-grid/data-grid.css`、`apps/admin-web/next-env.d.ts`、`vitest.config.ts`（+1）。这些改动早于/独立于本 slice 的工作（见 `git status --short`），本计划全程未触碰 `apps/admin-web`（spec §8.2：无改动）与根 `vitest.config.ts`。

**Task 1 等价重构（`tenant-accounts.service.ts`）与其理由**：该文件原有的用户名/密码校验常量与文案被**原样搬进** `domain/account-credentials.ts`（`USERNAME_PATTERN` / `USERNAME_RULE_MESSAGE` / `PASSWORD_MIN_LENGTH` / `PASSWORD_MAX_LENGTH` / `PASSWORD_RULE_MESSAGE`），文件内改为 import。理由：自助注册、改密端点与后台建号必须共用同一套规则，否则三处文案与边界会各自漂移；放到 `domain/` 层可同时被 `application/` 与端点层引用且不依赖基础设施。**行为等价**（常量值、文案、trim 语义均未变），既有 `tenant-accounts` 相关单测未改断言即通过。

### ② 数据库迁移与回滚

- **命令与结果（2026-09-26 执行）**：`pnpm --filter @pw/database migrate:dev -- --name add_password_set_by_user`（先 `--create-only` 核对）→ 两库 deploy，退出码 **0**；随后 `prisma generate` 与 `pnpm --filter @pw/database build`，退出码均为 **0**（后者为偏差 D4 所必需）。
- **为何是手写单行 SQL**：`--create-only` 生成的 diff 会顺带重写历史手写迁移与 `schema.prisma` 的既有偏差（自定义 FK/索引名、`id` 列 DROP DEFAULT、`normalized_name SET NOT NULL` 等），与本次变更无关 ⇒ 按授权所附兜底改为手写 `ALTER TABLE "tenant_accounts" ADD COLUMN "password_set_by_user" BOOLEAN NOT NULL DEFAULT false;`（理由写在 `migration.sql` 注释内）。
- **复验（本次只读）**：两库 `information_schema.columns` 均读出 `public.tenant_accounts | password_set_by_user | boolean | nullable=NO | default=false`；两库 `_prisma_migrations` 均为 **44** 条已应用，最新一条即 `20260926095348_add_password_set_by_user`。
- **回滚**：`ALTER TABLE "tenant_accounts" DROP COLUMN "password_set_by_user";`。代码回滚无需降级脚本（新列只被 `password` 端点分支读取）。
- **本计划未新增其他迁移**；`register` / `password` 的其余写入全部落在既有表与既有列。

### ③ API 契约变化

- 新增 **2 个 operation**：`POST /api/v1/auth/register`、`POST /api/v1/auth/password`。`git diff --stat`（再生成后，跑三次结果一致 ⇒ 幂等）：`openapi.json` 28 增、`openapi.yaml` 16 增、`packages/api-client/src/index.ts` 4（2 增 2 删）、`sdk.gen.ts` 6（5 增 1 删）、`types.gen.ts` 22 增——5 files changed, **73 insertions(+), 3 deletions(-)**。
- `git diff` 增行只含上述两个路径（已核对 `grep '"/api/v1/...'` 唯一命中两条）。
- **JWT claim 变化**：access token payload 新增 `roles`（`role` 保留）——这是 SP1 的契约变化，旧 token 因守卫回退 `[role]` 仍可用。

### ④ 租户 / 权限 / 输入 / 幂等 / 并发 检查位置（spec §7 逐行 → 用例）

| §7 边界                     | 实现位置                                                                                                                                         | 覆盖用例                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| 未登录可写数据库 ⇒ 限流     | `auth.controller.ts` `register` handler（`REGISTER_MAX_ATTEMPTS=5` / `REGISTER_WINDOW_MS=15min`，键含 `tenantCode`，**无条件** `recordFailure`） | 集成 `D 注册尝试按次数计数：第 6 次 → 429`；单测「各失败路径不建号」                                |
| 租户归属不可信              | 服务端只用 `resolveTenantId(tenantCode)`；`registerTenantCustomer` 签名不含 `tenantId` 入参                                                      | 集成 `C 门店不存在 → 404`；单测「租户不存在」                                                       |
| 门店停用（B1 补充）         | 建号**前**判 `tenants.status`                                                                                                                    | 单测「门店停用 → `TenantInactiveError`，且建号前就拒绝」（集成层未覆盖，已在 spec §9.2 标注）       |
| 用户名枚举（接受）          | 409 文案                                                                                                                                         | 集成 `A2 同租户重复用户名 → 409`；单测「用户名不合规」                                              |
| 手机号枚举 / 短信码前置     | 先 `consumeCode` 再查重                                                                                                                          | 集成 `A4 手机号已被占用 → 409`、`E 短信码错误 → 400`；单测「给了手机号却没给验证码」                |
| 密码强度                    | `PASSWORD_MIN_LENGTH` / `PASSWORD_MAX_LENGTH`                                                                                                    | 单测「密码长度 7 与 129 → `AuthInputError`」                                                        |
| 改密校验原密码（F4）        | `setPassword` 由 `passwordSetByUser` 分支                                                                                                        | 集成 5 条（未认证 401 / 初次免验 / 修改缺 `currentPassword` 400 / 改错 400 / 改对成功）+ 单测 11 条 |
| 越权                        | `password` 端点只改 `principal.sub` 对应账号，不接受目标账号参数                                                                                 | 集成「未认证 → 401（Bearer 缺失）」；`auth-password.spec.ts` 分支断言                               |
| 幂等 / 并发（唯一约束兜底） | `registerTenantCustomer` 的 `create` 捕获唯一冲突 → `isUniqueViolation` 归一化匹配后转译 409                                                     | 单测「仓储唯一约束兜底（预查重竞态）…不吞异常」；集成 `A2`/`A4` 断言「账号数不变」                  |
| 多角色授权并集（SP1）       | `permissions.guard.ts` + `ROLE_PRIORITY`                                                                                                         | `tests/integration/player-application.spec.ts` 六条判据（spec §9.2 更正块）                         |
| 租户隔离（RLS/GUC）         | 既有 `withTenantContext` + RLS                                                                                                                   | `pnpm test:tenant-isolation` 12 文件 / 44 用例全绿                                                  |

### ⑤ 本次调用/读取的 skill 清单

| 名称                           | `SKILL.md` 路径                                                          | 状态                                 |
| ------------------------------ | ------------------------------------------------------------------------ | ------------------------------------ |
| `development-lifecycle-router` | `C:\Users\Listener\.claude\skills\development-lifecycle-router\SKILL.md` | 成功完整读取并执行（路由与权限门控） |
| `brainstorming`                | `C:\Users\Listener\.claude\skills\brainstorming\SKILL.md`                | 成功完整读取并执行（产出 spec）      |
| `writing-plans`                | `C:\Users\Listener\.claude\skills\writing-plans\SKILL.md`                | 成功完整读取并执行（产出两份计划）   |
| `tdd`                          | `C:\Users\Listener\.claude\skills\tdd\SKILL.md`                          | 成功完整读取并执行（红→绿循环）      |

未使用（及原因）：`frontend-design` / `ui-ux-pro-max` 等 UI 设计类 skill 未启用——本 slice 的前端改动是既有 `cu-*` / `pw-*` 组件体系内的填写与入口接线，无新设计语言；`code-review` / `semgrep` 等质量与安全 handler 未在本 slice 内触发（未获授权、且属独立动作）。

### ⑥ 实际执行的命令、退出码与关键输出

见上方「Task 4.1 门禁证据」表（5 条全绿）+ 本次补充：

| 命令                                                                                                  | 退出码 | 关键输出                                              |
| ----------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------- |
| `pnpm --filter @pw/mobile typecheck`                                                                  | 0      | —                                                     |
| `pnpm --filter @pw/mobile build:weapp`                                                                | 0      | 6.11s（修掉 D9 的 `.js` 扩展名后）                    |
| `pnpm --filter @pw/mobile build:h5`                                                                   | 0      | 15.4s，仅一条既有入口体积 warning                     |
| `pnpm exec vitest run --config vitest.config.ts apps/mobile/src/features/account-ui/register.spec.ts` | 0      | 6/6 通过（红灯见 D10）                                |
| `docker exec … psql -tAc "…information_schema.columns…"`（两库）                                      | 0      | `boolean \| nullable=NO \| default=false`（两库一致） |
| `docker exec … psql -tAc "select count(*), max(migration_name) from _prisma_migrations …"`（两库）    | 0      | `44 \| 20260926095348_add_password_set_by_user`       |
| `pnpm exec prettier --check <4 个受管文档>`                                                           | 0      | `All matched files use Prettier code style!`          |

### ⑦ 未验证、降级或未完成的能力

- **D5（证据降级，必须披露）**：Task 1 / Task 2 的**单元层**有完整红→绿（11 条 `setPassword is not a function` → 11 通过；13 条 `registerTenantCustomer is not a function` → 13 通过），但两段的**集成层只有绿灯**——实现先于集成用例落地，**红灯未取到**。集成用例对同一行为的断言以单元层红证据为前置，此处如实登记为证据缺口。
- **spec §12 全部条目**：①陪玩端入口显隐未接线（v1 维持两入口并列，靠接口 403 兜底）；②端上下文判别字段仍是单值（约 60 处 `principal.role !== "PLAYER"` 式判端），SP1 只修权限层；③改密后不撤销其他 refresh 会话（有意不做）；④`findTenantAccountById` 的 `where` 不带 `tenantId`（依赖 GUC + RLS，已知依赖）；⑤用户名/手机号枚举的 409 文案（接受）；⑥**phone-login 对停用门店的既有缺陷**（先建号后抛错且控制器未捕获 → 500，本轮不修，已登记独立加固项）；⑦`player-applications` 的「一人一申请」并发窗口（既有实现，本轮不碰）。
- **Task 3 的实施期偏差**：D6（计划的两处指针有误）、D7（未新建页面级 CSS，复用 `cu-*`）、D8（登录卡片只加「注册」入口，未加「设置密码」——该卡片仅在未登录态渲染，而改密端点需 Bearer 会话）、D9（mobile 相对导入不得带 `.js`）、D10（3.1/3.2 顺序对调取红灯）、D11（`ports` 保持模块私有）。
- **未覆盖的验证形态**：本 slice 无 E2E / 真机 weapp 验证（`build:weapp` 只证明可构建，weapp 运行时适配器仍为 typed unsupported 桩）；无视觉回归；无并发压测（并发只由 DB 唯一约束兜底并用单测覆盖转译逻辑）。
- **未提交**：本 slice 的全部产物都停留在工作区（`git status` 可查），未做任何 Git 动作。

### Task 4.4 状态判定

- 判定：**`locally-verified`**（`code-changed` 的超集：本地命令与退出码齐备、门禁全绿、迁移已执行并复验）。
- **不做任何 Git 动作**：无分支、无提交、无推送（保持未提交）。

### Task 4.5 提交记录（2026-09-26，用户另行授权后执行）

- 授权：用户以 AskUserQuestion 选定「提交本 slice」→「先建分支再提交（推荐）」+「拆 6 笔（推荐）」。Task 4.4 的「无 Git 动作」判定在授权前成立，此处仅追加记录，不回改。
- 分支：`feat/account-password-registration`（base `master` @ `9a742d0`），**6 笔提交 `9e0bbe4..HEAD`**，**未推送、无 PR**。
- 分笔（按层拆分，与本仓历史一致）：①`feat(db)` 迁移 + `schema.prisma`；②`feat(auth)` identity-access 源码；③`chore(openapi)` 契约与生成客户端；④`test(auth)` 单测与集成用例；⑤`feat(mobile)` 注册页/设置密码页与入口接线；⑥文档同步（spec / ADR-0009 / 两份计划 / 两份台账），即本笔。
- **明确排除**（不属本 slice、仍在工作区）：`apps/admin-web/{app/_lib/api.ts,app/_lib/api.spec.ts,app/(platform)/login/page.tsx,app/(tenant)/store/login/page.tsx,app/_lib/data-grid/data-grid.css,next-env.d.ts}`、根 `vitest.config.ts`、`work/**`、`apps/admin-web/.next.stale-20260926/`。
- C2 落定后执行 `pnpm --filter @pw/api typecheck`（退出码 0）确认该笔自洽，分组无需调整。
- 状态升级：`locally-verified` → **`committed`**；`pushed` 与 PR 仍需另行授权，不在本笔范围。

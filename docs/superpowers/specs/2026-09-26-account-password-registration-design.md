# 账号密码自助注册与多角色授权解析设计 v1

- 状态：**方向已批准，书面复核已回执；SP1 与 SP2 均已实施并提交（`committed`，分支 `feat/account-password-registration`，6 笔提交 `9e0bbe4..HEAD`，base `master` @ `9a742d0`；**未推送**）**（2026-09-26）
- 日期：2026-09-26
- 产品边界：身份入口（自助注册、手机号可选绑定、密码激活）与多角色授权解析；不是账号体系重构，不引入跨租户身份。
- 关联：ADR-0009（本设计的决策记录）、主规格 §7/§16.1、ADR-0007（租户仓储不变量）、`docs/acceptance/slice-2-acceptance.md`

## 1. 目标与非目标

### 1.1 目标

1. 老板（`CUSTOMER`）与陪玩（`PLAYER`）都能用**账号 + 密码**自助注册，不再依赖管理员建号或手机验证码。
2. 手机号成为**可选**信息：注册时可不填；绑定后，手机号登录与账号密码登录**收敛到同一个账号**。
3. 存量账号（手机/微信隐式注册、密码为随机值，用户不可知）能通过「设置密码」入口激活密码登录。
4. 自助注册的陪玩经老板审核后获得陪玩能力——复用已上线的陪玩入驻审核流。
5. 修正多角色账号（已批准陪玩）的授权解析，使其稳定获得角色权限**并集**。

### 1.2 非目标

- 不引入跨租户账号。`tenant_accounts` 的租户内唯一性是 ADR-0007 不变量，保持不变；同一人在两家店仍是两个账号。
- 不做修改手机号、解绑手机号、找回密码、邮箱验证。
- 不改 `POST /api/v1/auth/phone-login` 的自动注册语义——「手机优先」用户路径完全不变。
- 不做账号合并。手机号冲突时拒绝并指路，不自动合并两个账号。
- 不新增 `PENDING` 账号态；陪玩审核前账号即可正常使用老板功能。
- 不触碰 weapp（`apps/mobile/src/platform/weapp/**` 保持 typed unsupported 桩）。
- 不修改 `apps/api/src/modules/player-applications/**`。
- 不做密码强度策略升级（沿用现有 8–128 字符规则）。
- v1 不在改密后撤销其他 refresh 会话（见 §12）。

## 2. 当前事实

| 事实                                                                 | 证据                                                                                    |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 无任何注册端点；账号来自手机登录、微信登录、管理员建号三条路径       | `auth.service.ts:134-153`、`:176-194`、`tenant-accounts.service.ts:85-122`              |
| 隐式注册的密码是 `randomBytes(18).toString("base64url")`，用户不可知 | `auth.service.ts:144-145`、`:185-186`                                                   |
| `passwordHash` 非空、无默认值                                        | `packages/database/prisma/schema.prisma:160`                                            |
| 无 `displayName` 列；昵称落 `customer_profiles.name`                 | `schema.prisma:156-178`、`auth.repository.ts:170`                                       |
| 全仓无 set/change/reset password 路由                                | `grep` 在 `apps/api` 下 0 个路由命中                                                    |
| 用户名规则 `/^[a-zA-Z0-9_-]{2,64}$/`（trim 后）                      | `tenant-accounts.service.ts:44-50`                                                      |
| 密码规则 8–128 字符                                                  | `tenant-accounts.service.ts:52-60`                                                      |
| `phoneHash` 是确定性 HMAC，输入含 `tenantId`                         | `common/pii/phone.ts:43-45`                                                             |
| 同租户同手机号唯一是 DB 强约束                                       | `schema.prisma:174`、`20260910040000_phone_verification_p1/migration.sql:6-7`           |
| 未登录用户靠请求体 `tenantCode` 定租户                               | `auth.controller.ts:169,183` → `auth.service.ts:130-132` → `auth.repository.ts:111-117` |
| `CUSTOMER` 权限集含 `tenant.view`                                    | `domain/roles.ts:113-118`                                                               |
| 陪玩申请要求申请者已是 `CUSTOMER`                                    | `player-applications.service.ts:67-70`                                                  |
| 批准陪玩只追加 `PLAYER`、不移除 `CUSTOMER`                           | `player-applications.service.ts:174-182`                                                |
| JWT 角色取 `account.roles[0]`（无排序）                              | `auth.service.ts:53`                                                                    |
| `AccessPrincipal.role` 是单数；守卫按单角色算权限                    | `domain/principal.ts:8`、`common/auth/permissions.guard.ts`                             |
| H5 已有统一 API 适配器与 session 存储                                | `platform/h5/api-adapter.ts:5-39`、`platform/h5/session-store.ts:10-51`                 |
| mobile 无陪玩申请入口                                                | `grep` 在 `apps/mobile` 下 0 命中                                                       |
| 商家端已有陪玩审核页                                                 | `merchant-console/module-views.tsx:63`（`PlayerApplicationsModuleView`）                |

## 3. 核心决策

| 编号 | 决策                                           | 固定口径                                                                                                                 |
| ---- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| F1   | 注册一律建 `CUSTOMER` 账号                     | 注册过程**永不**直接授予 `PLAYER`；`PLAYER` 只能经老板审批叠加                                                           |
| F2   | 手机号是可选绑定，不是建号方式                 | 带 `phone` 才绑定；`phoneHash` 冲突返回 409 并指向「设置密码」路径                                                       |
| F3   | 陪玩意向由**客户端两段式**提交                 | 注册成功后由客户端携带新会话调既有 `POST /api/v1/tenant/player-applications`；该步失败不回滚账号                         |
| F4   | 设密码：初次免验原密码、修改必验               | 分支由服务端按 `passwordSetByUser` 判定（§5.2）：`false` → 免验原密码；`true` → 必验。两情形都写审计 `auth.password.set` |
| F5   | JWT 新增 `roles[]`，保留 `role` 作确定性主角色 | 权限按 `roles` 求并集；无 `roles` 时回退 `[role]`                                                                        |
| F6   | 一次新增列迁移（2026-09-26 由「零迁移」改）    | `tenant_accounts` 新增 `password_set_by_user`（`NOT NULL DEFAULT false`）；其余写入仍落在既有表与既有列（§10）           |
| F7   | 新公开端点必须限流                             | 复用既有 Redis 共享限流，不与登录共用同一计数器                                                                          |
| F8   | 昵称落 `customer_profiles.name`                | `tenant_accounts` 不加列                                                                                                 |
| F9   | 多角色账号默认落地**老板端（用户端）**         | `ROLE_PRIORITY` 中 `CUSTOMER` 先于 `PLAYER`；陪玩端入口在账号存在陪玩申请（待审或已批准）时才出现，不由 `role` 单独决定  |

## 4. 阶段划分

### SP1 · 多角色授权解析修复（前置，独立可交付）

**为什么必须先做**：`player_applications.service.ts:174-182` 批准时只追加 `PLAYER`、不移除 `CUSTOMER`，而申请入口要求申请者已是 `CUSTOMER`——因此**今天**任何经老板批准的陪玩都持有两行角色。叠加 `auth.service.ts:53` 的 `roles[0]`（无排序）与 `permissions.guard.ts` 的单角色计算，该账号的 JWT 角色由数据库返回顺序决定，**稳定地丢掉一半权限**。这是既有缺陷，SP2 的陪玩半边会踩在它上面。

**改动文件**

| 文件                                                                  | 改动                                                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/modules/identity-access/domain/roles.ts`                | 新增 `ROLE_PRIORITY` 常量与 `sortRolesByPriority(roles)`                                                                             |
| `apps/api/src/modules/identity-access/domain/principal.ts`            | `AccessPrincipal` 增加 `roles?: readonly RoleKey[]`（可选，`role` 保留；可选是为了让旧 token 校验后保持 `undefined` 并触发守卫回退） |
| `apps/api/src/modules/identity-access/application/auth.service.ts:53` | `roles[0]` → 按 `ROLE_PRIORITY` 排序后取首个；签发时同时写入 `roles` 与 `role`                                                       |
| `apps/api/src/common/auth/permissions.guard.ts`                       | `permissionsFor(principal.role)` → 对 `principal.roles ?? [principal.role]` 求权限并集                                               |

**越界声明**：`permissions.guard.ts` 与 `principal.ts` 不属注册切片，但不修则「陪玩注册 + 审核」交付即坏功能。用户已于 2026-09-26 批准该越界。

**`ROLE_PRIORITY` 取值**（2026-09-26 用户确认）：管理类角色在前，**`CUSTOMER` 先于 `PLAYER`**。

```ts
export const ROLE_PRIORITY: readonly RoleKey[] = [
  "PLATFORM_SUPER_ADMIN",
  "PLATFORM_SUPPORT",
  "TENANT_OWNER",
  "TENANT_ADMIN",
  "CUSTOMER_SERVICE",
  "FINANCE",
  "CUSTOMER",
  "PLAYER",
];
```

即双角色账号的 `role` 取到 `CUSTOMER`，**默认落地老板端（用户端）**。

**为什么 `CUSTOMER` 在 `PLAYER` 之前**（用户口径）：「成品默认用户端，用户端也是老板端，所以陪玩端需要用户登录有申请的情况下才会指向陪玩端。」陪玩端是**叠加态**而非替代态——老板端是所有账号的基线落地面。`role` 是单值，只能表达「默认落哪个端」；「是否出现陪玩端入口」由**账号是否存在陪玩申请（`PENDING` 或 `APPROVED`）**决定，不由 `role` 决定。管理类角色置于 `CUSTOMER` 之前，保证店主/客服等多角色账号默认落在管理端而非老板端。

**兼容性**：`roles` 是**新增** claim。守卫对缺失 `roles` 的旧 token 回退到 `[role]`，行为与今天完全一致。

### SP2 · 账号密码自助注册（主功能）

见 §5–§9。

## 5. API 契约

### 5.1 `POST /api/v1/auth/register`

- 认证：`@Public()`（未登录可访问）
- 限流：注入 `RateLimitService`（`common/auth/rate-limit.service.js`；配 `REDIS_URL` 时为 `RedisRateLimitService`，未配时内存回退）。键 `{req.ip ?? "unknown"}:register:{tenantCode}`，新增常量 `REGISTER_MAX_ATTEMPTS = 5`、`REGISTER_WINDOW_MS = 15 * 60 * 1000`（对齐 `auth.controller.ts:44-45` 的登录参数）。流程：先 `isBlocked` → 429「too many attempts」，再**无条件** `recordFailure` 计数。
  > 与登录的差别：登录按**失败次数**限流（成功即 `reset`），注册按**尝试次数**限流——因为每次成功都会建号，成功的请求同样要占额度。
- 语义：在指定租户内创建 `CUSTOMER` 账号，并直接签发会话

**请求体**

| 字段          | 类型   | 必填 | 规则                                                                                 |
| ------------- | ------ | ---- | ------------------------------------------------------------------------------------ |
| `tenantCode`  | string | 是   | 必须命中既有 `tenants.code`                                                          |
| `username`    | string | 是   | trim 后 `/^[a-zA-Z0-9_-]{2,64}$/`（沿用 `tenant-accounts.service.ts:44-50`）         |
| `password`    | string | 是   | 8–128 字符（沿用 `:52-60`）                                                          |
| `displayName` | string | 否   | trim 后 1–50 字符；缺省为 `用户${username.slice(-4)}`；写入 `customer_profiles.name` |
| `phone`       | string | 否   | 填写时 `code` 必填；规范化后写 `phoneEnc` + `phoneHash`                              |
| `code`        | string | 条件 | 仅当提供 `phone` 时必填；由既有 `POST /api/v1/auth/phone-verification-code` 签发     |

**响应 201**

```jsonc
{
  "data": {
    "accessToken": "…",
    "principal": {
      "sub": "…",
      "scope": "tenant",
      "role": "CUSTOMER",
      "roles": ["CUSTOMER"],
      "username": "…",
      "tenantId": "…",
    },
    "expiresInSeconds": 900,
    "csrfToken": "…",
  },
}
```

外加 `Set-Cookie` 写 refresh token（沿用 `interface/auth-cookies.ts` 既有约定）。

**错误**

| 码  | 场景                                        | 消息要点                                                              |
| --- | ------------------------------------------- | --------------------------------------------------------------------- |
| 400 | 用户名格式、密码长度、缺 `code`、短信码错误 | 与既有校验文案一致                                                    |
| 403 | 门店已停用（`tenants.status !== "ACTIVE"`） | 「门店已停用，无法登录」，**建号前**拒绝（B1 补充，原文未定义该场景） |
| 404 | `tenantCode` 不存在                         | 沿用 `resolveTenantId` 既有语义                                       |
| 409 | 用户名在该租户已存在                        | 「该用户名已被使用」                                                  |
| 409 | 手机号在该租户已绑定其他账号                | 「该手机号已绑定其他账号，请改用手机号登录后在『设置密码』中激活」    |
| 429 | 触发限流                                    | 与既有登录限流文案一致                                                |

**事务边界**：单个 `withTenantContext` 事务内完成 `tenant_accounts` + `tenant_account_roles(CUSTOMER)` + `customer_profiles` 三处写入。短信码校验在事务前完成（只读）。

**审计**：注册成功写 `auth.register`（`resource_type=tenant_account`，`summary=自助注册成功：{username}`）。这是 **A1 的补充**（原文只定义了 `password` 端点的审计）：同模块的登录 / 手机号登录 / 微信登录三条路径都写审计，自助建号不写会形成缺口。失败路径不写审计。新账号的 `password_set_by_user` 直接置 **`true`**——密码是用户自己选的，此后每次改密都必须验原密码（§5.2）。

### 5.2 `POST /api/v1/auth/password`

- 认证：**已登录**（`platform` 与 `tenant` 两种 scope 皆可）
- 语义：设置或修改当前账号密码

**请求体**

| 字段              | 类型   | 必填         | 规则                                                             |
| ----------------- | ------ | ------------ | ---------------------------------------------------------------- |
| `newPassword`     | string | 是           | 8–128 字符                                                       |
| `currentPassword` | string | **条件必填** | 仅当该账号已被用户设过密码（`passwordSetByUser === true`）时必填 |

**响应 200**：`{ "data": { "ok": true } }`

**行为**（分支由**服务端**判定，前端不得代替）

- 判定依据：`tenant_accounts.password_set_by_user`（§10 新增列）。客户端无法影响该判定——否则被窃会话可用「初次」入口绕过原密码校验。
- `scope === "tenant"` 且 `passwordSetByUser === false`（**初次设置**：全部存量账号、管理员建号账号、手机/微信登录自动建号）→ **不校验原密码**；更新 `tenant_accounts.password_hash`，并把 `password_set_by_user` 置 `true`。
- `scope === "tenant"` 且 `passwordSetByUser === true`（**修改**）→ 先用既有 `verifyPassword`（`infrastructure/password.ts`）校验 `currentPassword`；不匹配或缺失则 **400**，且不写任何数据。
- `scope === "platform"` → **始终按「修改」处理**（平台账号由平台方建号、密码已知，无自助激活路径）：`currentPassword` 必填且必须校验通过，再更新 `platform_accounts.password_hash`。
- 使用既有 `hashPassword`（`infrastructure/password.ts:17`）
- 写审计事件（动作名 `auth.password.set`，`summary` 区分「设置」与「修改」，不记录任何密码或哈希值）。**例外（偏差 C1）**：`scope === "platform"` 分支**不写** `audit_logs`——`audit_logs.tenant_id` 为 `NOT NULL`（`schema.prisma:1011`），平台账号自助改密没有可归属的租户；要审计平台自助改密需 `tenant_id` 变可空或另建平台审计表，属 schema 变更，超出 SP2 范围，故按「不写」实现并在此登记
- **不撤销其他 refresh 会话**（§12）

**错误**：400（密码长度、修改时缺 `currentPassword`、修改时 `currentPassword` 错误）、401（未认证）

## 6. 数据流

### 6.1 注册（不含陪玩意向）

```text
H5 注册页
  → POST /api/v1/auth/register { tenantCode, username, password, displayName?, phone?, code? }
      → resolveTenantId(tenantCode)                        [404]
      → 若带 phone：校验短信码 → encryptPhone(tenantId, phone)   [400]
      → 若带 phone：phoneHash 预查重                        [409]
      → 事务：tenant_accounts + CUSTOMER 角色 + customer_profiles
      → createRefreshSession + 签发 accessToken(含 roles)
  ← 201 { data: { accessToken, principal, …, csrfToken } } + Set-Cookie
```

### 6.2 注册并申请陪玩（客户端两段式）

```text
第 1 段：同上，拿到会话
第 2 段：携带新 accessToken
  → POST /api/v1/tenant/player-applications { intro }
      → 校验在册 CUSTOMER 角色（已满足）+ 无 PENDING 申请
      → 落 player_applications(PENDING) + 审计
  ← 201
失败处理：第 2 段失败不回滚账号。UI 明示「账号已创建，陪玩申请未提交，可重试」并提供重试按钮。
```

**为什么不合并成一个请求**：合并需要在 `identity-access` 模块注入 `player-applications` 的服务，形成新的跨模块 DI 依赖；两段式让 `player-applications` 模块**零改动**（ADR-0009 约束）。

### 6.3 存量账号激活

```text
入口：H5「设置密码」页
先决：已登录（手机验证码登录 / 微信登录 / 管理员给的初始密码）
  → POST /api/v1/auth/password { newPassword }
      → passwordSetByUser=false（存量全是系统随机密码）⇒ 不校验原密码
      → 更新 password_hash + password_set_by_user=true + 审计
  ← 200 { data: { ok: true } }
此后：可用 username + password 走 POST /api/v1/auth/login { kind: "tenant", tenantCode, username, password }
再一次改密（passwordSetByUser 已为 true）⇒ 必须带 currentPassword 并校验通过
```

### 6.4 手机号收敛

```text
账号 A 在租户 T 绑定了手机 M  →  phone_hash = HMAC(key, "T:M")
此后 POST /api/v1/auth/phone-login { tenantCode: T, phone: M, code }
  → findTenantAccountByPhoneHash(T, phoneHash) 命中账号 A     ← 既有代码，无需改动
```

收敛是既有能力的自然结果，**不新增机制**。

## 7. 安全边界

| 边界             | 处置                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 未登录可写数据库 | `register` 是 `@Public` 且会建账号 ⇒ **必须限流**（F7），且短信码校验失败**不写任何行、不建号**（限流计数仍按 §5.1 无条件记一次——成功与失败都占额度）                                                                                                                                                                                                                                                                                                                                                    |
| 租户归属不可信   | 服务端**只**用 `resolveTenantId(tenantCode)` 解析出的 `tenantId`，**不读**请求体里的任何 tenantId 字段（AGENTS.md:62）                                                                                                                                                                                                                                                                                                                                                                                   |
| 用户名枚举       | 409 会暴露「该用户名已存在」。与既有管理员建号行为一致，接受；如后续要收敛，改为统一模糊文案                                                                                                                                                                                                                                                                                                                                                                                                             |
| 手机号枚举       | 409 会暴露「该手机号已绑定」。同上；且手机号需先通过短信码校验才会走到查重，枚举成本被短信通道抬高                                                                                                                                                                                                                                                                                                                                                                                                       |
| 密码强度         | 沿用 8–128；不做复杂度要求（非目标），不在日志/审计/响应中回显                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 改密校验原密码   | **初次免验、修改必验**（F4，2026-09-26 用户修正）。初次（`passwordSetByUser=false`，含全部存量账号与管理员建号账号）不验——随机密码用户本就不可能知道原密码，且管理员给的初始密码属「初次」语义；修改（`=true`）**必验**，堵住「被窃会话加持久密码后永久接管」。平台账号无自助激活路径，一律按「修改」处理。**残余风险**：初次设置仍免验，被窃会话可在目标账号尚未自设密码前设置一个（一次性，此后每次改密都需原密码）；缓解=审计事件 `auth.password.set`，且持有 refresh cookie 的攻击者本已等同拥有账号 |
| 越权             | 新增端点不得放宽既有守卫；`password` 端点只改 `principal.sub` 对应账号，不接受目标账号参数                                                                                                                                                                                                                                                                                                                                                                                                               |
| 限流             | 复用 `RateLimitService`；`register` 用独立键前缀 `:register:`，不与登录的 `{ip}:{kind}:{username}` 互相挤占（见 §5.1）。注意既有实现是 **fail-open**（Redis 不可用时视为未超阈值），这是既有的可用性取向，本轮不改                                                                                                                                                                                                                                                                                       |

## 8. 前端改动

### 8.1 mobile（Taro 4 + React 18.3.1，H5 + weapp 双端可构建）

| 文件                                                                         | 改动                                                                                                                                 |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `src/pages/register/index.tsx` + `index.config.ts`                           | **新增**注册页：租户码（可从定位器预填）、用户名、密码、确认密码、昵称（可选）、手机号 + 验证码（可选）、「我是陪玩」勾选 + 申请说明 |
| `src/pages/account/password/index.tsx` + `index.config.ts`                   | **新增**设置密码页（老板端与陪玩端共用）                                                                                             |
| `src/features/account-ui/register.ts`                                        | **新增**注册逻辑：调 register → 若勾选陪玩则调申请端点 → 返回结构化结果（含「申请是否提交成功」）                                    |
| `src/features/account-ui/register.spec.ts`                                   | **新增**单测（纯逻辑，可测两段式的部分失败分支）                                                                                     |
| `src/app.config.ts`                                                          | `pages` 数组注册两个新页                                                                                                             |
| `src/pages/index/index.tsx`                                                  | 增加「注册」入口                                                                                                                     |
| `src/components/customer-ui/index.tsx:226`                                   | 文案「首次登录会自动创建本店老板账号与客户档案」处增加注册与设置密码入口                                                             |
| `src/pages/customer/profile/index.tsx`、`src/pages/player/profile/index.tsx` | 增加「设置密码」与（老板端）「申请成为陪玩」入口                                                                                     |

**约束**（AGENTS.md:63）：业务代码不得直接使用 `window`/`document`/`localStorage`/`wx`；全部经 `@platform-api` / `@platform-session` / `@platform-locator` 适配器。weapp 适配器保持 typed unsupported 桩，但**新页面必须双端可构建**。

**与 F9 的关系**：v1 **不在前端隐藏**陪玩端入口（首页仍并列 `openPlayer` / `openBoss`）。「有申请才指向陪玩端」在 v1 由两处体现：登录后默认落地老板端（`role` = `CUSTOMER`），以及未获 `PLAYER` 角色时陪玩端接口返回 403。入口显隐是否接线见 §12。

### 8.2 admin-web

**无改动**。陪玩审核页已存在（`merchant-console/module-views.tsx:63` 的 `PlayerApplicationsModuleView`），审核状态机与审计已上线。店主已有可用密码，不需要「设置密码」入口。

## 9. 测试计划

### 9.1 单测（`vitest run`，手写 stub 实现端口，不碰库）

> **已实施（2026-09-26）**：下表 5 个文件全部落地，随 `pnpm test` 运行（结果见 §9.4 报告与 `docs/unverified-and-deferred.md` §E）。红→绿证据：Task 1 为 11 条 `setPassword is not a function`、Task 2 为 13 条 `registerTenantCustomer is not a function`（见计划偏差 D5）；Task 3 为 6 条 `registerBody is not a function`（D10）。

| 文件                                                                                 | 覆盖                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/common/auth/permissions.guard.spec.ts`（**新增**）                     | 多角色权限并集；缺 `roles` 时回退 `[role]`；无 principal 时放行（既有行为）；缺所需权限时 403                                                                                                                                                                                        |
| `apps/api/src/modules/identity-access/application/auth-register.spec.ts`（**新增**） | 注册成功路径；用户名非法；密码非法；租户不存在；手机号已占用 → 409；缺短信码 → 400；`displayName` 缺省值；**注册写入 `passwordSetByUser = true`**；**写审计 `auth.register`**（A1）；**门店停用 → `TenantInactiveError` 且在建号前拒绝**（B1）；仓储唯一约束兜底不吞异常（共 13 条） |
| `apps/api/src/modules/identity-access/application/auth-password.spec.ts`（**新增**） | tenant 初次设置（`passwordSetByUser=false`，不传 `currentPassword` 成功且置 `true`）；tenant 修改（传对 `currentPassword` 成功）；tenant 修改传错 → 400 且 `password_hash` 不变；tenant 修改缺 `currentPassword` → 400；platform scope 始终必验；写审计；密码长度校验                |
| `apps/api/src/modules/identity-access/domain/roles.spec.ts`（**新增**）              | `sortRolesByPriority` 确定性；单角色不变；未知顺序稳定                                                                                                                                                                                                                               |
| `apps/mobile/src/features/account-ui/register.spec.ts`（**新增**）                   | 两段式：第 2 段失败时返回「账号已建、申请未提交」结构而非抛错                                                                                                                                                                                                                        |

### 9.2 集成测（`pnpm test:integration`，真 Nest + 真 Postgres + supertest）

新增 `tests/integration/account-registration.spec.ts`，照 `tests/integration/phone-register.spec.ts` 的 setup（`PW_TEST_MIGRATION_URL` owner 连接做夹具 + `Test.createTestingModule({ imports: [AppModule] })` + 租户 code 用 `Date.now().toString(36)` 防撞 + `afterAll` 按表倒序清理）。

> **已实施（2026-09-26）**：该文件已落地，共 **13 条**用例（8 条注册 + 5 条密码），随 `pnpm test:integration` 运行。
>
> **租户分组**：文件内建**两个**租户——**A 主租户**承载注册、改密、手机号收敛等全部用例；**B 副租户**只用于「跨租户同名 → 201」。分开的理由是限流键含 `tenantCode`（§5.1）：`{ip}:register:{tenantCode}` 若全用同一个租户，A 段几条注册成功用例会互相吃掉 5 次配额，跨租户同名那条也会失真。
>
> **覆盖差**：「`403` 门店停用」**不在**集成用例内（集成夹具未建停用门店），由 §9.1 单测覆盖；其余各行（注册 → 密码登录、用户名重复、跨租户同名、租户不存在、绑定手机号后手机登录、手机号已占用、短信码错误、设置密码后登录、改密三条判据、限流）均有对应用例。**多角色（SP1 回归）**一行落在 `tests/integration/player-application.spec.ts`，判据见下方更正块。

| 用例                   | 断言                                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 注册 → 密码登录        | 201 后 `POST /auth/login {kind:"tenant"}` 成功，`principal.roles` 含 `CUSTOMER`                                                     |
| 用户名重复             | 同租户二次注册同名 → 409                                                                                                            |
| 跨租户同名             | 另一租户注册同名 → 201（证明租户内唯一）                                                                                            |
| 租户不存在             | 404                                                                                                                                 |
| 绑定手机号后手机登录   | 注册带 `phone` → `POST /auth/phone-login` 命中**同一** `accountId`                                                                  |
| 手机号已被占用         | 409，且**不产生**第二个账号                                                                                                         |
| 短信码错误             | 400，且**不产生**账号                                                                                                               |
| 设置密码后登录         | 手机登录建号（随机密码）→ 设密码 → 用新密码密码登录成功                                                                             |
| **多角色（SP1 回归）** | 建 CUSTOMER 账号 → 申请陪玩 → 老板批准 → 默认落地老板端，切到陪玩端后老板端权限仍可用；判据见下方更正块（修复前应为红灯）           |
| **改密：初次免验**     | 手机登录建号（`passwordSetByUser=false`）→ 设密码（不传 `currentPassword`）→ 200，且 `password_set_by_user` 变 `true`，新密码可登录 |
| **改密：修改必验**     | 承上 → 第二次改密不传 `currentPassword` → **400**，且旧密码仍可登录（证明没写库）                                                   |
| **改密：原密码错误**   | 承上 → 第二次改密传错 `currentPassword` → **400**，且旧密码仍可登录                                                                 |
| 限流                   | 超出阈值 → 429                                                                                                                      |

> **§9.2 该行判据 2026-09-26 更正。** 原表述「用**同一 token** 分别访问老板端与陪玩端接口**均成功**」在本设计下**不可达**：`switch-context` 按目标端**重新签发** token，而 `role` 是端上下文判别字段（单值），因此不存在一个同时属于两端的 token。权限并集保证的是「切到任一端后，另一端的权限仍然可用」。已实施的用例为 `tests/integration/player-application.spec.ts`（「多角色（SP1 回归）：默认落地老板端，且切换端上下文后仍保有另一端权限」），判据六条：
>
> 1. `POST /api/v1/auth/login {kind:"tenant"}` → `principal.role === "CUSTOMER"`（默认落地老板端；`ROLE_PRIORITY` 中 `CUSTOMER` 先于 `PLAYER`）；
> 2. 同一登录响应 `principal.roles === ["CUSTOMER","PLAYER"]`（会话携带全部角色）；
> 3. `POST /api/v1/auth/switch-context {context:"PLAYER"}` → 201 并返回新 token；
> 4. **决定性判据**：以该陪玩端 token 访问 `GET /api/v1/tenant/orders` → **200**（权限并集；修复前为 **403**）；
> 5. 默认 `CUSTOMER` 上下文 token 访问同一接口 → 200；
> 6. `GET /api/v1/auth/me` 返回的 `roles` 经 JWT 签发/校验往返后仍为 `["CUSTOMER","PLAYER"]`。

### 9.3 回归门禁

`pnpm test` → `pnpm test:integration` → `pnpm test:tenant-isolation` → `pnpm typecheck`（依 `PROJECT_STATUS.md` 与各 vitest config）。

### 9.4 完成时必须报告（AGENTS.md:86-94）

交付时逐项给出，缺项须显式标注为未验证：

1. 修改的准确文件清单（含 SP1 的越界文件与理由）；
2. 数据库迁移与回滚方式——本设计为**一次新增列迁移**（`tenant_accounts.password_set_by_user`，`NOT NULL DEFAULT false`），须给出实际执行的命令、退出码与回滚 SQL；
3. API 契约变化：2 个新增 operation + `openapi.json`/`openapi.yaml`/`packages/api-client` 的再生成结果与哈希；
4. 租户、权限、输入、幂等和并发检查位置——对应 §7 各行与 §9.2 用例；
5. **本次调用/读取的 skill 清单**：名称、`SKILL.md` 路径与状态（成功完整读取并执行 / 缺失 / 损坏 / 未使用及原因）；
6. 实际执行的命令、退出码与关键输出；
7. 未验证、降级或未完成的能力（含 §12 全部条目）。

状态用语只允许：`code-changed`、`locally-verified`、`committed`、`pushed`、`preview-deployed`、`production-deployed`、`production-verified`——不得混用，缺新鲜证据时只能标未验证。

## 10. 迁移与回滚

- **迁移：一次新增列。** 唯一 schema 变更是 `tenant_accounts` 新增 `password_set_by_user`（`BOOLEAN NOT NULL DEFAULT false`；Prisma 字段 `passwordSetByUser`）。默认 `false` 使**全部存量行自动读作「初次」**，与「存量密码都是系统随机生成、用户不可能知道」的既有事实一致，**无需数据回填**。
  - 迁移目录：`packages/database/prisma/migrations/<YYYYMMDDHHMMSS>_add_password_set_by_user/migration.sql`，内容等价于 `ALTER TABLE "tenant_accounts" ADD COLUMN "password_set_by_user" BOOLEAN NOT NULL DEFAULT false;`（实际 SQL 由 `prisma migrate dev` 生成）。
  - 执行命令（**需按 AGENTS.md「执行数据库迁移」单独授权**）：`pnpm --filter @pw/database migrate:dev -- --name add_password_set_by_user`，随后 `pnpm --filter @pw/database generate` 以让 Prisma client 带出新字段。
  - 其余写入（`tenant_account_roles` / `customer_profiles` / `audit_logs` / `player_applications`）仍落在既有表与既有列。
- **未加列**：`platform_accounts` 不加该列——平台账号无自助激活路径，`password` 端点对其一律按「修改」处理（§5.2）。
- **契约产物**：新增 2 个 operation ⇒ 需重新生成 `openapi.json` / `openapi.yaml` / `packages/api-client/src/*`（生成产物不得手工编辑）。
- **回滚（两层）**：①**代码回滚**=撤代码即可，已注册数据留在既有表、无孤儿行、无降级脚本；因 `roles` 是新增 claim 且守卫有回退，旧代码能正确解析新 token。②**schema 回滚**=把该迁移目录内的 `migration.sql` 反向执行一次：`ALTER TABLE "tenant_accounts" DROP COLUMN "password_set_by_user";`。该列只被 `password` 端点的分支读取，删除后 `password` 端点退回「一律不校验原密码」的旧行为，不影响其他功能；已设过密码的账号其 `password_hash` 仍可用。
- **不涉及**：远程数据库、部署、新建分支/提交（各自需单独授权）。

## 11. 与已批准提案的差异

| 项                | 提案                            | 本 spec                                      | 原因                                                                                                                                                      |
| ----------------- | ------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `register` 请求体 | 含 `asPlayer?` / `playerIntro?` | **移除**；陪玩意向改为纯客户端两段式（§6.2） | 让服务端不产生新的跨模块 DI 依赖，`player-applications` 模块零改动。方向与已批准的 F3 一致（本就是两段式），只是不再把客户端 UI 决策透传成服务端字段      |
| `password` 请求体 | 含 `currentPassword?`           | **恢复**，改为条件必填                       | 依你 2026-09-26 的修正：「初次创建的时候不校验原密码，在修改密码的时候才会校验原密码」——提案原本就含 `currentPassword?`，是中间一轮的「一律不校验」被推翻 |

| 数据库迁移 | 零迁移（ADR-0009 决定 8） | **一次新增列迁移** | 同上一行：区分初次/修改需要**服务端权威状态**，纯前端分支可被绕过；`tenant_accounts` 新增 `password_set_by_user`（§10） |

## 12. 未决与未验证

- **`ROLE_PRIORITY` 已定**（2026-09-26）：`CUSTOMER` 先于 `PLAYER`，默认落地老板端（§4 SP1）。不再是未决项。
- **陪玩端入口的显隐尚未接线（SP2 实施后维持原状）**：F9 规定「有陪玩申请才出现陪玩端入口」，但该判定需要读申请状态。v1 的 H5 首页仍是两个并列入口（`openPlayer` / `openBoss`）。SP2 的前端环节（Task 3）**未**新增申请状态查询，故入口仍常显、点进去由接口 403 兜底。**未完成项**，需另立任务。
- **改密后不撤销其他 refresh 会话（SP2 实施后维持原状）**：（v1 有意不做）。`POST /api/v1/auth/password` 只更新 `password_hash` / `password_set_by_user`，不触碰 refresh 会话表。完整做法需新增「按账号撤销全部 refresh 会话」的仓储方法（**非 schema 变更**）。建议作为独立加固项。
- **phone-login 对停用门店的既有缺陷（本轮不修，登记为独立加固项）**：`phoneCustomerLogin`（`auth.service.ts:242-253`）在账号不存在时**先建号**，之后才判 `account.tenantStatus !== "ACTIVE"` 并抛 `TenantInactiveError`；而 `phone-login` 控制器（`auth.controller.ts:228`）**没有**捕获该错误（对照：`login` 控制器在 `:172` 捕获并转 401），于是落到全局过滤器返回 **500**——停用门店既被建出账号、又拿到 500 而非 401。SP2 的 `register` 不复制该缺陷：门店状态在**建号前**判定并返回 **403**（§5.1，B1）。修法（另立任务）：状态判定前移到建号之前 + 控制器捕获 `TenantInactiveError` → 401。
- **`player-applications` 的「一人一申请」并发窗口**：既有实现（本 slice 未碰）在「无 PENDING 申请」与「落 PENDING 行」之间没有唯一约束兜底，同一账号并发两次申请可能落两行。本轮不改，登记为已知窗口。
- ~~**多角色缺陷尚未运行时复现**~~ → **已运行时复现并修复（2026-09-26，SP1，状态 `locally-verified`）**：红灯证据为 `expected 200 "OK", got 403 "Forbidden"`（`tests/integration/player-application.spec.ts:182`，退出码 1）——老板批准后的账号切到陪玩端上下文后，`GET /api/v1/tenant/orders` 被拒（`role=PLAYER` 时 PLAYER 权限集无 `order.manage`）。修复后同一用例转绿（该请求 200），退出码 0。
- **端上下文判别字段仍是单值（有意保留，非缺陷）**：约 60 处 controller 以 `principal.role !== "PLAYER"` 之类判端（如 `slot-session.controller.ts:92`、`slot-report.controller.ts:80`、`disputes.controller.ts:111`、`customer-self.controller.ts:46`、`wallet.controller.ts:46`，6 个 `dispatch.manage` 端点全含此检查）。SP1 只修**权限层**（`@Permissions` 走角色集并集），**上下文层**维持「一次会话只在一个端内操作，切端即重签 token」，与 F9「陪玩端只在有申请时指向」一致。若将来需要「同一会话内跨端操作」，须另立 ADR。
- **`findTenantAccountById` 的 `where` 未带 `tenantId`**（`auth.repository.ts:366-369`），隔离依赖 `withTenantContext` 的 GUC + RLS。本轮不改，记录为已知依赖。
- **用户名枚举 / 手机号枚举**：409 文案会暴露占用状态，v1 接受（与既有管理员建号行为一致）。
- **`phoneHash` 预查重与唯一约束的时间窗**：预查重后会再走 DB 唯一约束兜底；并发注册同一手机号时以 DB 约束为准（返回 409，不 500）。**已实施（2026-09-26）**：`registerTenantCustomer` 的 `create` 显式捕获唯一约束冲突并按 `meta.target` 转译——`phone_hash` → `PhoneAlreadyBoundError`（409）、`username` → `UsernameTakenError`（409），其余原样上抛（不吞异常）；匹配前先归一化（去下划线 + 转小写）以覆盖 Prisma/驱动给出字段名、列名或约束名三种形态（计划偏差 D3）。

## 13. 验证证据

见 ADR-0009「验证证据」节；本 spec 的全部 `文件:行号` 引用与之一致。

## 批准记录

- 2026-09-26：用户「批准」设计提案（SP1/SP2 拆分、SP1 先行、越界修改授权、零迁移）。
- 2026-09-26（书面复核回执）：用户「确认」——接受 §11 的两处偏差（`register` 移除 `asPlayer`/`playerIntro`；`password` 移除 `currentPassword`），并修正决定 7 的 `ROLE_PRIORITY`：默认落地老板端（`CUSTOMER` 先于 `PLAYER`），陪玩端仅在有申请时指向。
- 2026-09-26（启动信号）：用户「可用开始补充多角色缺陷了」——SP1 进入实施。
- 2026-09-26（SP1 实施完成，状态 `locally-verified`）：§4 SP1 五条全部落地（新增 `ROLE_PRIORITY`/`sortRolesByPriority`/`permissionsForAny`、`AccessPrincipal.roles`、JWT `roles` claim、守卫并集、`AuthService` 按优先级取主角色）；§9.2 多角色用例由红转绿。**未提交**（本 slice 无任何 Git 动作）。
- 2026-09-26（F4 修正，用户指令）：用户「在初次创建的时候不校验原密码，在修改密码的时候才会校验原密码。」——推翻先前选定的一律不校验。经 AskUserQuestion 选定区分方式=「加一列 `passwordSetByUser`」，并授权「现在就实施」SP2。连带变更：F6 与 ADR-0009 决定 8 的「零迁移」不再成立（改 §10 一次新增列迁移）；§5.2 的 `currentPassword` 由「移除」改为「条件必填」；§9.2 增补三条改密判据，并修复被 §9.2 更正块吞掉的「限流」行。
- 2026-09-26（SP2 实施完成，状态 `locally-verified`）：§5–§9 全部落地——`POST /api/v1/auth/register`（含 403 门店停用与 `auth.register` 审计，A1/B1）、`POST /api/v1/auth/password`（分支由 `password_set_by_user` 判定；platform 分支不写审计，C1）、契约再生成 2 个 operation 且幂等、mobile 注册页与设置密码页双端可构建、§9.1 五个单测文件与 §9.2 集成文件（13 条）全绿；迁移 `20260926095348_add_password_set_by_user` 已在 `pw_saas` 与 `pw_saas_test` 执行并核对（回滚见 §10）。**未提交**（本 slice 无任何 Git 动作）。实施期偏差与证据缺口见实施计划 `docs/superpowers/plans/2026-09-26-account-password-registration-sp2.md` 的 D2–D11 与 Task 4 报告。

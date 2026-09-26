# ADR-0009：账号密码自助注册边界与多角色授权解析

- 状态：**已批准；SP1 与 SP2 均已实施并提交（`committed`，分支 `feat/account-password-registration`，6 笔提交 `9e0bbe4..HEAD`，**未推送**）**（2026-09-26 用户批准设计提案并经书面复核确认：SP1/SP2 拆分、SP1 先行、越界修改授权、`ROLE_PRIORITY` 默认老板端。**同日改选决策三 D**：初次设置免验原密码、修改必验 ⇒ 原「零迁移方案」不再成立，改为一次新增列迁移，该迁移已获授权并执行。SP2 落地 2 个端点、契约再生成、mobile 注册页与设置密码页，全部测试绿灯；实施期偏差见 spec §5.1/§5.2/§12 与实施计划的 D2–D11）
- 日期：2026-09-26
- 关联：主规格 §7（身份与 RBAC）、§16.1（会话安全）、ADR-0007（租户仓储不变量）、`docs/acceptance/slice-2-acceptance.md`（身份/会话/RBAC 验收口径）、`docs/superpowers/specs/2026-09-26-account-password-registration-design.md`

## 背景

### 一、身份入口现状：有隐式注册，无自助注册

当前系统**没有**任何注册端点。账号只有三条产生路径，全部是「隐式建号」或「管理员建号」：

| 路径 | 位置 | 密码 |
| --- | --- | --- |
| 手机验证码登录 | `apps/api/src/modules/identity-access/application/auth.service.ts:134-153` | `randomBytes(18).toString("base64url")`，**用户永不可知** |
| 微信登录 | 同上 `:176-194` | 同上 |
| 管理员建号 | `tenant-accounts.service.ts:85-122`（商家端）、`platform-billing.service.ts:69-76`（平台开店） | 管理员指定初始密码 |

`tenant_accounts.passwordHash` 是**非空**字段（`packages/database/prisma/schema.prisma:160`），所以隐式注册必须用随机值填充——用户拿不到，也改不了：全仓无任何 set/change/reset password 路由。

`tenant_accounts` 无 `displayName` 列（`:156-178`）；用户可见昵称写在 `customer_profiles.name`（`auth.repository.ts:170`）。

### 二、手机号已是确定性的租户内唯一标识

`apps/api/src/common/pii/phone.ts:43-45`：

```ts
const mobileHash = createHmac("sha256", key).update(`${tenantId}:${mobile}`).digest("hex");
```

HMAC 输入含 `tenantId`，故同一手机号**同租户内恒定同一 hash、跨租户不同**。配合 `@@unique([tenantId, phoneHash])`（`schema.prisma:174`）与 `findTenantAccountByPhoneHash` 的 `where: { tenantId, phoneHash }` 双保险（`auth.repository.ts:119-145`），「同租户同手机号只能有一个账号」是 **DB 强约束**。

结论：**让「绑定手机号」后手机号登录指向同一账号，不需要任何新机制**——写入 `phoneHash` 即可。

### 三、已确认的授权缺陷：多角色账号的角色解析不确定

`player_applications` 的批准逻辑（`apps/api/src/modules/player-applications/player-applications.service.ts:174-182`）在通过时**只追加 `PLAYER` 角色，不移除 `CUSTOMER`**：

```ts
if (!roles.some((r) => r.role === "PLAYER")) {
  await tx.tenantAccountRole.create({
    data: { tenantId, tenantAccountId: app.accountId, role: "PLAYER" },
  });
}
```

而申请入口本身要求在册角色是 `CUSTOMER`（`player-applications.controller.ts` 对 `role !== "CUSTOMER"` 返回 403「仅老板端账号可申请成为陪玩」）。因此**任何一个经老板批准的陪玩，账号必然同时持有两行角色**。

随后：

```text
tenant_account_roles: [CUSTOMER, PLAYER]    （两行，无排序语义）
  → auth.service.ts:53   const role = account.roles[0]      ← 取 Prisma include 返回的首个，未显式排序
  → domain/principal.ts:8   role: RoleKey                    ← 单数字段
  → common/auth/permissions.guard.ts   permissionsFor(principal.role)   ← 只算这一个角色的权限
```

**影响**：批准后的陪玩，其 JWT 内角色由数据库返回顺序决定。取到 `CUSTOMER` 则失去 `session.manage` / `dispatch.manage`（陪玩端接单不可用）；取到 `PLAYER` 则失去 `order.manage` / `dispute.manage`（老板端功能不可用）。`PLAYER` 与 `CUSTOMER` 的权限集交集只有 `tenant.view` 与 `dispute.view.own`（`domain/roles.ts:107-118`）。

**性质**：这是**既有缺陷**，经已上线的陪玩入驻流程即可到达，与本次新增注册功能无因果关系；但新增的「陪玩自助注册」会让每个新陪玩都命中它，因此必须同批修复。

## 约束

- 不得为一次性需求引入跨租户账号模型；`tenant_accounts` 租户内唯一是 ADR-0007 的不变量，保持不变。
- 不得改变「PLAYER 是 CUSTOMER 的叠加角色」这一既有业务模型。
- 不得破坏既有 token：已签发的 access token 只有 `role`、没有新 claim，必须在过渡期继续可用。
- 不得修改 `apps/api/src/modules/player-applications/**`（不属本切片）。
- 优先零数据库迁移。
- 密码原语沿用现有 scrypt（`infrastructure/password.ts:17`：`N=16384,r=8,p=1,keylen=64`），密码规则沿用 `tenant-accounts.service.ts:52-60` 的 8–128 位。

## 候选方案

### 决策一：自助注册建什么账号

| 方案 | 做法 | 取舍 |
| --- | --- | --- |
| A 注册即老板，陪玩走现有申请流 | 注册建 `CUSTOMER` 账号；勾选陪玩则提交现有 `player_applications` | 零新表、完全复用已上线审核流与商家端审核页；与「PLAYER 叠加于 CUSTOMER」的既有模型一致 |
| B 预注册待审 | 新建预注册表 + 新增 `PENDING` 账号态，批准后才建账号 | 语义更纯；但需新表、迁移、全新审核队列 UI，且与现有模型冲突 |
| **C（选）** | 同 A，但把「提交陪玩申请」定为**注册后独立一步**，与建号不同事务 | 让 `player-applications` 模块零改动（约束要求）；代价是一次可见可重试的部分失败 |

选 **C**。

### 决策二：手机号在注册中的角色

| 方案 | 做法 | 取舍 |
| --- | --- | --- |
| A 强制绑手机号 | 注册必须短信验证 | 与「手机号只是其中一个板块」的产品意图相反；把短信通道变成注册硬依赖 |
| B 可选绑定，冲突则拒绝并指路 | 带 `phone` 才绑定；已被占用返回 409 并指向「设置密码」 | 保持短信非必需；重复账号风险由 DB 唯一约束兜住，且给出可操作出口 |
| **C（选）** | 同 B，且**不改** `phone-login` 的自动注册语义 | 「手机优先」用户路径完全不变；收敛靠绑定而非账号合并 |

选 **C**。

### 决策三：存量随机密码账号如何激活

| 方案 | 做法 | 取舍 |
| --- | --- | --- |
| A 校验原密码 | 改密必须提供 `currentPassword` | 隐式注册的密码是随机值，用户不可能知道 ⇒ **功能等于不可用** |
| B 加标记列区分「用户设过密码」 | 新增列（需迁移），设过才校验原密码 | 安全梯度更细；但引入迁移（AGENTS.md 要求单独授权），且首批激活用户仍走免验路径，增量收益有限 |
| C | 已认证即可设密码，**不校验原密码**，写审计事件 | 能用短信/微信登进来本身即身份证明；零迁移。残余风险：被窃会话可加持久密码——由审计事件兜底，且该攻击者持有 refresh cookie 时本已等同于拥有账号 |
| **D（2026-09-26 改选，取代 C）** | `tenant_accounts` 新增 `password_set_by_user`：**初次设置免验原密码，修改必验** `currentPassword`；`platform` 账号无自助激活路径，一律按「修改」处理 | 把「不存在可校验的秘密」（随机密码存量账号）与「已有用户自设密码」（此时原密码是真实可用的凭据）分开。代价=一次新增列迁移（AGENTS.md 要求单独授权），换来「被窃会话无法把持久密码改成攻击者知道的值」 |

选 **D**（2026-09-26 改选；原选 C 的取舍理由仍记录在上表，其残余风险正是改选动因）。

### 决策四：多角色授权如何解析

| 方案 | 做法 | 取舍 |
| --- | --- | --- |
| A JWT 改带 `roles[]`，删除 `role` | 契约最干净 | 破坏既有 token 与所有 `principal.role` 读取方；UI 依据角色选端也需要一个「主角色」 |
| B 只做确定性排序，不改权限计算 | `roles[0]` 改成按固定优先级排序后取首个 | 消除随机性，但仍让多角色账号**只拿到一半权限**——陪玩端的接单权限依然缺失，缺陷未真正修复 |
| **C（选）** | JWT **新增** `roles[]`（保留 `role` 作确定性主角色）；`AccessPrincipal` 同步；`PermissionsGuard` 对 `roles` 求**并集**，无 `roles` 时回退 `[role]` | 修复真正的权限缺失；对旧 token 向后兼容；`role` 继续服务「UI 选端」这一单值需求 |

选 **C**。

## 决定

1. **注册一律建立 `CUSTOMER` 账号**（在指定租户内）。`PLAYER` 保持为叠加角色，只能经老板审批获得，注册过程**永不**直接授予 `PLAYER`。
2. **新增 `POST /api/v1/auth/register`**（`@Public` + Redis 共享限流）。它在**单个事务内**完成：建 `tenant_accounts` + `CUSTOMER` 角色行 + `customer_profiles`（昵称落 `customer_profiles.name`）。
3. **手机号是可选绑定，不是建号方式**。请求带 `phone` 时校验短信验证码后写入 `phoneEnc` / `phoneHash`；`phoneHash` 冲突返回 **409** 并提示改用「设置密码」路径，**不**静默创建第二个账号。
4. **陪玩意向不在注册事务内**：注册成功后由客户端携带新会话调用既有 `POST /api/v1/tenant/player-applications`。该步失败不回滚账号，UI 必须明示「账号已创建，陪玩申请未提交，可重试」。`player-applications` 模块**零改动**。
5. **新增 `POST /api/v1/auth/password`**（已认证，platform 与 tenant 两端皆可），用于设置或修改当前账号密码。**分支由服务端按 `tenant_accounts.password_set_by_user` 判定**（2026-09-26 用户修正）：
   - `false`（**初次设置**：全部存量账号、管理员建号账号、手机/微信登录自动建号）→ **不校验原密码**，设置成功后置 `true`；
   - `true`（**修改**）→ **必须**校验 `currentPassword`，缺失或不匹配返回 400 且不写任何数据；
   - `scope === "platform"` → 无自助激活路径，**始终**按「修改」处理。
   每次调用写审计事件（`auth.password.set`，区分「设置」/「修改」）。**例外（实施偏差 C1，2026-09-26）**：`scope === "platform"` 分支**不写** `audit_logs`——`audit_logs.tenant_id` 为 `NOT NULL`（`schema.prisma:1011`），平台自助改密没有可归属的租户，要审计需另立 schema 变更（超出 SP2 范围）。
6. **不改** `POST /api/v1/auth/phone-login` 的自动注册语义。手机号收敛通过绑定实现，不通过账号合并。
7. **JWT 增加 `roles: RoleKey[]` claim**，保留 `role` 作为确定性主角色（按 `ROLE_PRIORITY` 排序后取首个）。`PermissionsGuard` 对 `roles` 求并集；缺失 `roles` 时回退 `[role]`，保证既有 token 继续可用。
   - `ROLE_PRIORITY`（2026-09-26 用户确认）：`PLATFORM_SUPER_ADMIN` → `PLATFORM_SUPPORT` → `TENANT_OWNER` → `TENANT_ADMIN` → `CUSTOMER_SERVICE` → `FINANCE` → **`CUSTOMER` → `PLAYER`**。
   - 口径依据（用户原话）：「成品默认用户端，用户端也是老板端，所以陪玩端需要用户登录有申请的情况下才会指向陪玩端。」老板端是所有账号的基线落地面，陪玩端是叠加态；管理类角色置于 `CUSTOMER` 之前，保证店主/客服等多角色账号默认落在管理端。
   - 「是否出现陪玩端入口」不属本决定：它由账号是否存在陪玩申请（`PENDING`/`APPROVED`）决定，不由 `role` 决定。
8. **一次新增列迁移**（2026-09-26 改；原为「零数据库迁移」）。唯一变更是 `tenant_accounts` 新增 `password_set_by_user BOOLEAN NOT NULL DEFAULT false`——默认 `false` 使全部存量行自动读作「初次」，无需数据回填。`platform_accounts` **不加**该列。其余写入仍落在既有表与既有列。

## 理由

- 选「注册即 CUSTOMER + 陪玩叠加」是因为它顺应代码里已存在的模型（申请端点明确要求申请者已是 CUSTOMER），复用已上线的审核状态机、商家端审核页与审计，且不需要任何新表——这是改动量最小且与既有架构最一致的路径。
- 手机号采用「可选绑定 + 冲突拒绝」而非「强制验证」，是因为产品意图明确要求账号密码为通用入口、手机号只是板块之一；同时 `phoneHash` 的确定性使收敛成为既有能力的自然结果，无需新机制。
- 「初次免验、修改必验」把两种情形分开：随机密码的存量用户**不存在可校验的秘密**（一律必验会让该功能对目标人群完全失效），而**已经自设过密码**的账号此时原密码是真实可用的凭据，坚持校验才能堵住「被窃会话把密码改成攻击者知道的值后永久接管」。为此接受一次新增列迁移——该区分必须由服务端权威状态决定，纯前端分支会被绕过。
- 修多角色解析选「并集 + 保留主角色」而非「改单值」，是因为权限计算的**正确性**（并集）与 UI 选端的**确定性**（单值主角色）是两个不同需求，用一个字段同时满足两者会牺牲其中一个。

## 影响

- **行为**：多角色账号（已批准的陪玩）从「随机拿到一半权限」变为「稳定拿到并集权限」——这是**行为变化**，且是修复方向。
- **契约**：access token payload 新增 `roles` claim；`AccessPrincipal` 新增 `roles` 字段。API 请求/响应体不变。
- **新增端点**：2 个（`POST /api/v1/auth/register`、`POST /api/v1/auth/password`）。OpenAPI 契约需重新生成。
- **安全**：新增公开端点 ⇒ 必须接入现有 Redis 共享限流；改密按「初次免验、修改必验」分支（决策三 D），两种情形都需审计覆盖。残余风险收窄为「目标账号尚未自设密码前，被窃会话可设置一次」。
- **数据**：**一次 schema 变化**——`tenant_accounts` 新增 `password_set_by_user`（默认 `false`）；新增的 `tenant_accounts` 行来自自助注册而非管理员建号。
- **流程**：`docs/superpowers/specs/2026-09-26-account-password-registration-design.md` 描述完整实施范围。

## 迁移方式

**一次新增列迁移**（2026-09-26 改；原为「无数据库迁移」）。变更与写入落点：

| 写入 | 目标 | 现状 |
| --- | --- | --- |
| 账号 | `tenant_accounts`(`tenant_id`,`username`,`password_hash`,`phone_enc?`,`phone_hash?`) | 列已存在（`schema.prisma:156-178`） |
| **密码状态（新增列）** | `tenant_accounts.password_set_by_user`（`BOOLEAN NOT NULL DEFAULT false`） | **本次新增**，服务端用它区分「初次设置」与「修改」（决策三 D） |
| 角色 | `tenant_account_roles`(`tenant_id`,`tenant_account_id`,`role`) | 已存在（`:238-251`） |
| 昵称 | `customer_profiles.name` | 已存在（`:321-338`） |
| 审计 | `audit_logs` / `platform_audit_events` | 已存在 |
| 陪玩申请 | `player_applications` | 已存在（`:217-235`） |

命令：`pnpm --filter @pw/database migrate:dev -- --name add_password_set_by_user`，随后 `pnpm --filter @pw/database generate`（让 Prisma client 带出新字段）。**按 AGENTS.md「执行数据库迁移」需单独授权**；授权时须列出目标库、影响与回滚方式。迁移目录：`packages/database/prisma/migrations/<YYYYMMDDHHMMSS>_add_password_set_by_user/`。

## 回滚方式

- **代码回滚**：撤销本次提交即可。已注册数据留在既有表中，不产生孤儿行、不需要降级脚本、不阻塞旧版本运行。
- **schema 回滚**：`ALTER TABLE "tenant_accounts" DROP COLUMN "password_set_by_user";`。该列只被 `password` 端点读取，删除后该端点退回「一律不校验原密码」的旧行为，不影响其他功能；已设过密码的账号其 `password_hash` 仍可正常登录。
- **JWT 兼容**：因 `roles` 是**新增** claim 且守卫对缺失情形回退到 `[role]`，回滚到旧版本代码后，新签发的 token 仍能被旧守卫正确解析（旧代码只读 `role`，而 `role` 一直存在）。
- **无数据回滚需求**：新增列带默认值、无回填，可安全丢弃；本 ADR 不包含破坏性写入。

## 验证证据

- 隐式注册与随机密码：`auth.service.ts:143-153`、`:184-194`。
- `passwordHash` 非空：`packages/database/prisma/schema.prisma:160`。
- 无设密码路由：全仓 `grep -rn "set-password|setPassword|changePassword|resetPassword|updatePassword|forgot"` 在 `apps/api` 下 **0 个路由命中**。
- `phoneHash` 确定性：`apps/api/src/common/pii/phone.ts:43-45`。
- 手机号租户内唯一：`schema.prisma:174` + `20260910040000_phone_verification_p1/migration.sql:6-7`。
- 批准陪玩追加 PLAYER 且不移除 CUSTOMER：`player-applications.service.ts:174-182`；申请要求 CUSTOMER：同文件 `:67-70`。
- 单角色解析链路：`auth.service.ts:53` → `domain/principal.ts:8` → `common/auth/permissions.guard.ts`（`permissionsFor(principal.role)`）。
- `CUSTOMER` 权限集含 `tenant.view`：`domain/roles.ts:113-118`（这是注册后可直接调申请端点的依据）。
- **已运行时复现（2026-09-26，SP1 Task 1）**：`tests/integration/player-application.spec.ts` 的「多角色（SP1 回归）」用例在修复前报 `expected 200 "OK", got 403 "Forbidden"`（`player-application.spec.ts:182`，退出码 1）——老板批准后的多角色账号切到陪玩端上下文后，`GET /api/v1/tenant/orders` 被拒（`role=PLAYER` 时 PLAYER 权限集无 `order.manage`）。该红灯即决定 7 所述缺陷的实证。
- **已修复并转绿（同日夜）**：同一用例在修复后退出码 0；服务端日志中 `POST /api/v1/auth/switch-context → 201` 后 `GET /api/v1/tenant/orders → 200`（修复前为 403）。落地文件：`domain/roles.ts`（新增 `ROLE_PRIORITY`/`sortRolesByPriority`/`permissionsForAny`）、`domain/principal.ts`（`roles?`）、`infrastructure/tokens.ts`（`roles` claim 签发/校验）、`common/auth/permissions.guard.ts`（角色集并集 + 旧 token 回退）、`application/auth.service.ts`（按优先级取主角色并签发全部角色）。零迁移。

## 批准记录

- 2026-09-26：用户「批准」，批准范围包含——(1) 设计提案整体作为定稿写入 spec + ADR；(2) SP1 与 SP2 均实施且 SP1 先行；(3) 授权越界修改 `apps/api/src/common/auth/permissions.guard.ts` 与 `apps/api/src/modules/identity-access/domain/principal.ts`；(4) 采纳零数据库迁移方案。
- 2026-09-26（书面复核回执）：用户「确认」——接受 spec §11 记录的两处对已批准提案的偏差（register 请求体移除 `asPlayer`/`playerIntro`；password 请求体移除 `currentPassword`）；并**修正决定 7 的 `ROLE_PRIORITY`**：默认落地端为老板端（`CUSTOMER` 先于 `PLAYER`），陪玩端仅在有申请时指向。
- 2026-09-26（启动信号）：用户「可用开始补充多角色缺陷了」——SP1 进入实施。
- 2026-09-26（SP1 实施完成，状态 `locally-verified`）：决定 7 与 spec §4 SP1 五条全部落地（`ROLE_PRIORITY`/`sortRolesByPriority`/`permissionsForAny`、`AccessPrincipal.roles`、JWT `roles` claim、守卫并集、主角色按优先级）；§9.2 多角色用例由红转绿。**未提交**（本 slice 无 Git 动作）。
- 2026-09-26（**决策三改选为 D**，用户指令）：用户「在初次创建的时候不校验原密码，在修改密码的时候才会校验原密码。」——推翻原选 C 的「一律不校验」。经 AskUserQuestion 选定区分方式=「加一列 `passwordSetByUser`」；选项文本已明示「需要一次数据库迁移（`prisma migrate`），按 AGENTS.md 属需单独授权的动作，并会推翻原批准的『零迁移』」；另选定「现在就实施」SP2。本 ADR 相应修订：状态行、决策三（新增 D 行，C 标记为被取代）、决定 5、决定 8、理由、影响、迁移方式、回滚方式。**迁移本身尚未执行**——执行前须按 AGENTS.md 单独授权。
- 2026-09-26（**迁移授权并执行**）：用户以 AskUserQuestion 选定「批准 A+B（推荐）」——先 `--create-only` 生成迁移 SQL 并核对，确认后 deploy 到 `pw_saas` 与 `pw_saas_test`，再 `prisma generate`；回滚=`DROP COLUMN`。已执行：迁移 `20260926095348_add_password_set_by_user`（两库均 `44 migrations`、`Schema is up to date`），`prisma generate` 与 `pnpm --filter @pw/database build` 均退出码 0，列形态核对为 `password_set_by_user | boolean | NOT NULL | default false`。
- 2026-09-26（**SP2 实施完成，状态 `locally-verified`**）：决定 2/3/4/5 全部落地——`POST /api/v1/auth/register`（单事务三写 + 可选手机号绑定 + 403 门店停用 + 审计 `auth.register`，其中 403 与注册审计为 spec 之外的两处补充 A1/B1）、`POST /api/v1/auth/password`（分支由 `password_set_by_user` 判定；`platform` scope **不写审计**，即偏差 C1——受 `audit_logs.tenant_id NOT NULL` 约束）、契约再生成 2 个 operation 且幂等、mobile 注册页与设置密码页双端可构建。门禁（2026-09-26）：`pnpm test`、`pnpm test:integration`（13 条新集成用例）、`pnpm test:tenant-isolation`、`pnpm typecheck`、`pnpm openapi:generate` 全部退出码 0。**未提交**（本 slice 无 Git 动作）。
- 2026-09-26（**证据缺口，如实登记**）：SP2 两段的**单元层有完整红→绿**，但**集成层只有绿灯**（实现先于集成用例落地），红灯证据未取到——详见实施计划偏差 D5 与 Task 4 报告。§12 另登记本轮不修的既有缺陷：`phone-login` 对停用门店先建号后抛错且控制器未捕获 → 500。

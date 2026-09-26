# 多角色授权解析修复（SP1）实施计划

Goal: 让同时持有 `CUSTOMER` 与 `PLAYER` 的账号稳定获得**两个角色权限的并集**，并以确定性的主角色默认落地老板端。

Architecture: `tenant_account_roles` 可以有多行（老板批准的陪玩必然两行）。修复分三层：`roles.ts` 提供角色集合代数（优先级排序 + 权限并集）；`AccessPrincipal` 与 JWT 增加 `roles` claim 承载全部角色；`PermissionsGuard` 由「只算单一角色权限」改为「对角色集合求并集」，并对缺失 `roles` 的旧 token 回退到 `[role]`。`role` 保留为**端上下文判别值**（默认落地端），语义不变。

Tech stack: NestJS 11 + TypeScript 5（`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`）+ jose（HS256 JWT）+ Prisma 7 + PostgreSQL（RLS）+ Vitest 3 + supertest。

Spec: `docs/superpowers/specs/2026-09-26-account-password-registration-design.md`（§4 SP1、§9.2）与已批准 ADR `docs/adr/0009-account-password-registration-and-multi-role-authz.md`（决定四 / 决定 7）。

## Scope and non-goals

**范围内**

| #   | 改动                                                                             |
| --- | -------------------------------------------------------------------------------- |
| 1   | `ROLE_PRIORITY` 常量 + `sortRolesByPriority()` + `permissionsForAny()`           |
| 2   | `AccessPrincipal.roles?: readonly RoleKey[]`；JWT 签发/校验 `roles` claim        |
| 3   | `PermissionsGuard` 权限并集 + 旧 token 回退                                      |
| 4   | `AuthService.tenantPrincipal/platformPrincipal` 按优先级取主角色并签发全部角色   |
| 5   | 集成回归证据：批准后的多角色账号默认落地老板端、且切换端上下文后仍保有另一端权限 |

**范围外（不做）**

- **不改** `apps/api/src/modules/player-applications/**`（不属本切片；ADR 约束）。
- **不改** 约 60 处控制器内联的 `principal.role === "X"` 端上下文判别（见下方「关键更正」）。
- **不改** `player_applications` 批准时追加 PLAYER 且不移除 CUSTOMER 的既有行为——那正是「多角色」的定义，不是缺陷。
- **不改** `ROLE_PERMISSIONS` 矩阵内容。
- **不做** 数据库迁移（零迁移，无 schema 变化）。
- **不做** SP2 的注册 / 设置密码端点。
- **不做** `session.manage` 的处置（见「范围外发现」）。

## Permission gates

| 动作                        | 是否需要单独授权     | 说明                                                                                                                                              |
| --------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 修改上述 4 个产品文件       | **否**（已授权）     | 用户 2026-09-26 已批准 SP1 实施，并已单独授权越界修改 `common/auth/permissions.guard.ts` 与 `identity-access/domain/principal.ts`                 |
| 启动/改变容器或服务         | **否，本计划不需要** | 已实测 `127.0.0.1:5433`(postgres) / `6380`(redis) / `9002`(minio) 均可达，集成测试直接复用，无需新起容器                                          |
| 写集成测试库 `pw_saas_test` | **否**               | 测试库非生产、非本地业务数据；`tests/vitest.integration.config.ts:42-56` 已固定指向该库                                                           |
| 数据库迁移                  | **否，本计划无迁移** | 全部写入落在既有表既有列                                                                                                                          |
| 重新生成 OpenAPI / 客户端   | **否，本计划不触发** | 见「契约影响」——`/api/v1/auth/**` 全部端点无 response schema（`openapi.yaml:210-217` 的 `auth_me` 仅 `description: ""`），新增 claim 不改变生成物 |
| 提交 / 推送 / 部署          | **是**               | 本计划不含任何 Git 动作；需要时另行列出准确文件范围与提交信息                                                                                     |

## 事实基线（本轮实读，非推断）

| 事实                                                                                                                                                            | 证据                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 批准陪玩只追加 `PLAYER`、不移除 `CUSTOMER`                                                                                                                      | `apps/api/src/modules/player-applications/player-applications.service.ts:174-182` |
| 申请端点要求申请者已是 `CUSTOMER`                                                                                                                               | `apps/api/src/modules/player-applications/player-applications.controller.ts:45`   |
| 主角色取 `roles[0]`，无排序                                                                                                                                     | `apps/api/src/modules/identity-access/application/auth.service.ts:53`             |
| `AccessPrincipal.role` 为单值，无 `roles`                                                                                                                       | `apps/api/src/modules/identity-access/domain/principal.ts:5-11`                   |
| 守卫只算单一角色权限                                                                                                                                            | `apps/api/src/common/auth/permissions.guard.ts:30`                                |
| `PLAYER` ∩ `CUSTOMER` 权限只有 `tenant.view` + `dispute.view.own`                                                                                               | `apps/api/src/modules/identity-access/domain/roles.ts:107-118`                    |
| `roles` 由 `TenantAccountRecord.roles: readonly string[]` 提供                                                                                                  | `apps/api/src/modules/identity-access/application/auth-ports.ts:16`               |
| `tenantPrincipal` 有 5 处调用：`loginTenant` 无覆盖；`phoneCustomerLogin`/`wechatCustomerLogin`/微信合并覆盖 `"CUSTOMER"`；`switchTenantContext` 覆盖 `context` | `auth.service.ts:117,159,200,288-291,320`；`refresh` 无覆盖 `:389`                |
| `switch-context` 只允许切到账号已持有的角色                                                                                                                     | `auth.service.ts:317-319`                                                         |
| `@Permissions` 装饰器名（非 `RequirePermissions`）                                                                                                              | `apps/api/src/common/auth/decorators.ts:17`                                       |
| `GET /api/v1/tenant/orders` 由 `@TenantScope() + @Permissions("order.manage")` 保护，方法体内**无**内联角色判断                                                 | `apps/api/src/modules/orders/interface/orders.controller.ts:48,74-84`             |
| `POST /api/v1/auth/switch-context` 体为 `{ context: "CUSTOMER"｜"PLAYER" }`，返回 `SessionBundle`                                                               | `auth.controller.ts:222-240`                                                      |
| JWT 已有「可选字段用条件展开」的既有写法                                                                                                                        | `apps/api/src/modules/identity-access/infrastructure/tokens.ts:42-44`、`:79`      |
| `experimentalDecorators` 已开启，可在 spec 内使用装饰器                                                                                                         | `apps/api/tsconfig.json`                                                          |
| 单测 include 覆盖 `apps/api/src/**/*.spec.ts`                                                                                                                   | `vitest.config.ts:6-14`                                                           |
| 集成 include 为 `tests/integration/**/*.spec.ts`，`maxWorkers: 4`                                                                                               | `tests/vitest.integration.config.ts:31,39`                                        |
| 既有集成用例已建好「CUSTOMER 账号 → 申请 → 老板批准 → 切陪玩端」全链路夹具                                                                                      | `tests/integration/player-application.spec.ts:22-148`                             |

## 关键更正（须随本计划一并批准）

spec §9.2 写的验收用例是：

> 建 CUSTOMER 账号 → 申请陪玩 → 老板批准 → 用**同一 token** 分别访问老板端与陪玩端接口**均成功**（此用例在修复前应失败）

**这条按字面无法实现**，原因是本轮实读发现的第三层事实：除守卫之外，还有约 60 处控制器内联读取 `principal.role` 作为**端上下文判别**，形如：

```ts
if (req.principal?.role !== "PLAYER")
  throw new HttpException("需要陪玩身份", 403);
```

例如 `game-dispatch/interface/slot-session.controller.ts:92`、`slot-report.controller.ts:80`、`disputes/disputes.controller.ts:111`（陪玩侧）、`customers/interface/customer-self.controller.ts:46`、`wallet/interface/wallet.controller.ts:46`（老板侧）。

这些判断**不是权限判断，而是「你现在在哪个端」的上下文判断**，单值语义，且全部 6 个 `dispatch.manage` 端点（`slot-session`×4、`slot-report`×1、`game-dispatch` 若干）都带内联 `role !== "PLAYER"`。因此**不存在**一个「在 `role=CUSTOMER` 的 token 下、仅靠 `roles` 并集就能通过的陪玩端端点」——这不是修复没做到，而是这些端点的设计意图就是「必须先切到陪玩端」。

**更正后的等价且可执行验收**（写入本计划 Task 1、Task 5）：

1. 批准后重新登录，`principal.role` 必须为 `CUSTOMER`（默认落地老板端）。
2. 该 token 的 `roles` 必须同时含 `CUSTOMER` 与 `PLAYER`。
3. 默认（`CUSTOMER` 上下文）下，老板端权限接口 `GET /api/v1/tenant/orders` 返回 200。
4. **切到 `PLAYER` 上下文后，同一账号访问 `GET /api/v1/tenant/orders` 仍返回 200**——这条是并集修复的判据，修复前为 403（`PLAYER` 权限集无 `order.manage`）。
5. `GET /api/v1/auth/me` 经 JWT 往返后 `roles` 不丢失。

第 4 条同时证明了缺陷的**可观测后果**：今天一个经批准的陪玩一旦切到陪玩端接单，就同时失去老板端的下单/争议权限。

批准后需把 spec §9.2 该行替换为上述 5 条，并在 §12 增加一条「端上下文判别仍为单值」的已知限制。

## 范围外发现（记录，不在本计划处置）

1. **`session.manage` 是死权限键**：`ROLE_PERMISSIONS.PLAYER` 声明了它（`roles.ts:110`），但全仓 `apps/api/src` 无任何 `@Permissions("session.manage")` 端点。建议作为独立清理项。
2. **端上下文判别与权限判断混用**：约 60 处内联 `role === "X"` 中，部分是上下文判别（应保留单值），部分可能是想表达「具备某角色」（应改用 `roles.includes`）。本计划**不**逐个改动——需要单独设计切片。

## 契约影响

- access token payload 新增可选 `roles` claim；`AccessPrincipal` 新增可选 `roles` 字段。**旧 token 无此字段 → 守卫回退 `[role]`，行为与今天完全一致。**
- API 请求体/响应体结构不变。`/api/v1/auth/me`、`/api/v1/auth/login`、`/api/v1/auth/switch-context` 的响应体多一个 `roles` 字段，但这三个端点在 OpenAPI 中**无 schema**（`openapi.yaml:210-217` 等均为 `description: ""`），故 `pnpm openapi:check` 预期**无 diff**，无需重新生成客户端。
- `apps/admin-web`、`apps/mobile`：**零改动**（新增字段为可选，无读取方依赖）。

## 项目级约束（逐字来自 spec / AGENTS.md）

- 只修改当前 Slice 拥有的文件；需要越界时停止并说明原因。（越界已授权，见 Permission gates）
- 使用 TypeScript strict；不得以 `any`、忽略类型或关闭规则绕过错误。
- 不得创建空实现、始终成功的 Provider、吞异常的 `catch`、伪造命令输出或空测试脚本。
- API 契约来自 OpenAPI；生成客户端不得手工修改。
- 文本使用 UTF-8 与 LF；导入路径大小写必须与文件名完全一致。
- 禁止业务代码包含 Windows 绝对路径。
- 每个租户资源必须在服务端绑定 `TenantContext`；禁止信任客户端提交的 `tenantId`。
- 有可执行测试缝隙的行为必须先建立失败测试，再做最小实现。
- 完成时必须报告：修改文件、迁移与回滚、API 契约变化、租户/权限/输入/幂等/并发检查位置、skill 清单（名称 + SKILL.md 路径 + 状态）、命令 + 退出码 + 输出、未验证项。

## 公共接口（本计划引入，Task 间契约）

```ts
// apps/api/src/modules/identity-access/domain/roles.ts
export const ROLE_PRIORITY: readonly RoleKey[]; // 全 8 角色，CUSTOMER 在 PLAYER 之前
export function sortRolesByPriority(roles: readonly string[]): RoleKey[]; // 过滤未知值；按 ROLE_PRIORITY 升序
export function permissionsForAny(
  roles: readonly RoleKey[],
): readonly PermissionKey[]; // 并集

// apps/api/src/modules/identity-access/domain/principal.ts
export interface AccessPrincipal {
  sub: string;
  scope: Scope;
  role: RoleKey; // 端上下文主角色（默认落地端），语义不变
  roles?: readonly RoleKey[]; // 新增：账号持有的全部角色
  username: string;
  tenantId?: string;
}
```

`roles` 必须为**可选**：`apps/api/src/modules/identity-access/application/auth.service.spec.ts:23-28` 构造的 principal 无此字段，`exactOptionalPropertyTypes: true` 下改成必填会直接编译失败；保持可选同时使该既有测试成为「旧 token 兼容」的类型级证据。

---

## Task 1 — 建立红灯：多角色集成回归用例

Objective: 在动任何产品代码之前，先让新验收用例以**正确的原因**失败，留下可复现的红灯证据（spec §9.2 更正后的 1–5 条）。

Spec 覆盖: §9.2「多角色（SP1 回归）」。

Files:

- 修改 `tests/integration/player-application.spec.ts`（仅追加一个新 `it`，不改动既有断言）

Interfaces consumed: `POST /api/v1/auth/login`、`POST /api/v1/auth/switch-context`、`GET /api/v1/auth/me`、`GET /api/v1/tenant/orders`。

Preconditions: 容器可达（本轮已实测 UP）；无需迁移，测试库由 `beforeAll` 自建租户。

Steps:

- [ ] 在 `tests/integration/player-application.spec.ts` 的既有 `it`（`:103-148`）**之后**、同一 `describe` 内追加：

```ts
// 依赖声明：本用例依赖上一个用例已完成 approve（同一 describe 顺序执行）。
it("多角色（SP1 回归）：默认落地老板端，且切换端上下文后仍保有另一端权限", async () => {
  const login = await request(app.getHttpServer())
    .post("/api/v1/auth/login")
    .send({ kind: "tenant", tenantCode, username: "bossone", password: PW })
    .expect(201);
  const bundle = (
    login.body as {
      data: {
        accessToken: string;
        principal: { role: string; roles?: readonly string[] };
      };
    }
  ).data;

  // 1) 默认落地老板端：主角色必须是 CUSTOMER（ROLE_PRIORITY 中 CUSTOMER 先于 PLAYER）
  expect(bundle.principal.role).toBe("CUSTOMER");
  // 2) 会话 principal 必须携带全部角色
  expect(bundle.principal.roles).toEqual(["CUSTOMER", "PLAYER"]);

  // 3) 默认（CUSTOMER 上下文）下老板端权限接口可用
  await request(app.getHttpServer())
    .get("/api/v1/tenant/orders")
    .set("authorization", `Bearer ${bundle.accessToken}`)
    .expect(200);

  // 4) 切到陪玩端上下文后，老板端权限接口仍必须可用（权限并集；修复前为 403）
  const switched = await request(app.getHttpServer())
    .post("/api/v1/auth/switch-context")
    .set("authorization", `Bearer ${bundle.accessToken}`)
    .send({ context: "PLAYER" })
    .expect(201);
  const playerToken = (switched.body as { data: { accessToken: string } }).data
    .accessToken;
  await request(app.getHttpServer())
    .get("/api/v1/tenant/orders")
    .set("authorization", `Bearer ${playerToken}`)
    .expect(200);

  // 5) roles 经 JWT 签发/校验往返后不丢失
  const me = await request(app.getHttpServer())
    .get("/api/v1/auth/me")
    .set("authorization", `Bearer ${playerToken}`)
    .expect(200);
  expect(
    (me.body as { data: { roles?: readonly string[] } }).data.roles,
  ).toEqual(["CUSTOMER", "PLAYER"]);
});
```

- [ ] 运行并**记录红灯输出**：

```
npx vitest run --config tests/vitest.integration.config.ts tests/integration/player-application.spec.ts
```

预期：既有用例（第一个 `it`）**通过**；新用例**失败**，且失败点落在断言 1、2、4（断言 2 必然失败：修复前 `roles` 为 `undefined`）。把完整的 `AssertionError` 文本与退出码记入完成报告。

- [ ] 确认红灯原因正确：若新用例失败在 `expect(201)`（即 `switch-context` 或 `login` 报错），说明是环境或夹具问题，**停止**并转 `systematic-debugging`，不得继续 Task 2。

Rollback: 删除新增的 `it` 块即可；未触碰任何产品代码、未写产品数据。

Verification: 上述命令的完整输出中，新用例名出现在失败列表，第一个用例名出现在通过列表。

---

## Task 2 — `roles.ts` 角色集合代数

Objective: 提供 `ROLE_PRIORITY`、`sortRolesByPriority()`、`permissionsForAny()`，使角色顺序与权限并集成为纯函数并被单测锁定。

Spec 覆盖: §4 SP1 第 1 行；ADR 决定 7 的优先级表。

Files:

- 新增 `apps/api/src/modules/identity-access/domain/roles.spec.ts`
- 修改 `apps/api/src/modules/identity-access/domain/roles.ts`（在 `permissionsFor` 之后追加，不改动既有 `ROLE_KEYS`/`PERMISSION_KEYS`/`ROLE_PERMISSIONS`）

Interfaces produced: 见「公共接口」。

Steps:

- [ ] **先写失败测试** `apps/api/src/modules/identity-access/domain/roles.spec.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  ROLE_KEYS,
  ROLE_PRIORITY,
  permissionsForAny,
  sortRolesByPriority,
} from "./roles.js";

describe("ROLE_PRIORITY", () => {
  it("恰好覆盖全部角色键且无重复", () => {
    expect([...ROLE_PRIORITY].sort()).toEqual([...ROLE_KEYS].sort());
    expect(new Set(ROLE_PRIORITY).size).toBe(ROLE_PRIORITY.length);
  });

  it("CUSTOMER 先于 PLAYER（默认落地老板端）", () => {
    expect(ROLE_PRIORITY.indexOf("CUSTOMER")).toBeLessThan(
      ROLE_PRIORITY.indexOf("PLAYER"),
    );
  });

  it("管理类角色先于 CUSTOMER", () => {
    for (const role of [
      "PLATFORM_SUPER_ADMIN",
      "PLATFORM_SUPPORT",
      "TENANT_OWNER",
      "TENANT_ADMIN",
      "CUSTOMER_SERVICE",
      "FINANCE",
    ] as const) {
      expect(ROLE_PRIORITY.indexOf(role)).toBeLessThan(
        ROLE_PRIORITY.indexOf("CUSTOMER"),
      );
    }
  });
});

describe("sortRolesByPriority", () => {
  it("把多角色排成确定顺序，首元素即主角色", () => {
    expect(sortRolesByPriority(["PLAYER", "CUSTOMER"])).toEqual([
      "CUSTOMER",
      "PLAYER",
    ]);
  });

  it("排序与输入顺序无关", () => {
    expect(sortRolesByPriority(["PLAYER", "CUSTOMER"])).toEqual(
      sortRolesByPriority(["CUSTOMER", "PLAYER"]),
    );
  });

  it("管理类角色排在 CUSTOMER 之前", () => {
    expect(sortRolesByPriority(["PLAYER", "CUSTOMER", "TENANT_OWNER"])[0]).toBe(
      "TENANT_OWNER",
    );
  });

  it("丢弃未知角色值", () => {
    expect(sortRolesByPriority(["NOT_A_ROLE", "PLAYER"])).toEqual(["PLAYER"]);
  });

  it("空输入返回空数组", () => {
    expect(sortRolesByPriority([])).toEqual([]);
  });
});

describe("permissionsForAny", () => {
  it("返回并集：老板 + 陪玩同时拿到两端的权限", () => {
    const granted = permissionsForAny(["CUSTOMER", "PLAYER"]);
    expect(granted).toContain("order.manage"); // 仅 CUSTOMER 有
    expect(granted).toContain("dispatch.manage"); // 仅 PLAYER 有
    expect(granted).toContain("dispute.view.own"); // 两者都有
  });

  it("单角色等价于 permissionsFor", () => {
    expect([...permissionsForAny(["PLAYER"])].sort()).toEqual(
      [
        "dispatch.manage",
        "dispute.view.own",
        "session.manage",
        "tenant.view",
      ].sort(),
    );
  });

  it("空角色集返回空权限（fail-closed）", () => {
    expect(permissionsForAny([])).toEqual([]);
  });
});
```

- [ ] 运行确认红灯（模块无这些导出）：

```
npx vitest run apps/api/src/modules/identity-access/domain/roles.spec.ts
```

- [ ] **最小实现**——在 `roles.ts` 的 `permissionsFor` 之后追加：

```ts
/**
 * 多角色账号的主角色优先级（ADR-0009 决定 7，2026-09-26 用户确认）：
 * 管理类角色在前，CUSTOMER 先于 PLAYER —— 老板端是所有账号的基线落地面，
 * 陪玩端是叠加态，只在账号持有 PLAYER 时才能切入。
 */
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

/** 过滤未知角色值并按 ROLE_PRIORITY 升序排列；首元素即默认落地端的主角色。 */
export function sortRolesByPriority(roles: readonly string[]): RoleKey[] {
  const known = roles.filter((role): role is RoleKey =>
    (ROLE_KEYS as readonly string[]).includes(role),
  );
  return [...known].sort(
    (a, b) => ROLE_PRIORITY.indexOf(a) - ROLE_PRIORITY.indexOf(b),
  );
}

/** 多角色的有效权限 = 各角色权限集的并集（ADR-0009 决定四 C）。 */
export function permissionsForAny(
  roles: readonly RoleKey[],
): readonly PermissionKey[] {
  const granted = new Set<PermissionKey>();
  for (const role of roles) {
    for (const permission of permissionsFor(role)) granted.add(permission);
  }
  return [...granted];
}
```

- [ ] 重跑上述命令，全部通过。
- [ ] `npx tsc --noEmit -p apps/api/tsconfig.json` → 退出码 0。

Rollback: 删除 `roles.spec.ts` 与追加的三个导出；`roles.ts` 既有内容未被修改。

Verification: 上述 vitest 命令 → 3 个 describe 全绿，0 失败；tsc → 退出码 0。

---

## Task 3 — `AccessPrincipal.roles` + JWT `roles` claim

Objective: 让 `roles` 能从数据库角色行一路走到 access token 并原样返回；旧 token（无该 claim）继续可用。

Spec 覆盖: §4 SP1 第 2、3 行；ADR 决定 7。

Files:

- 修改 `apps/api/src/modules/identity-access/domain/principal.ts`
- 修改 `apps/api/src/modules/identity-access/infrastructure/tokens.ts`
- 修改 `apps/api/src/modules/identity-access/application/auth.service.spec.ts`（在既有 `describe("TokenService")` 内追加）

Interfaces produced: `AccessPrincipal.roles?: readonly RoleKey[]`；JWT 可选 claim `roles`。

Steps:

- [ ] **先写失败测试**——在 `auth.service.spec.ts` 的 `describe("TokenService")` 内追加：

```ts
it("roles claim 经签发/校验往返后保持顺序", async () => {
  const multi = {
    ...principal,
    scope: "tenant" as const,
    tenantId: "22222222-2222-4222-8222-222222222222",
    role: "CUSTOMER" as const,
    roles: ["CUSTOMER", "PLAYER"] as const,
  };
  const token = await tokens.signAccess(multi);
  const verified = await tokens.verifyAccess(token, ["pw-tenant"]);
  expect(verified.role).toBe("CUSTOMER");
  expect(verified.roles).toEqual(["CUSTOMER", "PLAYER"]);
});

it("无 roles 的 principal（旧 token 形态）校验后 roles 仍为 undefined", async () => {
  const token = await tokens.signAccess(principal);
  const verified = await tokens.verifyAccess(token, ["pw-platform"]);
  expect(verified.roles).toBeUndefined();
});
```

- [ ] 运行确认红灯：

```
npx vitest run apps/api/src/modules/identity-access/application/auth.service.spec.ts
```

预期：新用例 1 失败（`verified.roles` 为 `undefined`），用例 2 通过；`npx tsc --noEmit -p apps/api/tsconfig.json` 因 `roles` 不是 `AccessPrincipal` 的字段而报错。

- [ ] 修改 `principal.ts`：给 `AccessPrincipal` 增加字段并保留既有注释意图：

```ts
  /** 端上下文主角色：决定默认落地端；多角色账号取 ROLE_PRIORITY 排序后的首个。 */
  role: RoleKey;
  /** 账号持有的全部角色（权限并集的计算输入）。旧 token 无此 claim。 */
  roles?: readonly RoleKey[];
```

- [ ] 修改 `tokens.ts`：
  - `TokenClaims` 增加 `roles?: string[];`
  - `signAccess` 的 payload 增加条件展开（沿用 `tenantId` 既有写法）：

```ts
      ...(principal.roles !== undefined
        ? { roles: [...principal.roles] }
        : {}),
```

- `verifyAccess` 的返回对象增加条件展开：

```ts
      ...(payload.roles !== undefined
        ? { roles: payload.roles as AccessPrincipal["roles"] }
        : {}),
```

- [ ] 重跑上述 vitest 与 tsc，均通过。
- [ ] 确认既有 `auth.service.spec.ts:23-28` 的 `principal` 常量**未被修改**（它是旧 token 兼容的类型级证据）。

Rollback: 撤销这 3 个文件的改动；已签发的含 `roles` token 退回旧代码后仍可用（旧代码只读 `role`）。

Verification: vitest 该文件全绿（含 3 个既有 TokenService 用例）；`npx tsc --noEmit -p apps/api/tsconfig.json` 退出码 0。

---

## Task 4 — `PermissionsGuard` 权限并集

Objective: 守卫按角色集合求并集授权；无 `roles` 时回退 `[role]`；空角色集 fail-closed。

Spec 覆盖: §4 SP1 第 4 行；ADR 决定四 C。

Files:

- 新增 `apps/api/src/common/auth/permissions.guard.spec.ts`
- 修改 `apps/api/src/common/auth/permissions.guard.ts`

Steps:

- [ ] **先写失败测试** `apps/api/src/common/auth/permissions.guard.spec.ts`：

```ts
import "reflect-metadata";
import { describe, expect, it } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { PermissionsGuard } from "./permissions.guard.js";
import { Permissions } from "./decorators.js";
import type { AccessPrincipal } from "../../modules/identity-access/domain/principal.js";

class ProbeController {
  @Permissions("dispatch.manage")
  playerOnly(): void {}

  @Permissions("order.manage")
  customerOnly(): void {}
}

function contextFor(
  handler: () => void,
  principal: AccessPrincipal | undefined,
): ExecutionContext {
  const request = { principal };
  return {
    getHandler: () => handler,
    getClass: () => ProbeController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const base = {
  sub: "11111111-1111-4111-8111-111111111111",
  scope: "tenant",
  username: "bossone",
  tenantId: "22222222-2222-4222-8222-222222222222",
} as const;

const customerOnly: AccessPrincipal = { ...base, role: "CUSTOMER" };
const multiRole: AccessPrincipal = {
  ...base,
  role: "CUSTOMER",
  roles: ["CUSTOMER", "PLAYER"],
};

const guard = new PermissionsGuard();

describe("PermissionsGuard", () => {
  it("单 CUSTOMER 角色被拒绝 dispatch.manage", () => {
    expect(() =>
      guard.canActivate(
        contextFor(ProbeController.prototype.playerOnly, customerOnly),
      ),
    ).toThrow(/missing permissions: dispatch\.manage/);
  });

  it("roles 并集授予 PLAYER 独有权限（多角色账号）", () => {
    expect(
      guard.canActivate(
        contextFor(ProbeController.prototype.playerOnly, multiRole),
      ),
    ).toBe(true);
  });

  it("同一个多角色 principal 同时满足老板端权限", () => {
    expect(
      guard.canActivate(
        contextFor(ProbeController.prototype.customerOnly, multiRole),
      ),
    ).toBe(true);
  });

  it("无 roles 字段（旧 token）回退到 [role]：不越权", () => {
    expect(() =>
      guard.canActivate(
        contextFor(ProbeController.prototype.playerOnly, customerOnly),
      ),
    ).toThrow();
    expect(
      guard.canActivate(
        contextFor(ProbeController.prototype.customerOnly, customerOnly),
      ),
    ).toBe(true);
  });

  it("roles 为空数组时按无权限处理（fail-closed）", () => {
    const empty: AccessPrincipal = { ...base, role: "CUSTOMER", roles: [] };
    expect(() =>
      guard.canActivate(
        contextFor(ProbeController.prototype.customerOnly, empty),
      ),
    ).toThrow();
  });

  it("未认证（无 principal）时放行，由 AuthGuard 负责 401", () => {
    expect(
      guard.canActivate(
        contextFor(ProbeController.prototype.playerOnly, undefined),
      ),
    ).toBe(true);
  });
});
```

- [ ] 运行确认红灯：

```
npx vitest run apps/api/src/common/auth/permissions.guard.spec.ts
```

预期：用例 2 失败（`roles` 被忽略 → 抛 `missing permissions: dispatch.manage`）；其余通过。

- [ ] **最小实现**——改 `permissions.guard.ts`：导入改为

```ts
import { permissionsForAny } from "../../modules/identity-access/domain/roles.js";
```

并将 `const granted = permissionsFor(principal.role);` 替换为

```ts
// 多角色账号取并集；旧 token 无 roles claim 时回退到单角色。
// 空数组表示账号无角色 → 无权限（fail-closed），不回退。
const roles = principal.roles ?? [principal.role];
const granted = permissionsForAny(roles);
```

- [ ] 重跑该命令，6 个用例全绿。
- [ ] `npx tsc --noEmit -p apps/api/tsconfig.json` → 退出码 0。

Rollback: 删除新 spec 并还原 `permissions.guard.ts` 的两行改动。

Verification: vitest 该文件 6 passed；tsc 退出码 0。

---

## Task 5 — `AuthService` 落地并让集成用例转绿

Objective: `tenantPrincipal` / `platformPrincipal` 按优先级确定主角色并签发全部角色；Task 1 的红灯转绿；跑全量门禁。

Spec 覆盖: §4 SP1 第 3 行；ADR 决定 7。

Files:

- 修改 `apps/api/src/modules/identity-access/application/auth.service.ts`

Steps:

- [ ] 补上 `roles.js` 的值导入（当前 `:12` 仅为 `import type { RoleKey } from "../domain/roles.js";`，需改为值导入以取得 `sortRolesByPriority`）：

```ts
import { sortRolesByPriority, type RoleKey } from "../domain/roles.js";
```

- [ ] 替换 `tenantPrincipal`（`:49-61`）：

```ts
  private tenantPrincipal(
    account: TenantAccountRecord,
    overrideRole?: RoleKey,
  ): AccessPrincipal {
    // 账号持有的全部角色 → 权限并集的计算输入。
    const roles = sortRolesByPriority(account.roles);
    // 主角色 = 入口覆盖值（switch-context / 手机号 / 微信登录）或优先级最高的角色。
    const role = overrideRole ?? roles[0] ?? "CUSTOMER";
    return {
      sub: account.id,
      scope: "tenant",
      role,
      roles,
      username: account.username,
      tenantId: account.tenantId,
    };
  }
```

- [ ] 替换 `platformPrincipal`（`:40-47`）——平台账号单角色，签发等长数组使 claim 形态统一（守卫的回退分支因此只服务旧 token）：

```ts
  private platformPrincipal(account: PlatformAccountRecord): AccessPrincipal {
    const role = account.role as RoleKey;
    return {
      sub: account.id,
      scope: "platform",
      role,
      roles: [role],
      username: account.username,
    };
  }
```

- [ ] 不改动 5 处 `tenantPrincipal` 调用点（`:117` 无覆盖 → 走优先级；`:159`/`:200`/`:288-291`/`:320` 的覆盖值语义不变，仍是「进入哪个端」）。

- [ ] 运行 Task 1 的集成用例并确认**转绿**：

```
npx vitest run --config tests/vitest.integration.config.ts tests/integration/player-application.spec.ts
```

预期：2 个用例全部通过，退出码 0。把与 Task 1 红灯输出的对照记入完成报告。

- [ ] 跑受影响的既有集成用例，确认无回归：

```
npx vitest run --config tests/vitest.integration.config.ts tests/integration/auth.spec.ts tests/integration/http-auth.spec.ts tests/integration/phone-register.spec.ts tests/integration/authz-audit-notify-dispute.spec.ts tests/integration/merchant-admin.spec.ts
npx vitest run --config tests/vitest.tenant-isolation.config.ts
```

- [ ] 跑单测与类型检查：

```
npx vitest run
pnpm typecheck
```

- [ ] 跑契约门禁，确认**无 diff**（本计划不改变 OpenAPI）：

```
pnpm openapi:check
```

- [ ] 跑格式检查：

```
pnpm format:check
```

`pnpm lint` **默认不跑**：全仓 eslint 在本机约吃 3GB 内存，曾导致 dev server 被一起 OOM kill。若要跑，需单独确认并限定路径。

Rollback:

- 代码回滚：撤销 Task 2–5 的 4 个产品文件改动即可；**无数据库迁移、无降级脚本、无数据回滚需求**。
- 已签发的含 `roles` token 在旧代码下仍可用（旧代码不读该 claim）。
- 集成测试只写 `pw_saas_test`，`afterAll` 已按 `tenantId` 清理（`player-application.spec.ts:77-89`）。

Verification: 上述每条命令的退出码与输出摘要，逐条记入完成报告。

---

## Self-review

**1. spec 需求 → 计划映射**

| spec/ADR 要求                                | 落点                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| `ROLE_PRIORITY` + `sortRolesByPriority`      | Task 2                                                                    |
| `AccessPrincipal.roles`（`role` 保留）       | Task 3                                                                    |
| `auth.service.ts:53` 排序取首 + 签发 `roles` | Task 5                                                                    |
| `PermissionsGuard` 并集 + 回退               | Task 4                                                                    |
| 零数据库迁移                                 | 无迁移任务；Permission gates 已声明                                       |
| 不动 `player-applications`                   | Scope 范围外第 1 条；本计划无该目录文件                                   |
| §9.2 多角色回归用例                          | Task 1（建立红灯）+ Task 5（转绿），并按「关键更正」重写为 5 条可执行判据 |
| 越界修改已授权                               | Permission gates 第 1 行                                                  |

**2. 占位符与模糊动词扫描**：无 TBD/TODO；每个 Task 的测试与实现均为可直接落盘的完整代码；每条命令为可复制的完整命令。

**3. 路径、命令、类型、接口核对**：所有 `文件:行号` 均本轮实读；`@Permissions` 名称经 `decorators.ts:17` 核对；`experimentalDecorators` 经 `apps/api/tsconfig.json` 核对；vitest include 经 `vitest.config.ts:6-14` 与 `tests/vitest.integration.config.ts:31` 核对；`exactOptionalPropertyTypes: true` 决定了 `roles` 必须可选并采用条件展开写法（与 `tokens.ts:42-44` 既有写法一致）。

**4. 任务顺序与并行边界**：Task 1 必须最先（红灯证据）→ Task 2/3/4 相互独立但共同被 Task 5 依赖 → Task 5 必须最后。Task 2、3、4 之间无文件重叠，可并行编辑，但**串行执行**以避免同一工作树下的中间态干扰类型检查。

**5. 每个 Task 的证据与回滚**：Task 1 有红灯输出；Task 2/3/4 各有 red→green 单测 + tsc；Task 5 有集成转绿 + 全量门禁。每个 Task 均给出回滚动作；本计划无持久化副作用（无迁移、无生产写入）。

**6. 权限假设扫描**：无安装、无提交、无推送、无部署、无迁移、无远程环境改动。集成测试复用已运行的本地容器，不新起服务。

## 未决 / 未验证

- **端上下文判别仍为单值**（本计划范围外）：约 60 处内联 `principal.role === "X"` 保持不变。修复后，多角色账号必须显式 `switch-context` 才能进入陪玩端接口——这与用户口径一致（「需要用户登录有申请的情况下才会指向陪玩端」），但「有申请」在实现上等价于**已批准**（持有 `PLAYER` 角色），`PENDING` 状态不授予 `PLAYER`，故待审账号不能进陪玩端——这与用户 2026-09-26 的选择「陪玩审核前能登录，先当老板用」一致。
- **多角色缺陷的运行时复现**在 Task 1 完成前仍只是代码级推导。Task 1 的红灯输出将首次给出可执行证据。
- `pnpm lint` 因本机内存限制未纳入常规门禁，见 Task 5 最后一条。

## 提交记录（2026-09-26）

- 本计划的产物随「账号密码自助注册」slice 一并提交：分支 `feat/account-password-registration`（base `master` @ `9a742d0`），**6 笔提交 `9e0bbe4..HEAD`**，**未推送、无 PR**。SP1 的代码在 `feat(auth)` 笔、用例在 `test(auth)` 笔、文档在本批次末笔。
- 提交授权由用户在 SP2 收尾后单独给出（AskUserQuestion：「提交本 slice」+「先建分支再提交」+「拆 6 笔」）；本计划执行期间确实无任何 Git 动作。

# Slice 2 验收记录（进行中，部分完成）

- 规格版本：v1.0
- 切片：Slice 2 — 身份、会话与 RBAC
- 状态日期：2026-09-06
- 状态：**partial（认证/会话/audience 与账号级隔离完成；HTTP 级权限矩阵、H5 登录 E2E、CSRF/限流未完成）**
- 迁移：`20260906000200_auth_rbac`（platform_accounts / tenant_accounts / tenant_account_roles / refresh_sessions + RLS + revoke），已应用到 pw_saas 与 pw_saas_test（prisma migrate deploy exit 0）。

## 已完成并验证

- 密码：Node scrypt（`scrypt:N:r:p:salt:hash`，非自研）。
- Token：`jose` HS256；iss=pw-saas-api；aud=pw-platform/pw-tenant；access 15 分钟；refresh 高熵随机、DB 存 SHA-256、14 天、旋转。
- API：AuthService（loginPlatform/loginTenant/refresh/logout/verifyAccess）；PrismaAuthRepository；AuthGuard（全局 APP_GUARD，@Public/@PlatformScope/@TenantScope）；端点：POST /api/v1/auth/login|refresh|logout、GET /api/v1/auth/me、GET /api/v1/platform/me、GET /api/v1/tenant/me。
- tenancy 平台端点已要求 PlatformScope；health 与 public/tenant-resolve 显式 @Public。
- 前端：admin 平台登录 /login、门店登录 /store/login（sessionStorage 暂存；cookie 方案后置）；mobile identity-adapter contracts + h5 + weapp typed-unsupported。
- 测试：unit 7/7（含 token 篡改/错误 audience 拒绝、scrypt roundtrip）；`test:integration` 15/15（auth 7：登录/错误密码/停用/tenant 跨 audience 拒绝/refresh 旋转/登出/伪造拒绝）；`test:tenant-isolation` 9/9（新增账号表 SELECT/UPDATE/DELETE/INSERT 跨租户拒绝）；typecheck 6/6、lint、build 4/4、build:h5、build:weapp 全绿。

## 未完成（Slice 2 剩余）

- HTTP 层权限矩阵测试与按 PermissionKey 的资源授权用例（当前 guard 仅 audience/scope 级；细粒度权限随业务模块实施）。
- H5 登录 E2E（需运行中的 API）；refresh token 的 HttpOnly cookie + CSRF/Origin 校验（主规格 16.1）。
- 登录/验证码/找回密码速率限制（主规格 16.1）。
- 平台/门店初始管理员引导脚本（开发用 seed）。
- 会话撤销广播与账号停用即时撤销全量会话（部分覆盖：refresh 校验账号状态）。

## 结论

Slice 2 认证/会话/audience 与账号级隔离已 locally-verified；剩余项继续在 Slice 2 内或随认证完善补齐，不进入 Slice 3 自动推进。

## 第三轮（Slice 2 收尾，2026-09-06）

- 完成：@Permissions 装饰器 + PermissionsGuard（角色→PermissionKey 矩阵，后端强制）；tenancy 平台端点接 tenant.view/tenant.manage；AuthController 支持 HttpOnly refresh cookie（Path=/api/v1/auth）+ Origin 校验（cookie 状态修改跨站拒绝）+ 登录失败限流（5 次/15 分钟，内存版）；`scripts/seed-dev.mjs`（平台超管 + demo 门店 owner/service/player/customer，`pnpm db:seed:dev`）。
- HTTP 层 E2E（tests/integration/http-auth.spec.ts，5 用例）：登录签发 cookie 且 HttpOnly/SameSite=Lax；权限矩阵（admin 可建/support 403/门店 token 访问平台端点 401/门店 me 正常）；cookie refresh 旋转旧 token 失效；跨站 Origin 403；连续 5 次失败后 429。
- 全量：test:integration 20/20、unit 7/7、tenant-isolation 9/9、typecheck 6/6、lint、build 4/4、build:h5、build:weapp 全绿。
- 备注：Nest 控制器/守卫构造注入加显式 @Inject 以兼容 vitest/esbuild（无 design:paramtypes）。
- 剩余：H5 浏览器登录 E2E（需 mobile H5 登录 UI 出现后执行，随业务切片）；多实例限流需 Redis（Slice 9 引入）。
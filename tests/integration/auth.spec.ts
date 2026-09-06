import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthService } from "../../apps/api/src/modules/identity-access/application/auth.service.js";
import { PrismaAuthRepository } from "../../apps/api/src/modules/identity-access/infrastructure/auth.repository.js";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";
import { TokenService } from "../../apps/api/src/modules/identity-access/infrastructure/tokens.js";
import { AccountDisabledError, InvalidCredentialsError, InvalidRefreshTokenError } from "../../apps/api/src/modules/identity-access/domain/errors.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const SECRET = "test-secret-0123456789-0123456789-0123456789";
const PW = "Correct-Horse-1";
const suffix = Date.now().toString(36);

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

describe("identity-access (login / refresh / logout / audience)", () => {
  let client: PrismaClient;
  let runtimeClient: PrismaClient;
  let repo: PrismaAuthRepository;
  let tokens: TokenService;
  let service: AuthService;
  let tenantId: string;
  const platformUsernames: string[] = [];
  const tenantCodes: string[] = [];

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    runtimeClient = createDatabaseClient(envOrThrow("PW_TEST_RUNTIME_URL"));
    repo = new PrismaAuthRepository(client, runtimeClient);
    tokens = new TokenService(SECRET);
    service = new AuthService(repo, tokens);

    const adminHash = await hashPassword(PW);
    await client.platformAccount.create({
      data: { username: `admin_${suffix}`, passwordHash: adminHash, role: "PLATFORM_SUPER_ADMIN" }
    });
    platformUsernames.push(`admin_${suffix}`);
    await client.platformAccount.create({
      data: { username: `disabled_${suffix}`, passwordHash: adminHash, role: "PLATFORM_SUPPORT", status: "DISABLED" }
    });
    platformUsernames.push(`disabled_${suffix}`);

    const tenant = await client.tenant.create({
      data: { code: `auth_${suffix}`, name: "认证测试店" }
    });
    tenantId = tenant.id;
    tenantCodes.push(tenant.code);
    const account = await client.tenantAccount.create({
      data: { tenantId: tenant.id, username: "owner", passwordHash: adminHash }
    });
    await client.tenantAccountRole.create({
      data: { tenantId: tenant.id, tenantAccountId: account.id, role: "TENANT_OWNER" }
    });
  });

  afterAll(async () => {
    if (client) {
      await client.platformAccount.deleteMany({ where: { username: { in: platformUsernames } } });
      await client.tenantAccountRole.deleteMany({ where: { tenantId } });
      await client.tenantAccount.deleteMany({ where: { tenantId } });
      const authTenants = await client.tenant.findMany({ where: { code: { in: tenantCodes } }, select: { id: true } });
      for (const t of authTenants) await client.auditLog.deleteMany({ where: { tenantId: t.id } });
      await client.tenant.deleteMany({ where: { code: { in: tenantCodes } } });
      await client.$disconnect();
      await runtimeClient.$disconnect();
    }
  });

  it("平台登录成功并签发可验证的 access token", async () => {
    const bundle = await service.loginPlatform(`admin_${suffix}`, PW);
    expect(bundle.principal.scope).toBe("platform");
    expect(bundle.expiresInSeconds).toBe(900);
    const principal = await service.verifyAccess(bundle.accessToken, ["pw-platform"]);
    expect(principal.role).toBe("PLATFORM_SUPER_ADMIN");
  });

  it("错误密码/未知账号抛 InvalidCredentialsError", async () => {
    await expect(service.loginPlatform(`admin_${suffix}`, "wrong")).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(service.loginPlatform(
`nobody_${suffix}`, PW)).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it("停用账号被拒绝", async () => {
    await expect(service.loginPlatform(`disabled_${suffix}`, PW)).rejects.toBeInstanceOf(AccountDisabledError);
  });

  it("门店登录 principal 带 tenantId；跨 audience 拒绝", async () => {
    const bundle = await service.loginTenant(`auth_${suffix}`, "owner", PW);
    expect(bundle.principal.scope).toBe("tenant");
    expect(bundle.principal.tenantId).toBe(tenantId);
    await expect(service.verifyAccess(bundle.accessToken, ["pw-platform"])).rejects.toThrow();
    await expect(service.verifyAccess(bundle.accessToken, ["pw-tenant"])).resolves.toMatchObject({ tenantId });
  });

  it("refresh 旋转：旧 refresh token 失效，新 token 可用", async () => {
    const first = await service.loginPlatform(`admin_${suffix}`, PW);
    const second = await service.refresh(first.refreshToken, "platform");
    expect(second.refreshToken).not.toBe(first.refreshToken);
    await expect(service.refresh(first.refreshToken, "platform")).rejects.toBeInstanceOf(InvalidRefreshTokenError);
    const third = await service.refresh(second.refreshToken, "platform");
    expect(third.accessToken).toBeTruthy();
  });

  it("logout 后 refresh token 失效", async () => {
    const bundle = await service.loginPlatform(`admin_${suffix}`, PW);
    await service.logout(bundle.refreshToken);
    await expect(service.refresh(bundle.refreshToken, "platform")).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  it("伪造/篡改 token 被拒绝", async () => {
    const other = new TokenService("another-secret-0123456789-0123456789-0123");
    const forged = await other.signAccess({
      sub: "00000000-0000-4000-8000-000000000000",
      scope: "platform",
      role: "PLATFORM_SUPER_ADMIN",
      username: "forged"
    });
    await expect(service.verifyAccess(forged, ["pw-platform"])).rejects.toThrow();
  });
});

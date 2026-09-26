/**
 * SP2：账号密码自助注册登录——设置/修改密码（spec §5.2）。
 *
 * 分支由服务端按 password_set_by_user 判定，客户端无法影响：
 *   false（系统生成密码：全部存量账号、管理员建号、手机/微信自动建号）→「初次设置」，免验原密码；
 *   true （用户本人设过）→「修改」，必须校验原密码；缺失或错误则一行都不写。
 * platform 账号无自助激活路径，一律按「修改」处理；因 audit_logs.tenant_id 非空、平台自助改密
 * 没有可归属的租户，该分支不写审计（spec §5.2 记录）。
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  AccountDisabledError,
  AuthInputError,
  CurrentPasswordInvalidError,
  InvalidCredentialsError,
  TenantInactiveError,
} from "../domain/errors.js";
import { hashPassword, verifyPassword } from "../infrastructure/password.js";
import { TokenService } from "../infrastructure/tokens.js";
import type {
  AuthRepository,
  PlatformAccountRecord,
  TenantAccountRecord,
} from "./auth-ports.js";
import type { PhoneVerificationService } from "./phone-verification.service.js";
import { AuthService } from "./auth.service.js";

const SECRET = "test-secret-0123456789-0123456789-0123456789";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const PLATFORM_ID = "33333333-3333-4333-8333-333333333333";
const CURRENT_PASSWORD = "current-password-123";
const NEW_PASSWORD = "brand-new-password-456";

let currentHash = "";

beforeAll(async () => {
  currentHash = await hashPassword(CURRENT_PASSWORD);
});

function tenantAccount(
  overrides: Partial<TenantAccountRecord> = {},
): TenantAccountRecord {
  return {
    id: ACCOUNT_ID,
    tenantId: TENANT_ID,
    tenantStatus: "ACTIVE",
    username: "boss-one",
    passwordHash: currentHash,
    passwordSetByUser: false,
    status: "ACTIVE",
    roles: ["CUSTOMER"],
    ...overrides,
  };
}

function platformAccount(
  overrides: Partial<PlatformAccountRecord> = {},
): PlatformAccountRecord {
  return {
    id: PLATFORM_ID,
    username: "operator",
    passwordHash: currentHash,
    status: "ACTIVE",
    role: "PLATFORM_ADMIN",
    ...overrides,
  };
}

interface AuditCall {
  action: string;
  summary?: string | undefined;
}

function harness(options: {
  tenant?: TenantAccountRecord | null;
  platform?: PlatformAccountRecord | null;
}) {
  const calls = {
    tenantUpdates: [] as Array<{
      tenantId: string;
      accountId: string;
      passwordHash: string;
    }>,
    platformUpdates: [] as string[],
    audits: [] as AuditCall[],
  };
  const repository = {
    findTenantAccountById: async () => options.tenant ?? null,
    findPlatformAccountById: async () => options.platform ?? null,
    updateTenantAccountPassword: async (
      tenantId: string,
      accountId: string,
      passwordHash: string,
    ) => {
      calls.tenantUpdates.push({ tenantId, accountId, passwordHash });
    },
    updatePlatformAccountPassword: async (
      _accountId: string,
      passwordHash: string,
    ) => {
      calls.platformUpdates.push(passwordHash);
    },
    recordAudit: async (entry: AuditCall) => {
      calls.audits.push(entry);
    },
  } as unknown as AuthRepository;
  const service = new AuthService(
    repository,
    new TokenService(SECRET),
    {} as unknown as PhoneVerificationService,
  );
  return { service, calls };
}

function tenantInput(input: { newPassword: string; currentPassword?: string }) {
  return {
    scope: "tenant" as const,
    accountId: ACCOUNT_ID,
    tenantId: TENANT_ID,
    newPassword: input.newPassword,
    ...(input.currentPassword !== undefined
      ? { currentPassword: input.currentPassword }
      : {}),
  };
}

function platformInput(input: {
  newPassword: string;
  currentPassword?: string;
}) {
  return {
    scope: "platform" as const,
    accountId: PLATFORM_ID,
    newPassword: input.newPassword,
    ...(input.currentPassword !== undefined
      ? { currentPassword: input.currentPassword }
      : {}),
  };
}

describe("SP2：设置/修改密码（初次免验、修改必验）", () => {
  it("tenant 首次设置（passwordSetByUser=false）→ 免验原密码，写库并记「初次设置密码」审计", async () => {
    const { service, calls } = harness({ tenant: tenantAccount() });
    const result = await service.setPassword(
      tenantInput({ newPassword: NEW_PASSWORD }),
    );
    expect(result.mode).toBe("set");
    expect(calls.tenantUpdates).toHaveLength(1);
    expect(calls.tenantUpdates[0]!.tenantId).toBe(TENANT_ID);
    expect(calls.tenantUpdates[0]!.accountId).toBe(ACCOUNT_ID);
    expect(calls.tenantUpdates[0]!.passwordHash).not.toBe(NEW_PASSWORD);
    await expect(
      verifyPassword(NEW_PASSWORD, calls.tenantUpdates[0]!.passwordHash),
    ).resolves.toBe(true);
    expect(calls.audits).toHaveLength(1);
    expect(calls.audits[0]!.action).toBe("auth.password.set");
    expect(calls.audits[0]!.summary).toBe("初次设置密码");
    // 审计里不得出现密码明文或哈希
    expect(JSON.stringify(calls.audits)).not.toContain(NEW_PASSWORD);
    expect(JSON.stringify(calls.audits)).not.toContain(
      calls.tenantUpdates[0]!.passwordHash,
    );
  });

  it("tenant 首次设置时即便带了原密码也不校验（客户端无法借此切换分支）", async () => {
    const { service, calls } = harness({
      tenant: tenantAccount({ passwordSetByUser: false }),
    });
    const result = await service.setPassword(
      tenantInput({
        newPassword: NEW_PASSWORD,
        currentPassword: "totally-wrong-000",
      }),
    );
    expect(result.mode).toBe("set");
    expect(calls.tenantUpdates).toHaveLength(1);
  });

  it("tenant 已设过密码（passwordSetByUser=true）且原密码正确 → 修改成功，审计记「修改密码」", async () => {
    const { service, calls } = harness({
      tenant: tenantAccount({ passwordSetByUser: true }),
    });
    const result = await service.setPassword(
      tenantInput({
        newPassword: NEW_PASSWORD,
        currentPassword: CURRENT_PASSWORD,
      }),
    );
    expect(result.mode).toBe("change");
    expect(calls.tenantUpdates).toHaveLength(1);
    await expect(
      verifyPassword(NEW_PASSWORD, calls.tenantUpdates[0]!.passwordHash),
    ).resolves.toBe(true);
    expect(calls.audits).toHaveLength(1);
    expect(calls.audits[0]!.summary).toBe("修改密码");
  });

  it("tenant 已设过密码但原密码错误 → 拒绝，且一行都不写（密码哈希保持原值）", async () => {
    const { service, calls } = harness({
      tenant: tenantAccount({ passwordSetByUser: true }),
    });
    await expect(
      service.setPassword(
        tenantInput({
          newPassword: NEW_PASSWORD,
          currentPassword: "wrong-password-000",
        }),
      ),
    ).rejects.toBeInstanceOf(CurrentPasswordInvalidError);
    expect(calls.tenantUpdates).toHaveLength(0);
    expect(calls.audits).toHaveLength(0);
  });

  it("tenant 已设过密码但没传原密码 → 同样拒绝（省略字段不能绕过校验）", async () => {
    const { service, calls } = harness({
      tenant: tenantAccount({ passwordSetByUser: true }),
    });
    await expect(
      service.setPassword(tenantInput({ newPassword: NEW_PASSWORD })),
    ).rejects.toBeInstanceOf(CurrentPasswordInvalidError);
    expect(calls.tenantUpdates).toHaveLength(0);
    expect(calls.audits).toHaveLength(0);
  });

  it("platform scope + 正确原密码 → 改密成功；无可归属租户故不写 audit_logs", async () => {
    const { service, calls } = harness({ platform: platformAccount() });
    const result = await service.setPassword(
      platformInput({
        newPassword: NEW_PASSWORD,
        currentPassword: CURRENT_PASSWORD,
      }),
    );
    expect(result.mode).toBe("change");
    expect(calls.platformUpdates).toHaveLength(1);
    await expect(
      verifyPassword(NEW_PASSWORD, calls.platformUpdates[0]!),
    ).resolves.toBe(true);
    expect(calls.audits).toHaveLength(0);
  });

  it("platform scope 缺原密码或原密码错误 → 一律拒绝且不写库", async () => {
    const missing = harness({ platform: platformAccount() });
    await expect(
      missing.service.setPassword(platformInput({ newPassword: NEW_PASSWORD })),
    ).rejects.toBeInstanceOf(CurrentPasswordInvalidError);
    const wrong = harness({ platform: platformAccount() });
    await expect(
      wrong.service.setPassword(
        platformInput({
          newPassword: NEW_PASSWORD,
          currentPassword: "wrong-password-000",
        }),
      ),
    ).rejects.toBeInstanceOf(CurrentPasswordInvalidError);
    expect(missing.calls.platformUpdates).toHaveLength(0);
    expect(wrong.calls.platformUpdates).toHaveLength(0);
  });

  it("platform 账号不存在或已停用 → InvalidCredentialsError（不写库）", async () => {
    const missing = harness({ platform: null });
    await expect(
      missing.service.setPassword(
        platformInput({
          newPassword: NEW_PASSWORD,
          currentPassword: CURRENT_PASSWORD,
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    const disabled = harness({
      platform: platformAccount({ status: "DISABLED" }),
    });
    await expect(
      disabled.service.setPassword(
        platformInput({
          newPassword: NEW_PASSWORD,
          currentPassword: CURRENT_PASSWORD,
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(missing.calls.platformUpdates).toHaveLength(0);
    expect(disabled.calls.platformUpdates).toHaveLength(0);
  });

  it("新密码长度越界（7 / 129）→ AuthInputError，且先校验后写库", async () => {
    const short = harness({ tenant: tenantAccount() });
    await expect(
      short.service.setPassword(tenantInput({ newPassword: "1234567" })),
    ).rejects.toBeInstanceOf(AuthInputError);
    await expect(
      short.service.setPassword(tenantInput({ newPassword: "1234567" })),
    ).rejects.toThrow("密码长度需为 8-128 字符");
    const long = harness({ tenant: tenantAccount() });
    await expect(
      long.service.setPassword(tenantInput({ newPassword: "a".repeat(129) })),
    ).rejects.toBeInstanceOf(AuthInputError);
    expect(short.calls.tenantUpdates).toHaveLength(0);
    expect(long.calls.tenantUpdates).toHaveLength(0);
    expect(short.calls.audits).toHaveLength(0);
  });

  it("账号不存在或缺少门店上下文 → InvalidCredentialsError（不写库）", async () => {
    const missing = harness({ tenant: null });
    await expect(
      missing.service.setPassword(tenantInput({ newPassword: NEW_PASSWORD })),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    const noTenant = harness({ tenant: tenantAccount() });
    await expect(
      noTenant.service.setPassword({
        scope: "tenant",
        accountId: ACCOUNT_ID,
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(missing.calls.tenantUpdates).toHaveLength(0);
    expect(noTenant.calls.tenantUpdates).toHaveLength(0);
  });

  it("门店停用 / 账号停用 → 分别抛 TenantInactiveError / AccountDisabledError，都不写库", async () => {
    const inactive = harness({
      tenant: tenantAccount({ tenantStatus: "INACTIVE" }),
    });
    await expect(
      inactive.service.setPassword(tenantInput({ newPassword: NEW_PASSWORD })),
    ).rejects.toBeInstanceOf(TenantInactiveError);
    const disabled = harness({ tenant: tenantAccount({ status: "DISABLED" }) });
    await expect(
      disabled.service.setPassword(tenantInput({ newPassword: NEW_PASSWORD })),
    ).rejects.toBeInstanceOf(AccountDisabledError);
    expect(inactive.calls.tenantUpdates).toHaveLength(0);
    expect(disabled.calls.tenantUpdates).toHaveLength(0);
    expect(inactive.calls.audits).toHaveLength(0);
  });
});

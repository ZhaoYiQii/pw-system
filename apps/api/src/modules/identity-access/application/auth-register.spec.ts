/**
 * SP2 §5.1：租户内自助注册。
 *
 * 口径：只建 CUSTOMER（陪玩是两条腿走路——陪玩账号也先建 CUSTOMER，另走陪玩申请审核）；
 * 手机号可选，给了就必须先验短信码；建号前先拒绝停用门店，避免给停用门店留下账号。
 */
import { describe, expect, it } from "vitest";
import {
  AuthInputError,
  PhoneAlreadyBoundError,
  TenantInactiveError,
  TenantNotFoundError,
  UsernameTakenError,
} from "../domain/errors.js";
import { PhoneVerificationCodeMismatchError } from "./phone-verification.errors.js";
import { PhoneVerificationService } from "./phone-verification.service.js";
import { AuthService } from "./auth.service.js";
import type { AuthRepository, TenantAccountRecord } from "./auth-ports.js";
import { TokenService } from "../infrastructure/tokens.js";
import { verifyPassword } from "../infrastructure/password.js";

const SECRET = "test-secret-0123456789-0123456789-0123456789";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "44444444-4444-4444-8444-444444444444";
const TENANT_CODE = "demo-shop";
const USERNAME = "player_zhang";
const PASSWORD = "register-pass-123";
const PHONE = "13900001111";

function tenantAccount(
  overrides: Partial<TenantAccountRecord> = {},
): TenantAccountRecord {
  return {
    id: ACCOUNT_ID,
    tenantId: TENANT_ID,
    tenantStatus: "ACTIVE",
    username: USERNAME,
    passwordHash: "scrypt:x:y",
    passwordSetByUser: true,
    status: "ACTIVE",
    roles: ["CUSTOMER"],
    wechatOpenid: null,
    ...overrides,
  };
}

interface RegisteredInput {
  username: string;
  passwordHash: string;
  displayName: string;
  phoneEnc?: string;
  phoneHash?: string;
}

interface StubCalls {
  registered: RegisteredInput[];
  consumeCode: Array<{ phone: string; code: string }>;
  audits: string[];
}

function harness(options: {
  tenant?: { id: string; status: string } | null;
  byPhone?: TenantAccountRecord | null;
  verifyThrows?: Error;
  registerThrows?: Error;
}) {
  const calls: StubCalls = { registered: [], consumeCode: [], audits: [] };
  const repository = {
    findTenantByCode: async () =>
      options.tenant === undefined
        ? { id: TENANT_ID, status: "ACTIVE" }
        : options.tenant,
    findTenantAccountByPhoneHash: async () => options.byPhone ?? null,
    registerTenantCustomer: async (
      _tenantId: string,
      input: RegisteredInput,
    ) => {
      if (options.registerThrows) throw options.registerThrows;
      calls.registered.push(input);
      return tenantAccount({ username: input.username });
    },
    createRefreshSession: async () => undefined,
    recordAudit: async (entry: { action: string }) => {
      calls.audits.push(entry.action);
    },
  } as unknown as AuthRepository;

  const phoneVerification = {
    consumeCode: async (_tenantId: string, phone: string, code: string) => {
      if (options.verifyThrows) throw options.verifyThrows;
      calls.consumeCode.push({ phone, code });
    },
  } as unknown as PhoneVerificationService;

  const service = new AuthService(
    repository,
    new TokenService(SECRET),
    phoneVerification,
  );
  return { service, calls };
}

function registerInput(
  overrides: {
    tenantCode?: string;
    username?: string;
    password?: string;
    displayName?: string;
    phone?: string;
    code?: string;
  } = {},
) {
  return {
    tenantCode: overrides.tenantCode ?? TENANT_CODE,
    username: overrides.username ?? USERNAME,
    password: overrides.password ?? PASSWORD,
    ...(overrides.displayName !== undefined
      ? { displayName: overrides.displayName }
      : {}),
    ...(overrides.phone !== undefined ? { phone: overrides.phone } : {}),
    ...(overrides.code !== undefined ? { code: overrides.code } : {}),
  };
}

describe("SP2 §5.1：租户内自助注册", () => {
  it("注册成功 → 建 CUSTOMER、签发会话、记审计；密码以哈希入库", async () => {
    const { service, calls } = harness({});
    const bundle = await service.registerTenantCustomer(registerInput());

    expect(calls.registered).toHaveLength(1);
    const input = calls.registered[0]!;
    expect(input.username).toBe(USERNAME);
    expect(input.displayName).toBe(`用户${USERNAME.slice(-4)}`);
    expect(input.passwordHash).not.toBe(PASSWORD);
    expect(await verifyPassword(PASSWORD, input.passwordHash)).toBe(true);
    expect(input.phoneEnc).toBeUndefined();

    expect(bundle.principal.scope).toBe("tenant");
    expect(bundle.principal.role).toBe("CUSTOMER");
    expect(bundle.principal.roles).toEqual(["CUSTOMER"]);
    expect(bundle.principal.tenantId).toBe(TENANT_ID);
    expect(bundle.principal.username).toBe(USERNAME);
    expect(bundle.accessToken.length).toBeGreaterThan(0);
    expect(calls.audits).toContain("auth.register");
  });

  it("不带手机号也能注册（A′ 口径下手机号是可选绑定）", async () => {
    const { service, calls } = harness({});
    await service.registerTenantCustomer(registerInput());
    expect(calls.consumeCode).toHaveLength(0);
    expect(calls.registered[0]!.phoneHash).toBeUndefined();
  });

  it("用户名两侧空白被裁剪后再建号", async () => {
    const { service, calls } = harness({});
    await service.registerTenantCustomer(registerInput({ username: "  ab  " }));
    expect(calls.registered[0]!.username).toBe("ab");
  });

  it("用户名不合规（过短或非 ASCII 字符）→ AuthInputError，不建号", async () => {
    for (const username of ["a", "中文名", "with space", "bad!char"]) {
      const { service, calls } = harness({});
      await expect(
        service.registerTenantCustomer(registerInput({ username })),
      ).rejects.toBeInstanceOf(AuthInputError);
      expect(calls.registered).toHaveLength(0);
    }
  });

  it("密码长度 7 与 129 → AuthInputError，不建号", async () => {
    for (const password of ["1234567", "x".repeat(129)]) {
      const { service, calls } = harness({});
      await expect(
        service.registerTenantCustomer(registerInput({ password })),
      ).rejects.toBeInstanceOf(AuthInputError);
      expect(calls.registered).toHaveLength(0);
    }
  });

  it("昵称超过 50 字符 → AuthInputError，不建号", async () => {
    const { service, calls } = harness({});
    await expect(
      service.registerTenantCustomer(
        registerInput({ displayName: "名".repeat(51) }),
      ),
    ).rejects.toBeInstanceOf(AuthInputError);
    expect(calls.registered).toHaveLength(0);
  });

  it("租户不存在 → TenantNotFoundError", async () => {
    const { service, calls } = harness({ tenant: null });
    await expect(
      service.registerTenantCustomer(registerInput()),
    ).rejects.toBeInstanceOf(TenantNotFoundError);
    expect(calls.registered).toHaveLength(0);
  });

  it("门店停用 → TenantInactiveError，且**建号前**就拒绝", async () => {
    const { service, calls } = harness({
      tenant: { id: TENANT_ID, status: "INACTIVE" },
    });
    await expect(
      service.registerTenantCustomer(registerInput()),
    ).rejects.toBeInstanceOf(TenantInactiveError);
    expect(calls.registered).toHaveLength(0);
    expect(calls.consumeCode).toHaveLength(0);
  });

  it("给了手机号却没给验证码 → AuthInputError，不发短信校验也不建号", async () => {
    const { service, calls } = harness({});
    await expect(
      service.registerTenantCustomer(registerInput({ phone: PHONE })),
    ).rejects.toBeInstanceOf(AuthInputError);
    expect(calls.consumeCode).toHaveLength(0);
    expect(calls.registered).toHaveLength(0);
  });

  it("短信码错误 → 原样抛出，且不建号（先验证码后建号）", async () => {
    const { service, calls } = harness({
      verifyThrows: new PhoneVerificationCodeMismatchError("验证码不正确"),
    });
    await expect(
      service.registerTenantCustomer(
        registerInput({ phone: PHONE, code: "000000" }),
      ),
    ).rejects.toBeInstanceOf(PhoneVerificationCodeMismatchError);
    expect(calls.registered).toHaveLength(0);
  });

  it("手机号已绑定其他账号 → PhoneAlreadyBoundError，且不建第二个账号", async () => {
    const { service, calls } = harness({ byPhone: tenantAccount() });
    await expect(
      service.registerTenantCustomer(
        registerInput({ phone: PHONE, code: "123456" }),
      ),
    ).rejects.toBeInstanceOf(PhoneAlreadyBoundError);
    expect(calls.registered).toHaveLength(0);
  });

  it("手机号可用 → 验证码校验通过后带着号码建号", async () => {
    const { service, calls } = harness({});
    await service.registerTenantCustomer(
      registerInput({ phone: PHONE, code: "123456" }),
    );
    expect(calls.consumeCode).toEqual([{ phone: PHONE, code: "123456" }]);
    expect(calls.registered[0]!.phoneEnc).toBeDefined();
    expect(calls.registered[0]!.phoneHash).toBeDefined();
  });

  it("仓储唯一约束兜底（预查重竞态）抛出的 UsernameTakenError 原样上抛，不吞异常", async () => {
    const { service } = harness({ registerThrows: new UsernameTakenError() });
    await expect(
      service.registerTenantCustomer(registerInput()),
    ).rejects.toBeInstanceOf(UsernameTakenError);
  });
});

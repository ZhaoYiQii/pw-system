/**
 * S3c-2：手机号补绑与账号合并规则。
 *
 * A′ 口径下微信登录不要求手机号，于是同一个「人」可能先有微信账号、后有手机号账号。
 * 这里的规则负责把它们收敛成一个账号，并明确冲突时拒绝而不是悄悄合并。
 */
import { describe, expect, it } from "vitest";
import { PhoneAlreadyBoundError } from "../domain/errors.js";
import { PhoneVerificationCodeMismatchError } from "./phone-verification.errors.js";
import { PhoneVerificationService } from "./phone-verification.service.js";
import { AuthService } from "./auth.service.js";
import type { AuthRepository, TenantAccountRecord } from "./auth-ports.js";
import { TokenService } from "../infrastructure/tokens.js";

const SECRET = "test-secret-0123456789-0123456789-0123456789";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const CALLER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";

function account(
  overrides: Partial<TenantAccountRecord> = {},
): TenantAccountRecord {
  return {
    id: CALLER_ID,
    tenantId: TENANT_ID,
    tenantStatus: "ACTIVE",
    username: "w-caller",
    passwordHash: "scrypt:x:y",
    status: "ACTIVE",
    roles: ["CUSTOMER"],
    wechatOpenid: "oCallerOpenid",
    ...overrides,
  };
}

interface StubCalls {
  consumeCode: Array<{ phone: string; code: string }>;
  setPhone: Array<{ accountId: string; phoneHash: string }>;
  transfers: Array<{ from: string; to: string }>;
  audits: string[];
}

function harness(options: {
  caller?: TenantAccountRecord | null;
  byPhone?: TenantAccountRecord | null;
  verifyThrows?: Error;
}) {
  const calls: StubCalls = {
    consumeCode: [],
    setPhone: [],
    transfers: [],
    audits: [],
  };
  const repository = {
    findTenantAccountById: async () =>
      options.caller === undefined ? account() : options.caller,
    findTenantAccountByPhoneHash: async () => options.byPhone ?? null,
    setAccountPhone: async (
      _tenantId: string,
      accountId: string,
      input: { phoneHash: string },
    ) => {
      calls.setPhone.push({ accountId, phoneHash: input.phoneHash });
    },
    transferWechatOpenid: async (
      _tenantId: string,
      input: { fromAccountId: string; toAccountId: string },
    ) => {
      calls.transfers.push({
        from: input.fromAccountId,
        to: input.toAccountId,
      });
    },
    recordAudit: async (entry: { action: string }) => {
      calls.audits.push(entry.action);
    },
    createRefreshSession: async () => undefined,
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

const bind = (service: AuthService, phone = "13800138000", code = "123456") =>
  service.bindPhone({
    tenantId: TENANT_ID,
    accountId: CALLER_ID,
    phone,
    code,
  });

describe("S3c-2：手机号补绑与合并规则", () => {
  it("号码没被用过 → 挂到当前账号，并记为未合并（不需要换会话）", async () => {
    const { service, calls } = harness({ byPhone: null });
    const result = await bind(service);
    expect(result.merged).toBe(false);
    expect(result.session).toBeNull();
    expect(result.phoneTail).toBe("8000");
    expect(calls.consumeCode).toEqual([
      { phone: "13800138000", code: "123456" },
    ]);
    expect(calls.setPhone).toHaveLength(1);
    expect(calls.setPhone[0]!.accountId).toBe(CALLER_ID);
    expect(calls.transfers).toHaveLength(0);
    expect(calls.audits).toContain("auth.bind_phone");
  });

  it("号码就是当前账号自己的 → 幂等成功，不重复写库", async () => {
    const { service, calls } = harness({ byPhone: account() });
    const result = await bind(service);
    expect(result.merged).toBe(false);
    expect(result.session).toBeNull();
    expect(calls.setPhone).toHaveLength(0);
    expect(calls.transfers).toHaveLength(0);
  });

  it("号码属于另一个账号（未绑微信）且当前账号有 openid → 迁移 openid 并换到那个账号的会话", async () => {
    const { service, calls } = harness({
      byPhone: account({
        id: OTHER_ID,
        username: "customer-old",
        wechatOpenid: null,
      }),
    });
    const result = await bind(service);
    expect(result.merged).toBe(true);
    expect(result.session?.principal.sub).toBe(OTHER_ID);
    expect(calls.transfers).toEqual([{ from: CALLER_ID, to: OTHER_ID }]);
    expect(calls.setPhone).toHaveLength(0);
    expect(calls.audits).toContain("auth.bind_phone_merged");
  });

  it("号码属于另一个账号且已绑别的微信 → 409 语义的类型化错误（不悄悄合并）", async () => {
    const { service, calls } = harness({
      byPhone: account({ id: OTHER_ID, wechatOpenid: "oSomeoneElse" }),
    });
    await expect(bind(service)).rejects.toBeInstanceOf(PhoneAlreadyBoundError);
    expect(calls.transfers).toHaveLength(0);
    expect(calls.setPhone).toHaveLength(0);
  });

  it("当前账号没有 openid（例如纯账号密码登录）而号码属于别人 → 同样拒绝", async () => {
    const { service } = harness({
      caller: account({ wechatOpenid: null }),
      byPhone: account({ id: OTHER_ID, wechatOpenid: null }),
    });
    await expect(bind(service)).rejects.toBeInstanceOf(PhoneAlreadyBoundError);
  });

  it("目标账号不是 CUSTOMER（比如门店员工账号占了同号）→ 拒绝，不改任何数据", async () => {
    const { service, calls } = harness({
      byPhone: account({
        id: OTHER_ID,
        roles: ["TENANT_OWNER"],
        wechatOpenid: null,
      }),
    });
    await expect(bind(service)).rejects.toBeInstanceOf(PhoneAlreadyBoundError);
    expect(calls.transfers).toHaveLength(0);
  });

  it("验证码错误时原样抛出，且**不做任何写入**（先验证再改数据）", async () => {
    const { service, calls } = harness({
      byPhone: null,
      verifyThrows: new PhoneVerificationCodeMismatchError("验证码不正确"),
    });
    await expect(bind(service)).rejects.toBeInstanceOf(
      PhoneVerificationCodeMismatchError,
    );
    expect(calls.setPhone).toHaveLength(0);
    expect(calls.transfers).toHaveLength(0);
    expect(calls.audits).toHaveLength(0);
  });

  it("账号不存在或已停用 → 拒绝（不拿别人的会话去绑号）", async () => {
    const missing = harness({ caller: null });
    await expect(bind(missing.service)).rejects.toThrow();
    const disabled = harness({ caller: account({ status: "DISABLED" }) });
    await expect(bind(disabled.service)).rejects.toThrow();
    expect(disabled.calls.setPhone).toHaveLength(0);
  });
});

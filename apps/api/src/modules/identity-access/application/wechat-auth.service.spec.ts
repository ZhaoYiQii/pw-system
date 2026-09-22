import { describe, expect, it } from "vitest";
import type {
  AuthRepository,
  NewWechatLoginState,
  WechatLoginStateRecord,
} from "./auth-ports.js";
import type { AuthService, SessionBundle } from "./auth.service.js";
import {
  WechatAuthService,
  WechatLoginDisabledError,
  WechatStateMismatchError,
  WechatTenantNotFoundError,
  type WechatLoginRuntime,
} from "./wechat-auth.service.js";
import {
  WechatOauthClient,
  type WechatOauthConfig,
} from "../infrastructure/wechat-oauth.client.js";
import { WechatStateError } from "../infrastructure/wechat-state.js";

const CONFIG: WechatOauthConfig = {
  appId: "wx1234567890abcdef",
  appSecret: "super-secret-value",
  redirectUri: "https://h5.example.com/?wechat_login=1",
};

const BUNDLE: SessionBundle = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  principal: {
    sub: "acct-1",
    scope: "tenant",
    role: "CUSTOMER",
    username: "w1a2b3c4",
    tenantId: "tenant-1",
  },
  expiresInSeconds: 900,
};

/** 内存版的 state 仓储桩：忠实实现「单次消费 + 过期即废」。 */
function stateStub() {
  const rows = new Map<string, NewWechatLoginState & { consumed: boolean }>();
  const repository = {
    createWechatLoginState: async (input: NewWechatLoginState) => {
      rows.set(input.stateHash, { ...input, consumed: false });
    },
    consumeWechatLoginState: async (
      stateHash: string,
    ): Promise<WechatLoginStateRecord | null> => {
      const row = rows.get(stateHash);
      if (!row || row.consumed || row.expiresAt.getTime() <= Date.now()) {
        return null;
      }
      row.consumed = true;
      return {
        id: "state-1",
        tenantId: row.tenantId,
        returnTo: row.returnTo,
        expiresAt: row.expiresAt,
        consumedAt: new Date(),
      };
    },
  } as unknown as AuthRepository;
  return { repository, rows };
}

function authStub(tenantId: string | null = "tenant-1") {
  const calls: Array<{ tenantId: string; openid: string }> = [];
  const auth = {
    // 真实实现是按门店 code 解析租户，这里如实模拟：另一个门店 → 另一个租户 id
    resolveTenantId: async (code: string) =>
      code === "s4e2e" ? "tenant-2" : tenantId,
    wechatCustomerLogin: async (tid: string, openid: string) => {
      calls.push({ tenantId: tid, openid });
      return BUNDLE;
    },
  } as unknown as AuthService;
  return { auth, calls };
}

function runtime(
  respond: () => Promise<{ json(): Promise<unknown> }> = async () => ({
    json: async () => ({ openid: "oA1b2c3d4e5f6g7h8" }),
  }),
): WechatLoginRuntime {
  return { enabled: true, client: new WechatOauthClient(CONFIG, respond) };
}

describe("S3c-1：微信登录编排（不透明 state + 服务端记录）", () => {
  it("未启用时两个入口都直接拒绝（不假装成功）", async () => {
    const { repository } = stateStub();
    const service = new WechatAuthService(
      { enabled: false },
      authStub().auth,
      repository,
    );
    await expect(
      service.resolveAuthorizeUrl("s5cwalk", "/"),
    ).rejects.toBeInstanceOf(WechatLoginDisabledError);
    await expect(
      service.loginWithCode({ tenantCode: "s5cwalk", code: "c", state: "s" }),
    ).rejects.toBeInstanceOf(WechatLoginDisabledError);
  });

  it("授权地址：state 是 32 位十六进制，且服务端落了对应记录（含 tenantId 与白名单化 returnTo）", async () => {
    const { repository, rows } = stateStub();
    const service = new WechatAuthService(
      runtime(),
      authStub().auth,
      repository,
    );
    const url = await service.resolveAuthorizeUrl(
      "s5cwalk",
      "https://evil.example/steal",
    );
    expect(
      url.startsWith("https://open.weixin.qq.com/connect/oauth2/authorize?"),
    ).toBe(true);
    expect(url).toContain("appid=wx1234567890abcdef");
    expect(url).toContain("scope=snsapi_base");
    const state = new URL(url).searchParams.get("state") as string;
    expect(state).toMatch(/^[0-9a-f]{32}$/);
    expect(rows.size).toBe(1);
    const stored = [...rows.values()];
    expect(stored).toHaveLength(1);
    const row = stored[0]!;
    expect(row.tenantId).toBe("tenant-1");
    expect(row.returnTo).toBe("/"); // 脏值被白名单化
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("门店不存在时在授权跳转前就拒绝（不让用户白跳一次微信）", async () => {
    const { repository, rows } = stateStub();
    const service = new WechatAuthService(
      runtime(),
      authStub(null).auth,
      repository,
    );
    await expect(
      service.resolveAuthorizeUrl("ghost", "/"),
    ).rejects.toBeInstanceOf(WechatTenantNotFoundError);
    expect(rows.size).toBe(0);
  });

  it("正常登录：消费 state → 换 openid → 发会话，并回传 returnTo", async () => {
    const { repository } = stateStub();
    const { auth, calls } = authStub();
    const service = new WechatAuthService(runtime(), auth, repository);
    const url = await service.resolveAuthorizeUrl(
      "s5cwalk",
      "/pages/customer/orders/index",
    );
    const state = new URL(url).searchParams.get("state") as string;
    const result = await service.loginWithCode({
      tenantCode: "s5cwalk",
      code: "CODE-OK",
      state,
    });
    expect(result.bundle).toBe(BUNDLE);
    expect(result.returnTo).toBe("/pages/customer/orders/index");
    expect(calls).toEqual([
      { tenantId: "tenant-1", openid: "oA1b2c3d4e5f6g7h8" },
    ]);
  });

  it("state 不可重放：同一个 state 第二次登录被拒（且不再换 openid）", async () => {
    const { repository } = stateStub();
    let exchanged = 0;
    const service = new WechatAuthService(
      runtime(async () => {
        exchanged += 1;
        return { json: async () => ({ openid: "oX" }) };
      }),
      authStub().auth,
      repository,
    );
    const url = await service.resolveAuthorizeUrl("s5cwalk", "/");
    const state = new URL(url).searchParams.get("state") as string;
    await service.loginWithCode({ tenantCode: "s5cwalk", code: "C1", state });
    await expect(
      service.loginWithCode({ tenantCode: "s5cwalk", code: "C2", state }),
    ).rejects.toBeInstanceOf(WechatStateError);
    expect(exchanged).toBe(1);
  });

  it("过期 state 被拒（10 分钟后失效）", async () => {
    const { repository, rows } = stateStub();
    const service = new WechatAuthService(
      runtime(),
      authStub().auth,
      repository,
    );
    const url = await service.resolveAuthorizeUrl("s5cwalk", "/");
    const state = new URL(url).searchParams.get("state") as string;
    for (const row of rows.values()) {
      row.expiresAt = new Date(Date.now() - 1000);
    }
    await expect(
      service.loginWithCode({ tenantCode: "s5cwalk", code: "C", state }),
    ).rejects.toBeInstanceOf(WechatStateError);
  });

  it("伪造/格式非法的 state 在查库前就被拒（不消耗任何记录、不调微信）", async () => {
    const { repository, rows } = stateStub();
    let exchanged = 0;
    const service = new WechatAuthService(
      runtime(async () => {
        exchanged += 1;
        return { json: async () => ({ openid: "oX" }) };
      }),
      authStub().auth,
      repository,
    );
    await expect(
      service.loginWithCode({
        tenantCode: "s5cwalk",
        code: "C",
        state: "eyJhbGciOiJIUzI1NiJ9.abc-def",
      }),
    ).rejects.toBeInstanceOf(WechatStateError);
    expect(exchanged).toBe(0);
    expect(rows.size).toBe(0);
  });

  it("state 属于别的门店时拒绝（防止把会话发到其它租户）", async () => {
    const { repository } = stateStub();
    const service = new WechatAuthService(
      runtime(),
      authStub().auth,
      repository,
    );
    const url = await service.resolveAuthorizeUrl("s5cwalk", "/");
    const state = new URL(url).searchParams.get("state") as string;
    await expect(
      service.loginWithCode({ tenantCode: "s4e2e", code: "C", state }),
    ).rejects.toBeInstanceOf(WechatStateMismatchError);
  });

  it("微信返回错误码时向上抛类型化错误（由控制器映射）", async () => {
    const { repository } = stateStub();
    const service = new WechatAuthService(
      runtime(async () => ({
        json: async () => ({ errcode: 40029, errmsg: "invalid code" }),
      })),
      authStub().auth,
      repository,
    );
    const url = await service.resolveAuthorizeUrl("s5cwalk", "/");
    const state = new URL(url).searchParams.get("state") as string;
    await expect(
      service.loginWithCode({ tenantCode: "s5cwalk", code: "BAD", state }),
    ).rejects.toMatchObject({ code: 40029, kind: "permanent" });
  });
});

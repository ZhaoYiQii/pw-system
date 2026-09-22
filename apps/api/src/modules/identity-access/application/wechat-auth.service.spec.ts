import { describe, expect, it } from "vitest";
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
import {
  WechatStateError,
  WechatStateService,
} from "../infrastructure/wechat-state.js";

const SECRET = "test-secret-0123456789-0123456789-0123456789";
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

interface AuthStubCalls {
  resolveTenantId: string[];
  wechatCustomerLogin: Array<{ tenantId: string; openid: string }>;
}

function authStub(
  options: { tenantId?: string | null; calls?: AuthStubCalls } = {},
): { auth: AuthService; calls: AuthStubCalls } {
  const calls: AuthStubCalls = options.calls ?? {
    resolveTenantId: [],
    wechatCustomerLogin: [],
  };
  const tenantId =
    options.tenantId === undefined ? "tenant-1" : options.tenantId;
  const auth = {
    resolveTenantId: async (code: string) => {
      calls.resolveTenantId.push(code);
      return tenantId;
    },
    wechatCustomerLogin: async (tid: string, openid: string) => {
      calls.wechatCustomerLogin.push({ tenantId: tid, openid });
      return BUNDLE;
    },
  } as unknown as AuthService;
  return { auth, calls };
}

/** 微信换 openid 的桩：默认返回固定 openid，可按用例改成错误响应。 */
function runtime(
  respond: () => Promise<{ json(): Promise<unknown> }> = async () => ({
    json: async () => ({ openid: "oA1b2c3d4e5f6g7h8" }),
  }),
): WechatLoginRuntime {
  return {
    enabled: true,
    client: new WechatOauthClient(CONFIG, respond),
    state: new WechatStateService(SECRET),
  };
}

describe("S3b：微信登录编排（A′ 口径）", () => {
  it("未启用时两个入口都直接拒绝（不假装成功）", async () => {
    const service = new WechatAuthService({ enabled: false }, authStub().auth);
    await expect(
      service.resolveAuthorizeUrl("s5cwalk", "/"),
    ).rejects.toBeInstanceOf(WechatLoginDisabledError);
    await expect(
      service.loginWithCode({ tenantCode: "s5cwalk", code: "c", state: "s" }),
    ).rejects.toBeInstanceOf(WechatLoginDisabledError);
  });

  it("授权地址：带 appid/回跳/state，且 state 能验回 tenantCode 与站内 returnTo", async () => {
    const { auth } = authStub();
    const service = new WechatAuthService(runtime(), auth);
    const url = await service.resolveAuthorizeUrl(
      "s5cwalk",
      "/pages/customer/home/index",
    );
    expect(
      url.startsWith("https://open.weixin.qq.com/connect/oauth2/authorize?"),
    ).toBe(true);
    expect(url).toContain("appid=wx1234567890abcdef");
    expect(url).toContain("scope=snsapi_base");
    const state = new URL(url).searchParams.get("state");
    expect(state).toBeTruthy();
    await expect(
      new WechatStateService(SECRET).verify(state as string),
    ).resolves.toEqual({
      tenantCode: "s5cwalk",
      returnTo: "/pages/customer/home/index",
    });
  });

  it("脏 returnTo 在签名时就落成 /（不会变成开放重定向）", async () => {
    const service = new WechatAuthService(runtime(), authStub().auth);
    const url = await service.resolveAuthorizeUrl(
      "s5cwalk",
      "https://evil.example/steal",
    );
    const state = new URL(url).searchParams.get("state") as string;
    await expect(new WechatStateService(SECRET).verify(state)).resolves.toEqual(
      {
        tenantCode: "s5cwalk",
        returnTo: "/",
      },
    );
  });

  it("正常登录：拿 openid 换会话，并把 tenantId + openid 交给账号服务", async () => {
    const { auth, calls } = authStub();
    const state = await new WechatStateService(SECRET).sign({
      tenantCode: "s5cwalk",
      returnTo: "/pages/customer/orders/index",
    });
    const service = new WechatAuthService(runtime(), auth);
    const result = await service.loginWithCode({
      tenantCode: "s5cwalk",
      code: "CODE-OK",
      state,
    });
    expect(result.bundle).toBe(BUNDLE);
    expect(result.returnTo).toBe("/pages/customer/orders/index");
    expect(calls.wechatCustomerLogin).toEqual([
      { tenantId: "tenant-1", openid: "oA1b2c3d4e5f6g7h8" },
    ]);
  });

  it("state 属于另一个门店时拒绝（防止把会话发到别的租户）", async () => {
    const state = await new WechatStateService(SECRET).sign({
      tenantCode: "other-store",
      returnTo: "/",
    });
    const service = new WechatAuthService(runtime(), authStub().auth);
    await expect(
      service.loginWithCode({ tenantCode: "s5cwalk", code: "CODE", state }),
    ).rejects.toBeInstanceOf(WechatStateMismatchError);
  });

  it("伪造/过期的 state 在验签阶段就被拒，不会去换 openid", async () => {
    let exchanged = 0;
    const spy = async () => {
      exchanged += 1;
      return { json: async () => ({ openid: "oX" }) };
    };
    const service = new WechatAuthService(runtime(spy), authStub().auth);
    await expect(
      service.loginWithCode({
        tenantCode: "s5cwalk",
        code: "CODE",
        state: "not-a-jwt",
      }),
    ).rejects.toBeInstanceOf(WechatStateError);
    expect(exchanged).toBe(0);
  });

  it("门店不存在时给出可映射的 404 语义错误", async () => {
    const state = await new WechatStateService(SECRET).sign({
      tenantCode: "ghost",
      returnTo: "/",
    });
    const service = new WechatAuthService(
      runtime(),
      authStub({ tenantId: null }).auth,
    );
    await expect(
      service.loginWithCode({ tenantCode: "ghost", code: "CODE", state }),
    ).rejects.toBeInstanceOf(WechatTenantNotFoundError);
  });

  it("微信返回错误码时向上抛类型化错误（由控制器映射成 4xx/5xx）", async () => {
    const state = await new WechatStateService(SECRET).sign({
      tenantCode: "s5cwalk",
      returnTo: "/",
    });
    const service = new WechatAuthService(
      runtime(async () => ({
        json: async () => ({ errcode: 40029, errmsg: "invalid code" }),
      })),
      authStub().auth,
    );
    await expect(
      service.loginWithCode({ tenantCode: "s5cwalk", code: "BAD", state }),
    ).rejects.toMatchObject({ code: 40029, kind: "permanent" });
  });
});

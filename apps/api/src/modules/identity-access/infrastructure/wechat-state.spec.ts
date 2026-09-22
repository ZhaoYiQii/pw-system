import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { TokenService } from "./tokens.js";
import {
  WECHAT_STATE_TTL_SECONDS,
  WechatStateError,
  WechatStateService,
  sanitizeReturnTo,
} from "./wechat-state.js";

const SECRET = "test-secret-0123456789-0123456789-0123456789";

describe("S3：微信授权 state（防伪造 / 防开放重定向）", () => {
  it("签名后可验证，tenantCode 与 returnTo 原样（站内路径）保留", async () => {
    const service = new WechatStateService(SECRET);
    const token = await service.sign({
      tenantCode: "s5cwalk",
      returnTo: "/pages/customer/home/index",
    });
    await expect(service.verify(token)).resolves.toEqual({
      tenantCode: "s5cwalk",
      returnTo: "/pages/customer/home/index",
    });
  });

  it("换密钥后验签失败（伪造 state 走不通）", async () => {
    const other = new WechatStateService(
      "another-secret-0123456789-0123456789-0123",
    );
    const token = await other.sign({ tenantCode: "s5cwalk", returnTo: "/" });
    await expect(
      new WechatStateService(SECRET).verify(token),
    ).rejects.toBeInstanceOf(WechatStateError);
  });

  it("过期的 state 被拒（TTL = 10 分钟）", async () => {
    const service = new WechatStateService(SECRET);
    const past = Math.floor(Date.now() / 1000) - WECHAT_STATE_TTL_SECONDS - 60;
    const token = await service.sign(
      { tenantCode: "s5cwalk", returnTo: "/" },
      past,
    );
    await expect(service.verify(token)).rejects.toThrowError(/无效或已过期/);
  });

  it("访问令牌不能当 state 用（audience 不同，防令牌混用）", async () => {
    const accessToken = await new TokenService(SECRET).signAccess({
      sub: "acct-1",
      scope: "tenant",
      role: "TENANT_OWNER",
      username: "owner",
      tenantId: "t-1",
    });
    await expect(
      new WechatStateService(SECRET).verify(accessToken),
    ).rejects.toBeInstanceOf(WechatStateError);
  });

  it("state 里没有 tenantCode 时拒绝（不能让回调落到未知门店）", async () => {
    const key = new TextEncoder().encode(SECRET);
    const token = await new SignJWT({ returnTo: "/" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("pw-saas-api")
      .setAudience("pw-wechat-oauth-state")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(key);
    await expect(
      new WechatStateService(SECRET).verify(token),
    ).rejects.toThrowError(/缺少 tenantCode/);
  });

  it("returnTo 白名单：站内路径通过，绝对地址/协议相对/反斜杠/控制字符一律回退 /", () => {
    expect(sanitizeReturnTo("/pages/customer/orders/index")).toBe(
      "/pages/customer/orders/index",
    );
    expect(sanitizeReturnTo("/pages/x?tab=1")).toBe("/pages/x?tab=1");
    expect(sanitizeReturnTo("  /trimmed  ")).toBe("/trimmed");
    expect(sanitizeReturnTo(undefined)).toBe("/");
    expect(sanitizeReturnTo("")).toBe("/");
    expect(sanitizeReturnTo("https://evil.example/steal")).toBe("/");
    expect(sanitizeReturnTo("//evil.example/steal")).toBe("/");
    expect(sanitizeReturnTo("/\\evil.example")).toBe("/");
    expect(sanitizeReturnTo("/ok\u0000")).toBe("/");
    expect(sanitizeReturnTo(42)).toBe("/");
  });

  it("签名时就把脏 returnTo 落成 /（verify 端只做二次兜底）", async () => {
    const service = new WechatStateService(SECRET);
    const token = await service.sign({
      tenantCode: "s5cwalk",
      returnTo: "https://evil.example/steal",
    });
    await expect(service.verify(token)).resolves.toEqual({
      tenantCode: "s5cwalk",
      returnTo: "/",
    });
  });

  it("密钥过短直接拒绝（沿用 SESSION_SECRET 的强度要求）", () => {
    expect(() => new WechatStateService("too-short")).toThrowError(
      /at least 32/,
    );
  });
});

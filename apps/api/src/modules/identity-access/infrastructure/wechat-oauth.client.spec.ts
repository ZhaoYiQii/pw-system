import { describe, expect, it } from "vitest";
import {
  WechatOauthClient,
  WechatOauthError,
  buildWechatAuthorizeUrl,
  classifyWechatErrcode,
  maskOpenid,
  resolveWechatOauthConfig,
  type WechatOauthConfig,
} from "./wechat-oauth.client.js";

const ENV = {
  WECHAT_APP_ID: "wx1234567890abcdef",
  WECHAT_APP_SECRET: "super-secret-value",
  WECHAT_OAUTH_REDIRECT_URI: "https://h5.example.com/?wechat_login=1",
};

function config(overrides: Partial<WechatOauthConfig> = {}): WechatOauthConfig {
  return { ...resolveWechatOauthConfig(ENV), ...overrides };
}

describe("S3：微信网页授权客户端（可独立验证的部分）", () => {
  it("缺必需变量时启动期报错，并点名缺哪些", () => {
    expect(() => resolveWechatOauthConfig({})).toThrowError(/WECHAT_APP_ID/);
    expect(() =>
      resolveWechatOauthConfig({ ...ENV, WECHAT_APP_SECRET: "" }),
    ).toThrowError(/WECHAT_APP_SECRET/);
  });

  it("回跳地址必须是含协议的绝对地址；生产不允许 http", () => {
    expect(() =>
      resolveWechatOauthConfig({
        ...ENV,
        WECHAT_OAUTH_REDIRECT_URI: "h5.example.com",
      }),
    ).toThrowError(/绝对地址/);
    expect(() =>
      resolveWechatOauthConfig({
        ...ENV,
        NODE_ENV: "production",
        WECHAT_OAUTH_REDIRECT_URI: "http://h5.example.com/",
      }),
    ).toThrowError(/https/);
    // 非生产用 http 是允许的（本机/内网联调）
    expect(
      resolveWechatOauthConfig({
        ...ENV,
        NODE_ENV: "development",
        WECHAT_OAUTH_REDIRECT_URI: "http://127.0.0.1:3101/?wechat_login=1",
      }).redirectUri,
    ).toContain("127.0.0.1");
  });

  it("授权跳转地址：appid/回跳/scope/state 齐备，回跳做了 URL 编码，带 #wechat_redirect", () => {
    const url = buildWechatAuthorizeUrl(config(), "state-token");
    expect(
      url.startsWith("https://open.weixin.qq.com/connect/oauth2/authorize?"),
    ).toBe(true);
    expect(url).toContain("appid=wx1234567890abcdef");
    expect(url).toContain(
      `redirect_uri=${encodeURIComponent(ENV.WECHAT_OAUTH_REDIRECT_URI)}`,
    );
    expect(url).toContain("response_type=code");
    expect(url).toContain("scope=snsapi_base");
    expect(url).toContain("state=state-token");
    expect(url.endsWith("#wechat_redirect")).toBe(true);
  });

  it("code 换 openid：请求带上 appid/secret/code/grant_type，成功返回 openid 与 unionid", async () => {
    const seen: string[] = [];
    const client = new WechatOauthClient(config(), async (url) => {
      seen.push(url);
      return {
        json: async () => ({ openid: "oA1b2c3d4e5f6g7h8", unionid: "uX9" }),
      };
    });
    const identity = await client.exchangeCode("CODE-1");
    expect(identity).toEqual({ openid: "oA1b2c3d4e5f6g7h8", unionid: "uX9" });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain(
      "https://api.weixin.qq.com/sns/oauth2/access_token?",
    );
    expect(seen[0]).toContain("appid=wx1234567890abcdef");
    expect(seen[0]).toContain("secret=super-secret-value");
    expect(seen[0]).toContain("code=CODE-1");
    expect(seen[0]).toContain("grant_type=authorization_code");
  });

  it("没有 unionid 时不伪造字段", async () => {
    const client = new WechatOauthClient(config(), async () => ({
      json: async () => ({ openid: "oOnlyOpenid" }),
    }));
    await expect(client.exchangeCode("CODE-2")).resolves.toEqual({
      openid: "oOnlyOpenid",
    });
  });

  it("微信错误码：原样带进错误信息，且分类正确（40029 永久 / -1 可重试 / 45011 频控）", async () => {
    const failing = (body: unknown) =>
      new WechatOauthClient(config(), async () => ({ json: async () => body }));
    await expect(
      failing({ errcode: 40029, errmsg: "invalid code" }).exchangeCode("X"),
    ).rejects.toMatchObject({ code: 40029, kind: "permanent" });
    await expect(
      failing({ errcode: -1, errmsg: "system busy" }).exchangeCode("X"),
    ).rejects.toMatchObject({
      kind: "retryable",
    });
    await expect(
      failing({ errcode: 45011, errmsg: "api freq out of limit" }).exchangeCode(
        "X",
      ),
    ).rejects.toMatchObject({ kind: "rate_limited" });
    await expect(
      failing({ errcode: 40029, errmsg: "invalid code" }).exchangeCode("X"),
    ).rejects.toThrowError(/40029/);
  });

  it("返回体缺 openid 也当失败处理（不签发匿名会话）", async () => {
    const client = new WechatOauthClient(config(), async () => ({
      json: async () => ({}),
    }));
    await expect(client.exchangeCode("X")).rejects.toBeInstanceOf(
      WechatOauthError,
    );
  });

  it("传输层失败归一化；即使错误原文回显了带密钥的 URL，也要被脱敏", async () => {
    const client = new WechatOauthClient(config(), async () => {
      // 模拟最坏情况：代理/网关把请求 URL 原样塞进了错误信息（URL 里带 appsecret）
      throw new TypeError(
        "fetch failed for https://api.weixin.qq.com/sns/oauth2/access_token?appid=wx1234567890abcdef&secret=super-secret-value&code=CODE-3",
      );
    });
    let caught: unknown = null;
    try {
      await client.exchangeCode("CODE-3");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(WechatOauthError);
    const failure = caught as WechatOauthError;
    expect(failure.code).toBe("NetworkError");
    expect(failure.kind).toBe("retryable");
    expect(failure.message).not.toContain("super-secret-value");
    expect(failure.message).toContain("***");
    expect(failure.message).toContain("fetch failed"); // 诊断信息仍在
  });

  it("超时同样归一化（AbortSignal 触发）", async () => {
    const client = new WechatOauthClient(config(), async () => {
      const abort = new Error("The operation was aborted due to timeout");
      abort.name = "TimeoutError";
      throw abort;
    });
    await expect(client.exchangeCode("CODE-4")).rejects.toMatchObject({
      code: "TimeoutError",
      kind: "retryable",
    });
  });

  it("code 为空不发请求（省一次必然失败的调用）", async () => {
    let called = 0;
    const client = new WechatOauthClient(config(), async () => {
      called += 1;
      return { json: async () => ({ openid: "x" }) };
    });
    await expect(client.exchangeCode("")).rejects.toMatchObject({
      code: 41008,
    });
    expect(called).toBe(0);
  });

  it("错误码分类函数：合成码与未知码", () => {
    expect(classifyWechatErrcode("TimeoutError")).toBe("retryable");
    expect(classifyWechatErrcode("MalformedResponse")).toBe("retryable");
    expect(classifyWechatErrcode(40163)).toBe("permanent"); // code 已被使用
    expect(classifyWechatErrcode(40164)).toBe("permanent"); // IP 白名单等配置类
  });

  it("openid 日志脱敏只留首尾各 4 位", () => {
    expect(maskOpenid("oA1b2c3d4e5f6g7h8")).toBe("oA1b****g7h8");
    expect(maskOpenid("short")).toBe("****");
  });
});

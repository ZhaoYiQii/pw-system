import { describe, expect, it } from "vitest";
import {
  isWechatBrowser,
  readWechatCallback,
  wechatAuthorizeUrl,
  withoutWechatParams,
} from "./callback";

const WECHAT_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.44(0x18002c2c) NetType/WIFI Language/zh_CN";
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

describe("S3d：微信登录 H5 侧纯逻辑", () => {
  it("微信内置浏览器嗅探：命中 MicroMessenger；其它 UA 与 undefined 都为 false", () => {
    expect(isWechatBrowser(WECHAT_UA)).toBe(true);
    expect(isWechatBrowser(CHROME_UA)).toBe(false);
    expect(isWechatBrowser(undefined)).toBe(false);
  });

  it("读回跳参数：code+state 齐备才返回，缺一不可", () => {
    expect(
      readWechatCallback("?wechat_login=1&code=CODE&state=abc123"),
    ).toEqual({
      code: "CODE",
      state: "abc123",
    });
    expect(readWechatCallback("wechat_login=1&code=CODE&state=abc")).toEqual({
      code: "CODE",
      state: "abc",
    });
    expect(readWechatCallback("?wechat_login=1&code=CODE")).toBeNull();
    expect(readWechatCallback("?wechat_login=1&state=abc")).toBeNull();
    expect(readWechatCallback("")).toBeNull();
  });

  it("授权地址：指向服务端 /authorize，参数做了 URL 编码", () => {
    const url = wechatAuthorizeUrl(
      "https://api.example.com",
      "s5cwalk",
      "/pages/customer/home/index",
    );
    expect(
      url.startsWith("https://api.example.com/api/v1/auth/wechat/authorize?"),
    ).toBe(true);
    expect(url).toContain("tenantCode=s5cwalk");
    expect(url).toContain(
      `returnTo=${encodeURIComponent("/pages/customer/home/index")}`,
    );
  });

  it("清参数：去掉 code/state/wechat_login，保留其它查询参数与 hash 路由", () => {
    expect(
      withoutWechatParams(
        "https://h5.example.com/?wechat_login=1&code=C&state=S",
      ),
    ).toBe("https://h5.example.com/");
    expect(
      withoutWechatParams(
        "https://h5.example.com/?a=1&code=C&state=S#/pages/index/index",
      ),
    ).toBe("https://h5.example.com/?a=1#/pages/index/index");
  });
});

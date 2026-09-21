import { describe, expect, it } from "vitest";
import { readShortCode, resolveLocatorParam } from "./locator";

describe("H5 tenant locator 短码直达", () => {
  it("有 t 参数时优先返回 code", () => {
    expect(resolveLocatorParam("?t=xingchen", "xingchen.17ai.club")).toEqual({
      name: "code",
      value: "xingchen",
    });
    expect(readShortCode("?t=%E6%98%9F%E5%B0%98&x=1")).toBe("星尘");
  });

  it("无 t 参数或 t 为空时回退 host", () => {
    expect(resolveLocatorParam("", "xingchen.17ai.club")).toEqual({
      name: "host",
      value: "xingchen.17ai.club",
    });
    expect(resolveLocatorParam("?t=", "xingchen.17ai.club")).toEqual({
      name: "host",
      value: "xingchen.17ai.club",
    });
  });

  it("host 与 code 都缺失时返回 null（页面视为未配置）", () => {
    expect(resolveLocatorParam("?other=1", "")).toBeNull();
  });

  it("本地/局域网地址不发起 host 解析（避免每页一条 404 噪音）", () => {
    for (const host of [
      "127.0.0.1:3101",
      "localhost:3101",
      "192.168.21.4:3101",
      "[::1]:3101",
      "mac-mini.local",
    ]) {
      expect(resolveLocatorParam("", host), host).toBeNull();
    }
    // 短码优先，不受 host 形态影响
    expect(resolveLocatorParam("?t=xingchen", "127.0.0.1:3101")).toEqual({
      name: "code",
      value: "xingchen",
    });
    // 真实域名照常解析
    expect(resolveLocatorParam("", "xingchen.17ai.club")).toEqual({
      name: "host",
      value: "xingchen.17ai.club",
    });
  });
});

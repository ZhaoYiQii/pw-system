import { describe, expect, it } from "vitest";
import { readShortCode, resolveLocatorParam } from "./locator";

describe("H5 tenant locator 短码直达", () => {
  it("有 t 参数时优先返回 code", () => {
    expect(resolveLocatorParam("?t=xingchen", "xingchen.17ai.club")).toEqual({
      name: "code",
      value: "xingchen",
    });
    expect(
      readShortCode("?t=%E6%98%9F%E5%B0%98&x=1"),
    ).toBe("星尘");
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
});

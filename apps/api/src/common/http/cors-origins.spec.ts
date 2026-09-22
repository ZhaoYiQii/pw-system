import { describe, expect, it } from "vitest";
import { parseAllowedOrigins } from "./cors-origins.js";

describe("CORS 白名单解析（S-R）", () => {
  it("单个来源原样返回", () => {
    expect(
      parseAllowedOrigins({ ADMIN_WEB_ORIGIN: "http://localhost:3005" }),
    ).toEqual(["http://localhost:3005"]);
  });

  it("逗号分隔的多值都生效（本机 localhost 与 127.0.0.1 并存）", () => {
    expect(
      parseAllowedOrigins({
        ADMIN_WEB_ORIGIN: "http://localhost:3005, http://127.0.0.1:3005",
        H5_ORIGIN: "http://localhost:3101",
      }),
    ).toEqual([
      "http://localhost:3005",
      "http://127.0.0.1:3005",
      "http://localhost:3101",
    ]);
  });

  it("去重且忽略空片段与空白", () => {
    expect(
      parseAllowedOrigins({
        ADMIN_WEB_ORIGIN: " http://localhost:3005 ,,http://localhost:3005,",
        H5_ORIGIN: "   ",
      }),
    ).toEqual(["http://localhost:3005"]);
  });

  it("未配置时返回空数组（调用方据此决定不启用 CORS）", () => {
    expect(parseAllowedOrigins({})).toEqual([]);
  });
});

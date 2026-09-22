import { describe, expect, it } from "vitest";
import {
  WECHAT_STATE_TTL_SECONDS,
  createStateToken,
  hashStateToken,
  isValidStateToken,
  sanitizeReturnTo,
} from "./wechat-state.js";

describe("S3c-1：微信 state 生成与校验（按官方 ≤128 字节 a-zA-Z0-9 要求）", () => {
  it("state 是 32 位十六进制、且每次不同（不透明随机）", () => {
    const token = createStateToken();
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(createStateToken()).not.toBe(token);
  });

  it("state 长度远小于微信的 128 字节上限，且只含 [a-zA-Z0-9]", () => {
    const token = createStateToken();
    expect(token.length).toBeLessThanOrEqual(128);
    expect(/^[a-zA-Z0-9]+$/.test(token)).toBe(true);
  });

  it("校验函数：接受 32 位十六进制，拒绝短串/超长/JWT（含 -_ 与 . ）", () => {
    expect(isValidStateToken(createStateToken())).toBe(true);
    expect(isValidStateToken("abc")).toBe(false);
    expect(isValidStateToken("a".repeat(129))).toBe(false);
    expect(isValidStateToken("eyJhbGciOiJIUzI1NiJ9.abc-def_ghi")).toBe(false);
    expect(isValidStateToken("")).toBe(false);
  });

  it("哈希稳定且不回显原文（表里只存哈希）", () => {
    const token = createStateToken();
    expect(hashStateToken(token)).toBe(hashStateToken(token));
    expect(hashStateToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashStateToken(token)).not.toContain(token);
  });

  it("TTL 是 10 分钟（与文档里「code 5 分钟」错开，留出用户操作时间）", () => {
    expect(WECHAT_STATE_TTL_SECONDS).toBe(600);
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
});

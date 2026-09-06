import { describe, expect, it } from "vitest";
import { parseFenString } from "./money.js";

describe("MoneyFen 十进制字符串分校验（主规格 10.5/12.1）", () => {
  it("接受规范十进制字符串", () => {
    expect(parseFenString("0", true)).toBe("0");
    expect(parseFenString("1500", false)).toBe("1500");
    expect(parseFenString("9007199254740993", false)).toBe("9007199254740993");
  });

  it("拒绝 number/浮点/负数/前导零/空白/零售价", () => {
    expect(parseFenString(1500, false)).toBeNull();
    expect(parseFenString("12.5", false)).toBeNull();
    expect(parseFenString("-100", false)).toBeNull();
    expect(parseFenString("01500", false)).toBeNull();
    expect(parseFenString(" 1500", false)).toBeNull();
    expect(parseFenString("0", false)).toBeNull();
    expect(parseFenString("0", true)).toBe("0");
  });
});

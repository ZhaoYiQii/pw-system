import { describe, expect, it } from "vitest";
import { fenToYuanText, parseFenString } from "./money.js";

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

describe("fenToYuanText：分 → 元文本（DS-008 共享金额格式）", () => {
  it("0、个位分、整元、非整元都精确到两位小数", () => {
    expect(fenToYuanText("0")).toBe("0.00");
    expect(fenToYuanText("5")).toBe("0.05");
    expect(fenToYuanText("100")).toBe("1.00");
    expect(fenToYuanText("12801")).toBe("128.01");
    expect(fenToYuanText("199900")).toBe("1999.00");
  });

  it("超过 Number.MAX_SAFE_INTEGER 的分金额不丢精度（BigInt 除法/取余）", () => {
    expect(fenToYuanText("9007199254740993")).toBe("90071992547409.93");
    expect(fenToYuanText("9223372036854775807")).toBe("92233720368547758.07");
  });

  it("非法值保持 0.00（不抛错、不产生 NaN）", () => {
    for (const bad of [
      "",
      " ",
      "abc",
      "12.5",
      "-100",
      "01500",
      " 100",
      "100 ",
      "1e2",
      "+100",
    ]) {
      expect(fenToYuanText(bad)).toBe("0.00");
    }
  });
});

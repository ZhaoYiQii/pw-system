/**
 * S-H：admin 端金额展示统一走 BigInt helper（AGENTS「金额使用整数分，禁止 JavaScript 浮点金额」）。
 *
 * 定性要说清：展示路径上「分 → 元」用浮点，在**现实金额范围内输出其实是一致的**，
 * 差异要到 ≥2^53 分（约 90 万亿元）才出现。所以这条改动的价值是「单一真源 + 遵守仓库规则」，
 * 不是修一个用户可见的 bug。下面第 2 条用例把那个理论差异钉死，避免以后有人以为无所谓。
 */
import { describe, expect, it } from "vitest";
import {
  fenToYuanText,
  formatFenYuan,
  sumFen,
  yuanToFenString,
} from "../money";

describe("S-H：金额展示 helper（分 ↔ 元，全程不经过浮点）", () => {
  it("常规金额两位小数，纯数字文本不带货币符号", () => {
    expect(fenToYuanText("0")).toBe("0.00");
    expect(fenToYuanText("5")).toBe("0.05");
    expect(fenToYuanText("7000")).toBe("70.00");
    expect(fenToYuanText("123456789")).toBe("1234567.89");
  });

  it("超过 2^53 分时仍精确（浮点实现会少 1 分）", () => {
    // 对照：(9007199254740993 / 100).toFixed(2) === "90071992547409.92"
    expect(fenToYuanText("9007199254740993")).toBe("90071992547409.93");
    expect(fenToYuanText("99999999999999999")).toBe("999999999999999.99");
  });

  it("非法输入不抛错（既有契约：回退到 0 值文本，由调用方决定是否先校验）", () => {
    expect(fenToYuanText("abc")).toBe("0.00");
    expect(formatFenYuan("abc")).toBe("¥0.00");
    expect(yuanToFenString("abc")).toBeNull();
  });

  it("汇总与元→分换算保持整数分", () => {
    expect(sumFen(["7000", "8000", "1"])).toBe("15001");
    expect(yuanToFenString("70.00")).toBe("7000");
    expect(yuanToFenString("12.3")).toBe("1230");
    expect(yuanToFenString("12.345")).toBeNull();
  });
});

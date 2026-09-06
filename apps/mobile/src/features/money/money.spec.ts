import { describe, expect, it } from "vitest";
import { formatFenYuan } from "./money";

describe("mobile formatFenYuan（十进制字符串分 → 元展示）", () => {
  it("分/元/角边界正确", () => {
    expect(formatFenYuan("0")).toBe("¥0.00");
    expect(formatFenYuan("5")).toBe("¥0.05");
    expect(formatFenYuan("50")).toBe("¥0.50");
    expect(formatFenYuan("500")).toBe("¥5.00");
    expect(formatFenYuan("1234567890123456789012")).toBe(
      "¥12345678901234567890.12",
    );
  });

  it("非法/浮点/负数不猜测，回退 ¥0.00", () => {
    expect(formatFenYuan("12.5")).toBe("¥0.00");
    expect(formatFenYuan("-100")).toBe("¥0.00");
    expect(formatFenYuan("abc")).toBe("¥0.00");
  });
});

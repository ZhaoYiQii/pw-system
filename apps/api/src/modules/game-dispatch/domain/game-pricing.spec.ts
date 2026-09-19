import { describe, expect, it } from "vitest";
import { resolveUnitPriceFen } from "./game-pricing.js";

const rule = (dimensionKey: string, amountFen: string) => ({
  dimensionKey,
  amountFen,
});

describe("resolveUnitPriceFen：通用维度加价", () => {
  it("按维度键命中加价：底价 + 命中金额", () => {
    expect(
      resolveUnitPriceFen({
        gameBaseFen: "5000",
        fallbackBaseFen: "4000",
        dimensionKeys: ["mode=ranked"],
        ruleItems: [rule("mode=ranked", "1500")],
      }),
    ).toBe("6500");
  });

  it("未命中任何维度键时只返回底价", () => {
    expect(
      resolveUnitPriceFen({
        gameBaseFen: "5000",
        fallbackBaseFen: "4000",
        dimensionKeys: ["mode=normal"],
        ruleItems: [rule("mode=ranked", "1500")],
      }),
    ).toBe("5000");
  });

  it("多个维度键命中时累加", () => {
    expect(
      resolveUnitPriceFen({
        gameBaseFen: "5000",
        fallbackBaseFen: null,
        dimensionKeys: ["mode=ranked", "rank=钻石"],
        ruleItems: [rule("mode=ranked", "1500"), rule("rank=钻石", "2000")],
      }),
    ).toBe("8500");
  });

  it("陪玩×游戏底价缺失时回退到陪玩级兜底", () => {
    expect(
      resolveUnitPriceFen({
        gameBaseFen: null,
        fallbackBaseFen: "4000",
        dimensionKeys: ["mode=ranked"],
        ruleItems: [rule("mode=ranked", "1500")],
      }),
    ).toBe("5500");
  });

  it("底价与兜底都缺失时返回 null（由调用方给出业务错误，不静默按 0 计）", () => {
    expect(
      resolveUnitPriceFen({
        gameBaseFen: null,
        fallbackBaseFen: null,
        dimensionKeys: ["mode=ranked"],
        ruleItems: [rule("mode=ranked", "1500")],
      }),
    ).toBeNull();
  });

  it("大额金额走 BigInt，不受 Number 精度限制", () => {
    expect(
      resolveUnitPriceFen({
        gameBaseFen: "9007199254740993",
        fallbackBaseFen: null,
        dimensionKeys: ["mode=ranked"],
        ruleItems: [rule("mode=ranked", "1500")],
      }),
    ).toBe("9007199254742493");
  });

  it("非法金额（非整数十进制字符串）直接报错，不静默取整", () => {
    expect(() =>
      resolveUnitPriceFen({
        gameBaseFen: "5000",
        fallbackBaseFen: null,
        dimensionKeys: ["mode=ranked"],
        ruleItems: [rule("mode=ranked", "15.5")],
      }),
    ).toThrow();
  });
});

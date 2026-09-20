import { describe, expect, it } from "vitest";
import {
  pricingDimensionKeys,
  resolveSurchargeFen,
  resolveUnitPriceFen,
} from "./game-pricing.js";

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

describe("pricingDimensionKeys：模板取值 → 命中键", () => {
  const fields = [
    { key: "mode", optionValues: ["ranked", "normal"] },
    { key: "server", optionValues: ["国服"] },
  ];

  it("只把落在模板选项里的取值变成 `<stableKey>=<选项值>`", () => {
    expect(
      pricingDimensionKeys({
        fields,
        values: { mode: "ranked", server: "国服" },
      }),
    ).toEqual(["mode=ranked", "server=国服"]);
  });

  it("选项之外的取值不形成命中键（不猜测、不放宽）", () => {
    expect(
      pricingDimensionKeys({ fields, values: { mode: "unknown" } }),
    ).toEqual([]);
  });

  it("多选字段按提交顺序逐个形成键，并按字段顺序去重", () => {
    expect(
      pricingDimensionKeys({
        fields: [{ key: "tags", optionValues: ["a", "b"] }],
        values: { tags: ["b", "a", "b"] },
      }),
    ).toEqual(["tags=b", "tags=a"]);
  });

  it("v1 段位标签额外给出 `rank=<标签>` 兼容键（对应 v1 段位规则的迁移命中键）", () => {
    expect(
      pricingDimensionKeys({
        fields,
        values: { mode: "ranked" },
        rankLabel: "钻石",
      }),
    ).toEqual(["mode=ranked", "rank=钻石"]);
  });

  it("没有取值的字段不产生键（缺省提交不会命中任何加价）", () => {
    expect(pricingDimensionKeys({ fields, values: {} })).toEqual([]);
  });
});

describe("resolveSurchargeFen：加价合计", () => {
  it("同一维度键的加价只按规则库逐条累加，未命中记 0", () => {
    expect(
      resolveSurchargeFen(
        ["mode=ranked"],
        [rule("mode=ranked", "1500"), rule("rank=钻石", "2000")],
      ),
    ).toBe("1500");
  });

  it("无命中时为 0（调用方仍需底价兜底，0 加价不等于 0 单价）", () => {
    expect(resolveSurchargeFen([], [rule("mode=ranked", "1500")])).toBe("0");
  });
});

import { describe, expect, it } from "vitest";
import {
  DIMENSION_KEY_PATTERN,
  fenToYuan,
  parseAmountInput,
  playerBaseRow,
  playerBaseSourceLabel,
  ruleRowsFromView,
  toSaveBody,
  validateRuleRows,
  type RuleRow,
} from "./pricing-rules-state";
import type {
  GamePricingRuleView,
  PlayerGameBaseView,
} from "./pricing-rules-api";

function ruleView(
  items: { dimensionKey: string; amountFen: string; sortOrder: number }[],
): GamePricingRuleView {
  return {
    gameId: "game-1",
    enabled: true,
    updatedAt: "2026-09-20T00:00:00.000Z",
    items: items.map((item, index) => ({
      id: `item-${index}`,
      kind: "SURCHARGE" as const,
      ...item,
    })),
  };
}

describe("规则库行：读取、校验与请求体", () => {
  it("按 sortOrder 还原顺序，未配置游戏得到空表", () => {
    const rows = ruleRowsFromView(
      ruleView([
        { dimensionKey: "rank=钻石", amountFen: "2000", sortOrder: 1 },
        { dimensionKey: "mode=ranked", amountFen: "1500", sortOrder: 0 },
      ]),
    );
    expect(rows.map((row) => row.dimensionKey)).toEqual([
      "mode=ranked",
      "rank=钻石",
    ]);
    expect(ruleRowsFromView(ruleView([]))).toEqual([]);
  });

  it("命中键与金额的校验：非法键、重复键、浮点与负数都被拦下", () => {
    const rows: RuleRow[] = [
      { kind: "SURCHARGE", dimensionKey: "Mode=ranked", amountFen: "1500" },
      { kind: "SURCHARGE", dimensionKey: "mode=ranked", amountFen: "15.5" },
      { kind: "SURCHARGE", dimensionKey: "mode=ranked", amountFen: "-1" },
    ];
    const errors = validateRuleRows(rows);
    expect(errors.map((error) => [error.index, error.field])).toEqual([
      [0, "dimensionKey"],
      [1, "amountFen"],
      [2, "dimensionKey"],
      [2, "amountFen"],
    ]);
    expect(validateRuleRows([])).toEqual([]);
  });

  it("合法行通过校验并按数组顺序生成 PUT 请求体", () => {
    const rows: RuleRow[] = [
      { kind: "SURCHARGE", dimensionKey: " mode=ranked ", amountFen: " 1500 " },
      { kind: "SURCHARGE", dimensionKey: "rank=钻石", amountFen: "2000" },
    ];
    expect(validateRuleRows(rows)).toEqual([]);
    expect(toSaveBody(rows)).toEqual({
      items: [
        {
          kind: "SURCHARGE",
          dimensionKey: "mode=ranked",
          amountFen: "1500",
          sortOrder: 0,
        },
        {
          kind: "SURCHARGE",
          dimensionKey: "rank=钻石",
          amountFen: "2000",
          sortOrder: 1,
        },
      ],
    });
  });

  it("金额只在整数分上运算：分转元不丢精度", () => {
    expect(parseAmountInput("1500")).toBe("1500");
    expect(parseAmountInput("01500")).toBeNull();
    expect(parseAmountInput("15.5")).toBeNull();
    expect(fenToYuan("1500")).toBe("15.00");
    expect(fenToYuan("5")).toBe("0.05");
    expect(fenToYuan("9007199254740993")).toBe("90071992547409.93");
    expect(DIMENSION_KEY_PATTERN.test("mode=ranked")).toBe(true);
    expect(DIMENSION_KEY_PATTERN.test("mode=")).toBe(false);
  });
});

describe("陪玩×游戏底价：生效来源", () => {
  function baseView(
    overrides: Partial<PlayerGameBaseView>,
  ): PlayerGameBaseView {
    return {
      playerId: "p1",
      gameId: "game-1",
      basePricePerHourFen: null,
      fallbackBasePricePerHourFen: null,
      status: null,
      ...overrides,
    };
  }

  it("专属底价优先于陪玩级兜底", () => {
    const row = playerBaseRow({
      playerId: "p1",
      playerName: "阿一",
      view: baseView({
        basePricePerHourFen: "6000",
        fallbackBasePricePerHourFen: "5000",
        status: "ACTIVE",
      }),
    });
    expect(row.source).toBe("GAME");
    expect(row.basePricePerHourFen).toBe("6000");
    expect(playerBaseSourceLabel(row)).toBe("专属底价");
  });

  it("底价停用或未设置时回退到陪玩级兜底", () => {
    const inactive = playerBaseRow({
      playerId: "p1",
      playerName: "阿一",
      view: baseView({
        basePricePerHourFen: "6000",
        fallbackBasePricePerHourFen: "5000",
        status: "INACTIVE",
      }),
    });
    expect(inactive.source).toBe("FALLBACK");
    expect(inactive.basePricePerHourFen).toBeNull();
    expect(playerBaseSourceLabel(inactive)).toBe("陪玩级兜底");
  });

  it("两者都没有时标记未设置（这类陪玩不能接该游戏的单）", () => {
    const row = playerBaseRow({
      playerId: "p2",
      playerName: "阿二",
      view: baseView({}),
    });
    expect(row.source).toBe("NONE");
    expect(playerBaseSourceLabel(row)).toBe("未设置");
  });
});

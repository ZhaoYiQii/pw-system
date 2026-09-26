import { describe, expect, it } from "vitest";
import type { PublishedConfigV2 } from "./game-template-config-v2.js";
import {
  calculateTemplatePriceAdjustmentFen,
  calculateTemplateStaffing,
  templatePricingDimensionFields,
  TemplateRuntimeValueError,
  validateTemplateChoiceValues,
} from "./game-template-calculations.js";

function publishedConfig(
  overrides: Partial<PublishedConfigV2> = {},
): PublishedConfigV2 {
  return {
    schemaVersion: 2,
    documentRendererVersion: 1,
    sections: [
      {
        stableKey: "requirements",
        label: "需求信息",
        enabled: true,
        sortOrder: 0,
        layout: { columns: 2 },
      },
    ],
    components: [],
    staffingSource: { kind: "FIXED", count: 1 },
    ...overrides,
  };
}

function staffingTableConfig(enabled = true): PublishedConfigV2 {
  return publishedConfig({
    components: [
      {
        kind: "REPEATABLE_TABLE",
        stableKey: "staffing",
        sectionKey: "requirements",
        label: "岗位",
        enabled,
        sortOrder: 0,
        layout: { colSpan: 2, rowBreakBefore: false },
        columns: [
          {
            stableKey: "role",
            label: "位置",
            columnType: "TEXT",
            semanticRole: "STAFFING_LABEL",
            required: true,
          },
          {
            stableKey: "count",
            label: "人数",
            columnType: "NUMBER",
            semanticRole: "STAFFING_COUNT",
            required: true,
          },
        ],
        defaultRows: [],
      },
    ],
    staffingSource: {
      kind: "REPEATABLE_TABLE_SUM",
      componentKey: "staffing",
      columnKey: "count",
    },
  });
}

describe("通用模板人数计算", () => {
  it("支持固定人数、数字字段和可重复表格人数汇总", () => {
    expect(calculateTemplateStaffing(publishedConfig(), {})).toEqual({
      totalCount: 1,
      rows: [{ label: "人数", count: 1 }],
    });

    const numberField = publishedConfig({
      components: [
        {
          kind: "FIELD",
          stableKey: "player_count",
          sectionKey: "requirements",
          label: "需要人数",
          enabled: true,
          sortOrder: 0,
          layout: { colSpan: 1, rowBreakBefore: false },
          fieldType: "NUMBER",
          semanticRole: "STAFFING_COUNT",
          required: true,
        },
      ],
      staffingSource: {
        kind: "NUMBER_FIELD",
        componentKey: "player_count",
      },
    });
    expect(calculateTemplateStaffing(numberField, { player_count: 3 })).toEqual(
      {
        totalCount: 3,
        rows: [{ label: "需要人数", count: 3 }],
      },
    );

    const table = publishedConfig({
      components: [
        {
          kind: "REPEATABLE_TABLE",
          stableKey: "staffing",
          sectionKey: "requirements",
          label: "岗位",
          enabled: true,
          sortOrder: 0,
          layout: { colSpan: 2, rowBreakBefore: false },
          columns: [
            {
              stableKey: "role",
              label: "位置",
              columnType: "TEXT",
              semanticRole: "STAFFING_LABEL",
              required: true,
            },
            {
              stableKey: "count",
              label: "人数",
              columnType: "NUMBER",
              semanticRole: "STAFFING_COUNT",
              required: true,
            },
          ],
          defaultRows: [],
        },
      ],
      staffingSource: {
        kind: "REPEATABLE_TABLE_SUM",
        componentKey: "staffing",
        columnKey: "count",
      },
    });
    expect(
      calculateTemplateStaffing(table, {
        staffing: [
          { role: "打野", count: 2 },
          { role: "辅助", count: 1 },
        ],
      }),
    ).toEqual({
      totalCount: 3,
      rows: [
        { label: "打野", count: 2 },
        { label: "辅助", count: 1 },
      ],
    });
  });

  it("拒绝非法、越界或不属于启用模板的人数值", () => {
    const config = publishedConfig({
      components: [
        {
          kind: "FIELD",
          stableKey: "player_count",
          sectionKey: "requirements",
          label: "需要人数",
          enabled: true,
          sortOrder: 0,
          layout: { colSpan: 1, rowBreakBefore: false },
          fieldType: "NUMBER",
          semanticRole: "STAFFING_COUNT",
          required: true,
        },
      ],
      staffingSource: {
        kind: "NUMBER_FIELD",
        componentKey: "player_count",
      },
    });

    for (const value of [0, -1, 1.5, 501, "2"]) {
      expect(() =>
        calculateTemplateStaffing(config, { player_count: value }),
      ).toThrow(TemplateRuntimeValueError);
    }
    expect(() =>
      calculateTemplateStaffing(config, {
        player_count: 2,
        client_total: 99,
      }),
    ).toThrow(/未知字段/);

    const disabled = publishedConfig({
      ...config,
      components: config.components.map((component) => ({
        ...component,
        enabled: false,
      })),
    });
    expect(() =>
      calculateTemplateStaffing(disabled, { player_count: 2 }),
    ).toThrow(/人数来源/);
  });

  it("拒绝表格超限、未知列、错误值及无效人数绑定", () => {
    const config = staffingTableConfig();
    for (const count of [0, -1, 1.5, "2"]) {
      expect(() =>
        calculateTemplateStaffing(config, {
          staffing: [{ role: "打野", count }],
        }),
      ).toThrow(TemplateRuntimeValueError);
    }
    expect(() =>
      calculateTemplateStaffing(config, {
        staffing: Array.from({ length: 51 }, () => ({
          role: "打野",
          count: 1,
        })),
      }),
    ).toThrow(/50 行/);
    expect(() =>
      calculateTemplateStaffing(config, {
        staffing: [{ role: "打野", count: 1, client_total: 99 }],
      }),
    ).toThrow(/未知列/);

    expect(() =>
      calculateTemplateStaffing(staffingTableConfig(false), {
        staffing: [{ role: "打野", count: 1 }],
      }),
    ).toThrow(/人数来源/);

    const wrongColumn = staffingTableConfig();
    const table = wrongColumn.components[0];
    if (table?.kind === "REPEATABLE_TABLE" && table.columns[1]) {
      table.columns[1].columnType = "TEXT";
    }
    expect(() =>
      calculateTemplateStaffing(wrongColumn, {
        staffing: [{ role: "打野", count: 1 }],
      }),
    ).toThrow(/人数来源列/);
  });
});

describe("通用模板选项加价计算", () => {
  function pricedConfig(
    aggregationPolicy: "SUM" | "MAX" = "SUM",
  ): PublishedConfigV2 {
    return publishedConfig({
      components: [
        {
          kind: "FIELD",
          stableKey: "target_rank",
          sectionKey: "requirements",
          label: "目标段位",
          enabled: true,
          sortOrder: 0,
          layout: { colSpan: 1, rowBreakBefore: false },
          fieldType: "SINGLE_SELECT",
          semanticRole: "TARGET_RANK",
          required: true,
          options: [
            { value: "diamond", label: "钻石" },
            { value: "king", label: "王者", priceDeltaFen: "100" },
          ],
        },
        {
          kind: "FIELD",
          stableKey: "game_mode",
          sectionKey: "requirements",
          label: "模式",
          enabled: true,
          sortOrder: 1,
          layout: { colSpan: 1, rowBreakBefore: false },
          fieldType: "SINGLE_SELECT",
          semanticRole: "MODE",
          required: false,
          options: [
            { value: "normal", label: "普通" },
            { value: "peak", label: "高峰", priceDeltaFen: "50" },
          ],
        },
        {
          kind: "FIELD",
          stableKey: "extras",
          sectionKey: "requirements",
          label: "附加服务",
          enabled: true,
          sortOrder: 2,
          layout: { colSpan: 2, rowBreakBefore: false },
          fieldType: "MULTI_SELECT",
          semanticRole: "CUSTOM",
          required: false,
          aggregationPolicy,
          options: [
            { value: "fast", label: "快速响应", priceDeltaFen: "20" },
            { value: "voice", label: "语音", priceDeltaFen: "30" },
          ],
        },
      ],
    });
  }

  it("按发布快照累加单选和多个字段，并支持多选 SUM/MAX", () => {
    expect(
      calculateTemplatePriceAdjustmentFen(pricedConfig("SUM"), {
        target_rank: "king",
        game_mode: "peak",
        extras: ["fast", "voice"],
      }),
    ).toBe("200");
    expect(
      calculateTemplatePriceAdjustmentFen(pricedConfig("MAX"), {
        target_rank: "king",
        game_mode: "peak",
        extras: ["fast", "voice"],
      }),
    ).toBe("180");
    expect(
      calculateTemplatePriceAdjustmentFen(pricedConfig(), {
        target_rank: "diamond",
      }),
    ).toBe("0");
  });

  it("豁免语义角色（TARGET_RANK / MODE）允许库外值且不加价（ADR-0010 决定 4/6）", () => {
    expect(
      validateTemplateChoiceValues(pricedConfig(), {
        target_rank: "神秘段位",
      }),
    ).toBeUndefined();
    expect(
      calculateTemplatePriceAdjustmentFen(pricedConfig(), {
        target_rank: "神秘段位",
      }),
    ).toBe("0");
    // 库外值不加价，但同一订单里命中选项的其他字段照旧加价。
    expect(
      calculateTemplatePriceAdjustmentFen(pricedConfig(), {
        target_rank: "king",
        game_mode: "自定义模式",
      }),
    ).toBe("100");
  });

  it("未豁免的多选字段仍然拒绝库外值", () => {
    expect(() =>
      calculateTemplatePriceAdjustmentFen(pricedConfig(), {
        extras: ["fast", "unknown_extra"],
      }),
    ).toThrow(/不在模板选项中/);
  });

  it("拒绝未知选项、错误值形状和非规范整数分价格", () => {
    // TARGET_RANK 属豁免语义角色（ADR-0010 决定 4）：库外值放行且不加价。
    // 「未知选项被拒」的覆盖已改挂到未豁免的多选字段（见上一条用例）。
    expect(
      calculateTemplatePriceAdjustmentFen(pricedConfig(), {
        target_rank: "unknown",
      }),
    ).toBe("0");
    expect(() =>
      calculateTemplatePriceAdjustmentFen(pricedConfig(), {
        target_rank: ["king"],
      }),
    ).toThrow(TemplateRuntimeValueError);
    expect(() =>
      calculateTemplatePriceAdjustmentFen(pricedConfig(), {
        target_rank: "king",
        extras: Array.from({ length: 101 }, (_, index) => `option_${index}`),
      }),
    ).toThrow(/100/);

    const malformed = pricedConfig();
    const field = malformed.components[0];
    if (field?.kind === "FIELD" && field.options?.[1]) {
      field.options[1].priceDeltaFen = "10.5";
    }
    expect(() =>
      calculateTemplatePriceAdjustmentFen(malformed, {
        target_rank: "king",
      }),
    ).toThrow(/整数分/);
  });
});

describe("算价模型（ADR-0003）：维度字段与取值校验", () => {
  /** 启用区块内的单选 + 多选 + 说明组件；说明组件不参与命中。 */
  function choiceConfig(sectionEnabled = true): PublishedConfigV2 {
    return publishedConfig({
      sections: [
        {
          stableKey: "requirements",
          label: "需求信息",
          enabled: sectionEnabled,
          sortOrder: 0,
          layout: { columns: 2 },
        },
      ],
      components: [
        {
          kind: "FIELD",
          stableKey: "mode",
          sectionKey: "requirements",
          label: "游戏模式",
          enabled: true,
          sortOrder: 0,
          layout: { colSpan: 1, rowBreakBefore: false },
          fieldType: "SINGLE_SELECT",
          semanticRole: "MODE",
          required: true,
          options: [
            { value: "ranked", label: "排位" },
            { value: "normal", label: "匹配" },
          ],
        },
        {
          kind: "FIELD",
          stableKey: "extras",
          sectionKey: "requirements",
          label: "附加服务",
          enabled: true,
          sortOrder: 1,
          layout: { colSpan: 1, rowBreakBefore: false },
          fieldType: "MULTI_SELECT",
          semanticRole: "CUSTOM",
          required: false,
          aggregationPolicy: "SUM",
          options: [{ value: "fast", label: "快速响应" }],
        },
        {
          kind: "NOTE",
          stableKey: "notice",
          sectionKey: "requirements",
          label: "须知",
          enabled: true,
          sortOrder: 2,
          layout: { colSpan: 1, rowBreakBefore: false },
          text: "上号前请确认订单",
        },
      ],
    });
  }

  it("维度字段只取启用区块内的选择类字段：stableKey + 选项值", () => {
    expect(templatePricingDimensionFields(choiceConfig())).toEqual([
      { key: "mode", optionValues: ["ranked", "normal"] },
      { key: "extras", optionValues: ["fast"] },
    ]);
  });

  it("区块停用后其中的字段不参与命中（与人数/文案同一套启用语义）", () => {
    expect(templatePricingDimensionFields(choiceConfig(false))).toEqual([]);
  });

  it("取值校验保留：未知选项、重复多选被拒，合法取值放行", () => {
    // MODE 属豁免语义角色（ADR-0010 决定 4）：该字段的未知选项不再被拒，
    // 故把这条覆盖改挂到未豁免的 extras（CUSTOM 多选）。
    expect(() =>
      validateTemplateChoiceValues(choiceConfig(), { extras: ["unknown"] }),
    ).toThrow(/不在模板选项中/);
    expect(() =>
      validateTemplateChoiceValues(choiceConfig(), {
        extras: ["fast", "fast"],
      }),
    ).toThrow(/重复选择/);
    expect(() =>
      validateTemplateChoiceValues(choiceConfig(), {
        mode: "ranked",
        extras: ["fast"],
      }),
    ).not.toThrow();
  });
});

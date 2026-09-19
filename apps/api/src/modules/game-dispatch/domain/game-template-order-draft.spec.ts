import { describe, expect, it } from "vitest";
import type { PublishedConfigV2 } from "./game-template-config-v2.js";
import { GenericTemplateError } from "./errors.js";
import { buildTemplateOrderDraft } from "./game-template-order-draft.js";

/** 一个含人数来源（表格列汇总）、选项加价与说明组件的发布配置。 */
function orderConfig(): PublishedConfigV2 {
  return {
    schemaVersion: 2,
    documentRendererVersion: 1,
    sections: [
      {
        stableKey: "basic",
        label: "基本信息",
        enabled: true,
        sortOrder: 0,
        layout: { columns: 2 },
      },
      {
        stableKey: "roster",
        label: "组队岗位",
        enabled: true,
        sortOrder: 1,
        layout: { columns: 1 },
      },
    ],
    components: [
      {
        kind: "FIELD",
        stableKey: "mode",
        sectionKey: "basic",
        label: "游戏模式",
        enabled: true,
        sortOrder: 0,
        layout: { colSpan: 1, rowBreakBefore: false },
        fieldType: "SINGLE_SELECT",
        semanticRole: "MODE",
        required: true,
        options: [
          { value: "ranked", label: "排位", priceDeltaFen: "1500" },
          { value: "normal", label: "匹配" },
        ],
      },
      {
        kind: "NOTE",
        stableKey: "notice",
        sectionKey: "basic",
        label: "须知",
        enabled: true,
        sortOrder: 1,
        layout: { colSpan: 2, rowBreakBefore: true },
        text: "上号前请确认订单",
      },
      {
        kind: "REPEATABLE_TABLE",
        stableKey: "roster_table",
        sectionKey: "roster",
        label: "岗位与人数",
        enabled: true,
        sortOrder: 0,
        layout: { colSpan: 1, rowBreakBefore: false },
        columns: [
          {
            stableKey: "position",
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
        defaultRows: [{ position: "陪玩", count: 1 }],
      },
    ],
    staffingSource: {
      kind: "REPEATABLE_TABLE_SUM",
      componentKey: "roster_table",
      columnKey: "count",
    },
  };
}

function expectTemplateError(
  run: () => unknown,
  code: string,
): GenericTemplateError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(GenericTemplateError);
    const typed = error as GenericTemplateError;
    expect(typed.code).toBe(code);
    return typed;
  }
  throw new Error("expected a GenericTemplateError but none was thrown");
}

describe("buildTemplateOrderDraft：按发布快照生成订单草稿", () => {
  it("按人数来源汇总表格列，并给出岗位分布", () => {
    const draft = buildTemplateOrderDraft(orderConfig(), {
      mode: "ranked",
      roster_table: [
        { position: "陪玩", count: 2 },
        { position: "陪练", count: 1 },
      ],
    });

    expect(draft.staffing.total).toBe(3);
    expect(draft.staffing.rows.map((row) => row.count)).toEqual([2, 1]);
    expect(draft.staffing.rows[0]?.label).toBe("陪玩");
  });

  it("按已选选项的整数分加价求和，不读客户端提交的最终价格", () => {
    const ranked = buildTemplateOrderDraft(orderConfig(), {
      mode: "ranked",
      roster_table: [{ position: "陪玩", count: 2 }],
    });
    const normal = buildTemplateOrderDraft(orderConfig(), {
      mode: "normal",
      roster_table: [{ position: "陪玩", count: 2 }],
    });

    expect(ranked.priceAdjustmentFen).toBe("1500");
    expect(normal.priceAdjustmentFen).toBe("0");
  });

  it("用发布快照生成自动文案，包含区块标题与值且不含内部键", () => {
    const draft = buildTemplateOrderDraft(orderConfig(), {
      mode: "ranked",
      roster_table: [{ position: "陪玩", count: 2 }],
    });

    expect(draft.document.schemaVersion).toBe(1);
    expect(draft.document.plainText).toContain("【基本信息】");
    expect(draft.document.plainText).toContain("游戏模式：排位");
    expect(draft.document.plainText).toContain("上号前请确认订单");
    expect(draft.document.plainText).not.toContain("roster_table");
    expect(draft.document.plainText).not.toContain("staffingSource");
  });

  it("拒绝发布配置里不存在的稳定键（含伪造的人数与价格）", () => {
    const error = expectTemplateError(
      () =>
        buildTemplateOrderDraft(orderConfig(), {
          mode: "ranked",
          roster_table: [{ position: "陪玩", count: 2 }],
          totalCount: 99,
        }),
      "TEMPLATE_COMPONENT_INVALID",
    );

    expect(error.details).toMatchObject({ path: "$.values.totalCount" });
  });

  it("拒绝未声明的选项值与越界人数", () => {
    expectTemplateError(
      () =>
        buildTemplateOrderDraft(orderConfig(), {
          mode: "unknown",
          roster_table: [{ position: "陪玩", count: 1 }],
        }),
      "TEMPLATE_COMPONENT_INVALID",
    );

    expectTemplateError(
      () =>
        buildTemplateOrderDraft(orderConfig(), {
          mode: "ranked",
          roster_table: [{ position: "陪玩", count: 501 }],
        }),
      "TEMPLATE_COMPONENT_INVALID",
    );
  });

  it("人数表格行含未知列时拒绝", () => {
    expectTemplateError(
      () =>
        buildTemplateOrderDraft(orderConfig(), {
          mode: "ranked",
          roster_table: [{ position: "陪玩", count: 1, extra: "x" }],
        }),
      "TEMPLATE_COMPONENT_INVALID",
    );
  });
});

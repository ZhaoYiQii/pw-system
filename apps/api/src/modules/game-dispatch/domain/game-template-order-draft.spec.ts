import { describe, expect, it } from "vitest";
import type { PublishedConfigV2 } from "./game-template-config-v2.js";
import { GenericTemplateError } from "./errors.js";
import {
  buildTemplateOrderDraft,
  buildTemplateOrderDraftForAudience,
} from "./game-template-order-draft.js";

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

/**
 * orderConfig 加两个端口专属字段（都挂在 basic 分组，分组本身未声明 → 默认两个全选）：
 * 内部备注只给客服；客户备注只给客户且是必填。
 */
function audienceConfig(): PublishedConfigV2 {
  const config = orderConfig();
  return {
    ...config,
    components: [
      ...config.components,
      {
        kind: "FIELD",
        stableKey: "internal_note",
        sectionKey: "basic",
        label: "内部备注",
        enabled: true,
        sortOrder: 2,
        layout: { colSpan: 1, rowBreakBefore: false },
        fieldType: "TEXT",
        semanticRole: "CUSTOM",
        required: false,
        audiences: ["CS"],
      },
      {
        kind: "FIELD",
        stableKey: "customer_note",
        sectionKey: "basic",
        label: "客户备注",
        enabled: true,
        sortOrder: 3,
        layout: { colSpan: 1, rowBreakBefore: false },
        fieldType: "TEXTAREA",
        semanticRole: "ORDER_NOTE",
        required: true,
        audiences: ["CUSTOMER"],
      },
    ],
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

  it("写入按端口丢值：不可见字段的值不落库，其必填也不参与校验（V-5 / V-10）", () => {
    const outcome = buildTemplateOrderDraftForAudience(
      audienceConfig(),
      {
        mode: "ranked",
        roster_table: [{ position: "陪玩", count: 2 }],
        internal_note: "老板是老朋友",
        // 客户端看不见却硬塞：必须丢弃而不是报错，也不能进文案。
        customer_note: "给我留个辅助位",
      },
      "CS",
    );

    expect(outcome.droppedKeys).toEqual(["customer_note"]);
    expect(outcome.storedValues).toEqual({
      mode: "ranked",
      roster_table: [{ position: "陪玩", count: 2 }],
      internal_note: "老板是老朋友",
    });
    expect(outcome.draft.staffing.total).toBe(2);
    expect(outcome.draft.document.plainText).toContain(
      "内部备注：老板是老朋友",
    );
    expect(outcome.draft.document.plainText).not.toContain("客户备注");

    // 未知键不属于"不可见字段"，仍然走既有拒绝路径并指出具体键。
    const unknownKey = expectTemplateError(
      () =>
        buildTemplateOrderDraftForAudience(
          audienceConfig(),
          {
            mode: "ranked",
            roster_table: [{ position: "陪玩", count: 2 }],
            forged_total: "9",
          },
          "CS",
        ),
      "TEMPLATE_COMPONENT_INVALID",
    );
    expect(unknownKey.details).toMatchObject({ path: "$.values.forged_total" });
  });

  it("同一次写入换到客户端口时，客户专属必填该管用就管用（V-10 对称）", () => {
    // 客户端口：客户备注必填，缺它必须报错。
    expectTemplateError(
      () =>
        buildTemplateOrderDraftForAudience(
          audienceConfig(),
          { mode: "ranked", roster_table: [{ position: "陪玩", count: 1 }] },
          "CUSTOMER",
        ),
      "TEMPLATE_COMPONENT_INVALID",
    );

    const outcome = buildTemplateOrderDraftForAudience(
      audienceConfig(),
      {
        mode: "ranked",
        roster_table: [{ position: "陪玩", count: 1 }],
        customer_note: "给我留个辅助位",
        internal_note: "客服的备注",
      },
      "CUSTOMER",
    );
    expect(outcome.droppedKeys).toEqual(["internal_note"]);
    expect(outcome.draft.document.plainText).toContain(
      "客户备注：给我留个辅助位",
    );
    expect(outcome.draft.document.plainText).not.toContain("内部备注");
  });

  it("参与算价的内容被标成对写入端口不可见时，宁可报错也不静默少算", () => {
    const config = audienceConfig();
    const mode = config.components.find(
      (component) => component.stableKey === "mode",
    );
    if (!mode) throw new Error("fixture missing mode field");
    mode.audiences = ["CUSTOMER"];

    const error = expectTemplateError(
      () =>
        buildTemplateOrderDraftForAudience(
          config,
          { roster_table: [{ position: "陪玩", count: 2 }] },
          "CS",
        ),
      "TEMPLATE_COMPONENT_INVALID",
    );
    expect(error.message).toContain("游戏模式");
  });

  it("人数来源被标成不可见时，报的是标记问题而不是「人数来源不存在」", () => {
    const config = audienceConfig();
    const table = config.components.find(
      (component) => component.stableKey === "roster_table",
    );
    if (!table) throw new Error("fixture missing roster_table");
    table.audiences = ["CUSTOMER"];

    const error = expectTemplateError(
      () =>
        buildTemplateOrderDraftForAudience(config, { mode: "ranked" }, "CS"),
      "TEMPLATE_COMPONENT_INVALID",
    );
    expect(error.message).toContain("岗位与人数");
  });
});

import { describe, expect, it } from "vitest";
import type { DraftConfigV2 } from "./template-draft-state";
import {
  buildCreateOrderRequest,
  describeCreateError,
  hasEnteredValues,
  initialNewOrderState,
  intentFor,
  missingRequiredKeys,
  needsTemplateSwitchConfirm,
  newOrderStage,
  resetIntent,
  selectCustomer,
  selectGame,
  selectTemplate,
  updateValue,
  type NewOrderTemplateOption,
} from "./new-order-template-flow";

function template(
  overrides: Partial<NewOrderTemplateOption> = {},
): NewOrderTemplateOption {
  return {
    templateId: "t1",
    name: "排位陪练",
    description: null,
    versionId: "v1",
    versionNo: 1,
    isDefault: true,
    lastUsedAt: null,
    ...overrides,
  };
}

function config(): DraftConfigV2 {
  return {
    schemaVersion: 2,
    sections: [
      {
        stableKey: "basic",
        label: "基本信息",
        enabled: true,
        sortOrder: 0,
        layout: { columns: 2 },
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
          { value: "ranked", label: "排位" },
          { value: "normal", label: "匹配" },
        ],
      },
      {
        kind: "FIELD",
        stableKey: "note",
        sectionKey: "basic",
        label: "备注",
        enabled: true,
        sortOrder: 1,
        layout: { colSpan: 1, rowBreakBefore: false },
        fieldType: "TEXT",
        semanticRole: "CUSTOM",
        required: false,
      },
    ],
    staffingSource: { kind: "FIXED", count: 1 },
  };
}

describe("new-order-template-flow：三阶段与意图", () => {
  it("阶段由已选项派生：客户+游戏 → 模板 → 表单", () => {
    let state = initialNewOrderState();
    expect(newOrderStage(state)).toBe("PARTY");

    state = selectCustomer(state, "c1");
    expect(newOrderStage(state)).toBe("PARTY");

    state = selectGame(state, "g1");
    expect(newOrderStage(state)).toBe("TEMPLATE");

    state = selectTemplate(state, template());
    expect(newOrderStage(state)).toBe("FORM");
  });

  it("切换游戏清空模板与值", () => {
    let state = selectTemplate(
      selectGame(selectCustomer(initialNewOrderState(), "c1"), "g1"),
      template(),
    );
    state = updateValue(state, "mode", "ranked");

    const switched = selectGame(state, "g2");

    expect(switched.gameId).toBe("g2");
    expect(switched.template).toBeNull();
    expect(switched.values).toEqual({});
    expect(newOrderStage(switched)).toBe("TEMPLATE");
  });

  it("已有输入时切换模板需要确认，确认后可用缓存恢复值", () => {
    let state = selectTemplate(
      selectGame(selectCustomer(initialNewOrderState(), "c1"), "g1"),
      template(),
    );
    state = updateValue(state, "mode", "ranked");
    expect(hasEnteredValues(state)).toBe(true);
    expect(needsTemplateSwitchConfirm(state, "t2")).toBe(true);
    expect(needsTemplateSwitchConfirm(state, "t1")).toBe(false);

    const cached = { mode: "normal" };
    const switched = selectTemplate(
      state,
      template({ templateId: "t2" }),
      cached,
    );
    expect(switched.values).toEqual(cached);

    const restored = selectTemplate(switched, template(), {
      mode: "ranked",
      note: "改回原模板",
    });
    expect(restored.values).toEqual({ mode: "ranked", note: "改回原模板" });
  });

  it("同一意图复用幂等键；值变化或成功后换新键", () => {
    let state = selectTemplate(
      selectGame(selectCustomer(initialNewOrderState(), "c1"), "g1"),
      template(),
    );
    state = updateValue(state, "mode", "ranked");

    let counter = 0;
    const nextKey = () => `key-${++counter}`;

    const first = intentFor(state, nextKey);
    expect(first.key).toBe("key-1");
    const retry = intentFor({ ...state, intent: first }, nextKey);
    expect(retry.key).toBe("key-1");

    const changed = updateValue({ ...state, intent: first }, "mode", "normal");
    const afterChange = intentFor(changed, nextKey);
    expect(afterChange.key).toBe("key-2");

    const afterReset = intentFor(
      resetIntent({ ...state, intent: first }),
      nextKey,
    );
    expect(afterReset.key).toBe("key-3");
  });

  it("必填校验只针对启用且活跃的组件", () => {
    const draft = config();
    expect(missingRequiredKeys(draft, {})).toEqual(["mode"]);
    expect(missingRequiredKeys(draft, { mode: "ranked" })).toEqual([]);

    const disabled: DraftConfigV2 = {
      ...draft,
      components: draft.components.map((component) =>
        component.kind === "FIELD" && component.stableKey === "mode"
          ? { ...component, enabled: false }
          : component,
      ),
    };
    expect(missingRequiredKeys(disabled, {})).toEqual([]);
  });

  it("构造创建请求：缺少归属时抛错，齐备时只带归属与值", () => {
    const empty = initialNewOrderState();
    expect(() => buildCreateOrderRequest(empty)).toThrowError();

    const state = updateValue(
      selectTemplate(
        selectGame(selectCustomer(initialNewOrderState(), "c1"), "g1"),
        template(),
      ),
      "mode",
      "ranked",
    );

    expect(buildCreateOrderRequest(state)).toEqual({
      gameId: "g1",
      templateId: "t1",
      templateVersionId: "v1",
      customerProfileId: "c1",
      values: { mode: "ranked" },
      durationMinutes: 60,
      desiredStartAt: null,
    });
  });

  it("错误映射：归档要重选模板，版本问题要重新加载，且始终保留输入", () => {
    expect(describeCreateError("TEMPLATE_ARCHIVED")).toMatchObject({
      keepValues: true,
      action: "RESELECT_TEMPLATE",
    });
    expect(describeCreateError("TEMPLATE_VERSION_UNAVAILABLE")).toMatchObject({
      keepValues: true,
      action: "RELOAD_FORM",
    });
    expect(describeCreateError("TEMPLATE_IDEMPOTENCY_MISMATCH")).toMatchObject({
      keepValues: true,
      action: "RESET_INTENT",
    });
    expect(describeCreateError("UNKNOWN")).toMatchObject({
      keepValues: true,
      action: "NONE",
    });
  });
});

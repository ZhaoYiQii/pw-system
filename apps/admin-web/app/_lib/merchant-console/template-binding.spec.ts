import { describe, expect, it } from "vitest";
import {
  addComponent,
  addSection,
  insertPreset,
  toggleComponentEnabled,
  updateComponent,
  updateSection,
  type DraftConfigV2,
} from "./template-draft-state";
import {
  collectDraftIssues,
  formatFenToYuan,
  mapIssuesToLocation,
  parseYuanToFen,
  setOptionPrice,
  setStaffingSource,
  staffingCandidates,
} from "./template-binding";

const EMPTY: DraftConfigV2 = {
  schemaVersion: 2,
  sections: [],
  components: [],
  staffingSource: { kind: "FIXED", count: 1 },
};

function base(): { config: DraftConfigV2; sectionKey: string } {
  const section = addSection(EMPTY, { label: "下单信息", columns: 2 });
  if (!section.ok) throw new Error("addSection failed");
  return { config: section.config, sectionKey: section.stableKey };
}

describe("template-binding：人数来源候选与绑定", () => {
  it("候选只包含启用区块里的启用组件：NUMBER 字段与 STAFFING_COUNT 数字列", () => {
    const { config, sectionKey } = base();
    const numberField = addComponent(config, "FIELD", sectionKey);
    if (!numberField.ok) throw new Error("field failed");
    const asNumber = updateComponent(
      numberField.config,
      numberField.stableKey,
      {
        fieldType: "NUMBER",
      },
    );
    const textField = addComponent(asNumber, "FIELD", sectionKey);
    if (!textField.ok) throw new Error("text failed");
    const withTable = insertPreset(
      textField.config,
      sectionKey,
      "STAFFING_TABLE",
    );
    if (!withTable.ok) throw new Error("preset failed");

    const candidates = staffingCandidates(withTable.config);
    expect(candidates.map((candidate) => candidate.kind).sort()).toEqual([
      "NUMBER_FIELD",
      "REPEATABLE_TABLE_SUM",
    ]);
    const table = candidates.find((c) => c.kind === "REPEATABLE_TABLE_SUM");
    expect(table?.columnKey).toBeTruthy();
  });

  it("停用的字段/区块、非数字字段、非 STAFFING_COUNT 列都不进候选", () => {
    const { config, sectionKey } = base();
    const numberField = addComponent(config, "FIELD", sectionKey);
    if (!numberField.ok) throw new Error("field failed");
    const asNumber = updateComponent(
      numberField.config,
      numberField.stableKey,
      {
        fieldType: "NUMBER",
      },
    );

    // 停用字段 → 不再是候选
    const disabledField = toggleComponentEnabled(
      asNumber,
      numberField.stableKey,
      false,
    );
    expect(staffingCandidates(disabledField)).toHaveLength(0);

    // 停用区块 → 字段不再是候选
    const disabledSection = updateSection(asNumber, sectionKey, {
      enabled: false,
    });
    expect(staffingCandidates(disabledSection)).toHaveLength(0);

    // 文本字段即使启用也不可作人数来源
    const textOnly = addComponent(config, "FIELD", sectionKey);
    if (!textOnly.ok) throw new Error("text failed");
    expect(staffingCandidates(textOnly.config)).toHaveLength(0);
  });

  it("绑定人数来源：非法目标被拒绝，合法目标被写入", () => {
    const { config, sectionKey } = base();
    const field = addComponent(config, "FIELD", sectionKey);
    if (!field.ok) throw new Error("field failed");
    const asNumber = updateComponent(field.config, field.stableKey, {
      fieldType: "NUMBER",
    });

    const bad = setStaffingSource(asNumber, {
      kind: "NUMBER_FIELD",
      componentKey: "ghost_field",
    });
    expect(bad.ok).toBe(false);

    const badCount = setStaffingSource(asNumber, { kind: "FIXED", count: 0 });
    expect(badCount.ok).toBe(false);

    const ok = setStaffingSource(asNumber, {
      kind: "NUMBER_FIELD",
      componentKey: field.stableKey,
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) throw new Error("should bind");
    expect(ok.config.staffingSource).toEqual({
      kind: "NUMBER_FIELD",
      componentKey: field.stableKey,
    });

    const preset = insertPreset(asNumber, sectionKey, "STAFFING_TABLE");
    if (!preset.ok) throw new Error("preset failed");
    const table = preset.config.components.find(
      (component) => component.kind === "REPEATABLE_TABLE",
    );
    if (table?.kind !== "REPEATABLE_TABLE") throw new Error("not a table");
    const countColumn = table.columns.find(
      (column) => column.semanticRole === "STAFFING_COUNT",
    )!;

    const wrongColumn = setStaffingSource(preset.config, {
      kind: "REPEATABLE_TABLE_SUM",
      componentKey: table.stableKey,
      columnKey: "ghost_column",
    });
    expect(wrongColumn.ok).toBe(false);

    const okTable = setStaffingSource(preset.config, {
      kind: "REPEATABLE_TABLE_SUM",
      componentKey: table.stableKey,
      columnKey: countColumn.stableKey,
    });
    expect(okTable.ok).toBe(true);
  });
});

describe("template-binding：选项加价（十进制字符串分）", () => {
  it("只接受十进制字符串分；浮点、非字符串、未知选项一律拒绝", () => {
    const { config, sectionKey } = base();
    const preset = insertPreset(config, sectionKey, "OPTION_PRICE");
    if (!preset.ok) throw new Error("preset failed");
    const field = preset.config.components.find(
      (component) => component.kind === "FIELD",
    );
    if (field?.kind !== "FIELD") throw new Error("not a field");
    const optionValue = field.options?.[0]?.value as string;

    const float = setOptionPrice(
      preset.config,
      field.stableKey,
      optionValue,
      "1.5",
    );
    expect(float.ok).toBe(false);
    const numeric = setOptionPrice(
      preset.config,
      field.stableKey,
      optionValue,
      1000 as unknown as string,
    );
    expect(numeric.ok).toBe(false);
    const unknownOption = setOptionPrice(
      preset.config,
      field.stableKey,
      "ghost",
      "100",
    );
    expect(unknownOption.ok).toBe(false);

    const ok = setOptionPrice(
      preset.config,
      field.stableKey,
      optionValue,
      "1500",
    );
    expect(ok.ok).toBe(true);
    if (!ok.ok) throw new Error("should set");
    const updatedField = ok.config.components.find(
      (component) => component.stableKey === field.stableKey,
    );
    if (updatedField?.kind !== "FIELD") throw new Error("not a field");
    expect(updatedField.options?.[0]?.priceDeltaFen).toBe("1500");

    const cleared = setOptionPrice(
      ok.config,
      field.stableKey,
      optionValue,
      null,
    );
    if (!cleared.ok) throw new Error("should clear");
    const clearedField = cleared.config.components.find(
      (component) => component.stableKey === field.stableKey,
    );
    if (clearedField?.kind !== "FIELD") throw new Error("not a field");
    expect(clearedField.options?.[0]?.priceDeltaFen).toBeUndefined();
  });

  it("非选择字段不能配置选项价格", () => {
    const { config, sectionKey } = base();
    const field = addComponent(config, "FIELD", sectionKey);
    if (!field.ok) throw new Error("field failed");
    const result = setOptionPrice(config, field.stableKey, "any", "100");
    expect(result.ok).toBe(false);
  });

  it("分与元的展示换算（仅展示，不改金额口径）", () => {
    expect(formatFenToYuan("1000")).toBe("10.00");
    expect(formatFenToYuan("0")).toBe("0.00");
    expect(formatFenToYuan("abc")).toBe("0.00");
    expect(parseYuanToFen("10.00")).toBe("1000");
    expect(parseYuanToFen("0.5")).toBe("50");
    expect(parseYuanToFen("abc")).toBeNull();
  });
});

describe("template-binding：即时校验与定位", () => {
  it("绑定指向停用组件、选项缺失、金额非法都会产生可定位问题", () => {
    const { config, sectionKey } = base();
    const field = addComponent(config, "FIELD", sectionKey);
    if (!field.ok) throw new Error("field failed");
    const asNumber = updateComponent(field.config, field.stableKey, {
      fieldType: "NUMBER",
    });
    const bound = setStaffingSource(asNumber, {
      kind: "NUMBER_FIELD",
      componentKey: field.stableKey,
    });
    if (!bound.ok) throw new Error("bind failed");
    expect(collectDraftIssues(bound.config)).toHaveLength(0);

    const disabled = toggleComponentEnabled(
      bound.config,
      field.stableKey,
      false,
    );
    const issues = collectDraftIssues(disabled);
    expect(issues.length).toBeGreaterThan(0);
    const located = mapIssuesToLocation(disabled, issues);
    expect(located[0]?.tab).toBe("binding");
    expect(located[0]?.componentKey).toBe(field.stableKey);
    expect(located[0]?.message).toContain("人数来源");
  });

  it("路径按下标定位到 stableKey：组件问题进绑定标签，区块问题进内容标签", () => {
    const { config, sectionKey } = base();
    const first = addComponent(config, "FIELD", sectionKey);
    if (!first.ok) throw new Error("first failed");
    const second = addComponent(first.config, "FIELD", sectionKey);
    if (!second.ok) throw new Error("second failed");

    const located = mapIssuesToLocation(second.config, [
      {
        code: "TEMPLATE_PRICE_RULE_INVALID",
        path: "$.components[1].options[0].priceDeltaFen",
        message: "选项加价必须为非负整数分字符串",
      },
      {
        code: "TEMPLATE_COMPONENT_INVALID",
        path: "$.sections[0]",
        message: "区块名称无效",
      },
      {
        code: "TEMPLATE_BINDING_INVALID",
        path: "$.staffingSource.componentKey",
        message: "人数来源必须指向启用区块中的数字字段",
      },
    ]);
    expect(located[0]).toMatchObject({
      tab: "binding",
      componentKey: second.stableKey,
    });
    expect(located[1]).toMatchObject({ tab: "content", sectionKey });
    expect(located[2]?.tab).toBe("binding");
  });
});

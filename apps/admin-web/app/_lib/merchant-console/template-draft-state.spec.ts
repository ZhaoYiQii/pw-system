import { describe, expect, it } from "vitest";
import type { TemplateDraftConfig } from "./template-api";
import { toContractConfig, type DraftConfigV2 } from "./template-draft-state";
import {
  addComponent,
  addDefaultRow,
  addSection,
  addTableColumn,
  guardRemoveComponent,
  guardRemoveTableColumn,
  insertPreset,
  isDirty,
  moveComponent,
  moveSection,
  removeComponent,
  removeDefaultRow,
  removeSection,
  removeTableColumn,
  referencedComponentKeys,
  setComponentOptions,
  setDefaultRowValue,
  toggleComponentEnabled,
  updateComponent,
  updateTableColumn,
} from "./template-draft-state";

const EMPTY: DraftConfigV2 = {
  schemaVersion: 2,
  sections: [],
  components: [],
  staffingSource: { kind: "FIXED", count: 1 },
};

function withSection(label = "下单信息"): {
  config: DraftConfigV2;
  sectionKey: string;
} {
  const result = addSection(EMPTY, { label, columns: 2 });
  if (!result.ok) throw new Error("addSection failed");
  return { config: result.config, sectionKey: result.stableKey };
}

describe("template-draft-state：按 stableKey 编辑草稿", () => {
  it("新增区块：sortOrder 连续、列数夹在 1..4、stableKey 全局唯一", () => {
    const first = addSection(EMPTY, { label: "下单信息", columns: 9 });
    if (!first.ok) throw new Error("first failed");
    const second = addSection(first.config, { label: "备注", columns: 0 });
    if (!second.ok) throw new Error("second failed");

    expect(second.config.sections.map((s) => s.sortOrder)).toEqual([0, 1]);
    expect(second.config.sections.map((s) => s.layout.columns)).toEqual([4, 1]);
    expect(new Set(second.config.sections.map((s) => s.stableKey)).size).toBe(
      2,
    );
  });

  it("新增组件：落在目标区块、顺序递增、默认整行宽度 1、启用", () => {
    const { config, sectionKey } = withSection();
    const result = addComponent(config, "FIELD", sectionKey);
    if (!result.ok) throw new Error("addComponent failed");

    const component = result.config.components[0];
    expect(component).toMatchObject({
      kind: "FIELD",
      sectionKey,
      enabled: true,
      sortOrder: 0,
      layout: { colSpan: 1, rowBreakBefore: false },
    });
    expect(component?.stableKey).toBe(result.stableKey);
  });

  it("新增组件到不存在的区块：拒绝并给出原因", () => {
    const result = addComponent(EMPTY, "FIELD", "ghost_section");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("should fail");
    expect(result.reason).toContain("区块");
  });

  it("禁用保留配置：关闭开关只改 enabled，组件与内容仍在", () => {
    const { config, sectionKey } = withSection();
    const added = addComponent(config, "FIELD", sectionKey);
    if (!added.ok) throw new Error("addComponent failed");

    const disabled = toggleComponentEnabled(
      added.config,
      added.stableKey,
      false,
    );
    expect(disabled.components).toHaveLength(1);
    expect(disabled.components[0]?.enabled).toBe(false);
    expect(disabled.components[0]?.stableKey).toBe(added.stableKey);

    const reenabled = toggleComponentEnabled(disabled, added.stableKey, true);
    expect(reenabled.components[0]?.enabled).toBe(true);
  });

  it("人数来源引用：guard 阻止删除被引用的组件，解除绑定后可删", () => {
    const { config, sectionKey } = withSection();
    const field = addComponent(config, "FIELD", sectionKey);
    if (!field.ok) throw new Error("field failed");
    const withBinding: DraftConfigV2 = {
      ...field.config,
      staffingSource: { kind: "NUMBER_FIELD", componentKey: field.stableKey },
    };

    expect(referencedComponentKeys(withBinding).has(field.stableKey)).toBe(
      true,
    );
    const guard = guardRemoveComponent(withBinding, field.stableKey);
    expect(guard.ok).toBe(false);
    if (guard.ok) throw new Error("should be blocked");
    expect(guard.reason).toContain("人数来源");

    const unbound: DraftConfigV2 = {
      ...withBinding,
      staffingSource: { kind: "FIXED", count: 1 },
    };
    expect(guardRemoveComponent(unbound, field.stableKey).ok).toBe(true);
    expect(removeComponent(unbound, field.stableKey).components).toHaveLength(
      0,
    );
  });

  it("删除区块：连同其组件一起删除；引用中的组件会阻止删除", () => {
    const { config, sectionKey } = withSection();
    const field = addComponent(config, "FIELD", sectionKey);
    if (!field.ok) throw new Error("field failed");

    const removed = removeSection(field.config, sectionKey);
    expect(removed.ok).toBe(true);
    if (!removed.ok) throw new Error("removeSection failed");
    expect(removed.config.sections).toHaveLength(0);
    expect(removed.config.components).toHaveLength(0);

    const bound: DraftConfigV2 = {
      ...field.config,
      staffingSource: { kind: "NUMBER_FIELD", componentKey: field.stableKey },
    };
    const blocked = removeSection(bound, sectionKey);
    expect(blocked.ok).toBe(false);
  });

  it("参考预设「岗位与人数」：生成普通可重复表格，并显式绑定人数来源", () => {
    const { config, sectionKey } = withSection();
    const preset = insertPreset(config, sectionKey, "STAFFING_TABLE");
    expect(preset.ok).toBe(true);
    if (!preset.ok) throw new Error("preset failed");

    const table = preset.config.components[0];
    expect(table?.kind).toBe("REPEATABLE_TABLE");
    if (table?.kind !== "REPEATABLE_TABLE") throw new Error("not a table");
    const roles = table.columns.map((column) => column.semanticRole).sort();
    expect(roles).toEqual(["STAFFING_COUNT", "STAFFING_LABEL"]);
    const countColumn = table.columns.find(
      (column) => column.semanticRole === "STAFFING_COUNT",
    );
    expect(countColumn?.columnType).toBe("NUMBER");
    expect(preset.config.staffingSource).toEqual({
      kind: "REPEATABLE_TABLE_SUM",
      componentKey: table.stableKey,
      columnKey: countColumn?.stableKey,
    });
    // 预设插入后就是普通组件：可以继续改名/禁用
    const renamed = toggleComponentEnabled(
      preset.config,
      table.stableKey,
      false,
    );
    expect(renamed.components[0]?.enabled).toBe(false);
  });

  it("参考预设「岗位与人数」：语义角色已被占用时拒绝，不生成非法配置", () => {
    const { config, sectionKey } = withSection();
    const first = insertPreset(config, sectionKey, "STAFFING_TABLE");
    if (!first.ok) throw new Error("first preset failed");
    const second = insertPreset(first.config, sectionKey, "STAFFING_TABLE");
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("should fail");
    expect(second.reason).toContain("人数");
  });

  it("参考预设「选择项加价」：普通单选字段，可多次插入，价格是十进制字符串", () => {
    const { config, sectionKey } = withSection();
    const once = insertPreset(config, sectionKey, "OPTION_PRICE");
    if (!once.ok) throw new Error("preset failed");
    const twice = insertPreset(once.config, sectionKey, "OPTION_PRICE");
    expect(twice.ok).toBe(true);
    if (!twice.ok) throw new Error("second preset failed");
    expect(twice.config.components).toHaveLength(2);

    const field = twice.config.components[0];
    if (field?.kind !== "FIELD") throw new Error("not a field");
    expect(field.fieldType).toBe("SINGLE_SELECT");
    expect(field.semanticRole).toBe("CUSTOM");
    for (const option of field.options ?? []) {
      expect(typeof option.priceDeltaFen).toBe("string");
      expect(option.priceDeltaFen).toMatch(/^(?:0|[1-9][0-9]*)$/);
    }
  });

  it("移动：上移/下移（键盘与拖拽同一函数）重排 sortOrder，越界不变", () => {
    const { config, sectionKey } = withSection();
    const a = addComponent(config, "FIELD", sectionKey);
    if (!a.ok) throw new Error("a failed");
    const b = addComponent(a.config, "NOTE", sectionKey);
    if (!b.ok) throw new Error("b failed");

    const moved = moveComponent(b.config, b.stableKey, "up");
    expect(moved.components.map((c) => c.stableKey)).toEqual([
      b.stableKey,
      a.stableKey,
    ]);
    expect(moved.components.map((c) => c.sortOrder)).toEqual([0, 1]);

    const atBoundary = moveComponent(moved, b.stableKey, "up");
    expect(atBoundary.components.map((c) => c.stableKey)).toEqual([
      b.stableKey,
      a.stableKey,
    ]);

    const withSecond = addSection(moved, { label: "备注", columns: 1 });
    if (!withSecond.ok) throw new Error("second section failed");
    const reorderedSections = moveSection(
      withSecond.config,
      withSecond.stableKey,
      "up",
    );
    expect(reorderedSections.sections.map((s) => s.label)).toEqual([
      "备注",
      "下单信息",
    ]);
    const boundary = moveSection(reorderedSections, withSecond.stableKey, "up");
    expect(boundary.sections.map((s) => s.label)).toEqual(["备注", "下单信息"]);
  });

  it("可重复表格：增删列、增删默认行；默认行按列类型补合法值", () => {
    const { config, sectionKey } = withSection();
    const preset = insertPreset(config, sectionKey, "STAFFING_TABLE");
    if (!preset.ok) throw new Error("preset failed");
    const table = preset.config.components[0];
    if (table?.kind !== "REPEATABLE_TABLE") throw new Error("not a table");

    const withColumn = addTableColumn(preset.config, table.stableKey);
    if (!withColumn.ok) throw new Error("addTableColumn failed");
    const updated = withColumn.config.components[0];
    if (updated?.kind !== "REPEATABLE_TABLE") throw new Error("not a table");
    expect(updated.columns).toHaveLength(table.columns.length + 1);

    const withRow = addDefaultRow(withColumn.config, table.stableKey);
    if (!withRow.ok) throw new Error("addDefaultRow failed");
    const rows = (
      withRow.config.components[0] as {
        defaultRows: Array<Record<string, unknown>>;
      }
    ).defaultRows;
    const row = rows[rows.length - 1];
    expect(row).toBeTruthy();
    for (const column of updated.columns) {
      expect(row).toHaveProperty(column.stableKey);
    }

    const beforeRemove = rows.length;
    const withoutRow = removeDefaultRow(withRow.config, table.stableKey, 0);
    expect(
      (withoutRow.components[0] as { defaultRows: unknown[] }).defaultRows,
    ).toHaveLength(beforeRemove - 1);

    const removedColumn = removeTableColumn(
      withColumn.config,
      table.stableKey,
      updated.columns[updated.columns.length - 1]!.stableKey,
    );
    expect(removedColumn.ok).toBe(true);

    const countColumn = table.columns.find(
      (column) => column.semanticRole === "STAFFING_COUNT",
    );
    const guard = guardRemoveTableColumn(
      preset.config,
      table.stableKey,
      countColumn!.stableKey,
    );
    expect(guard.ok).toBe(false);
  });

  it("脏检查：忽略键序差异；真实改动为脏；未加载草稿时视为脏", () => {
    const { config, sectionKey } = withSection();
    const added = addComponent(config, "NOTE", sectionKey);
    if (!added.ok) throw new Error("addComponent failed");

    const reordered: DraftConfigV2 = {
      components: added.config.components,
      sections: added.config.sections,
      staffingSource: added.config.staffingSource,
      schemaVersion: 2,
    };
    expect(isDirty(added.config, reordered)).toBe(false);
    expect(isDirty(added.config, config)).toBe(true);
    expect(isDirty(null, added.config)).toBe(true);
  });
});
describe("template-draft-state：字段类型与选项（领域规则）", () => {
  it("切到选择类型自动补一个合法选项；切回文本类型会移除选项", () => {
    const { config, sectionKey } = withSection();
    const added = addComponent(config, "FIELD", sectionKey);
    if (!added.ok) throw new Error("addComponent failed");

    const asSelect = updateComponent(added.config, added.stableKey, {
      fieldType: "SINGLE_SELECT",
    });
    const selectField = asSelect.components[0];
    if (selectField?.kind !== "FIELD") throw new Error("not a field");
    expect(selectField.options?.length).toBeGreaterThan(0);

    const asText = updateComponent(asSelect, added.stableKey, {
      fieldType: "TEXT",
    });
    const textField = asText.components[0];
    if (textField?.kind !== "FIELD") throw new Error("not a field");
    expect(textField.options).toBeUndefined();
  });

  it("多选字段自动补聚合策略；切回单选后移除聚合策略", () => {
    const { config, sectionKey } = withSection();
    const added = addComponent(config, "FIELD", sectionKey);
    if (!added.ok) throw new Error("addComponent failed");

    const multi = updateComponent(added.config, added.stableKey, {
      fieldType: "MULTI_SELECT",
    });
    const multiField = multi.components[0];
    if (multiField?.kind !== "FIELD") throw new Error("not a field");
    expect(multiField.aggregationPolicy).toBe("SUM");

    const single = updateComponent(multi, added.stableKey, {
      fieldType: "SINGLE_SELECT",
    });
    const singleField = single.components[0];
    if (singleField?.kind !== "FIELD") throw new Error("not a field");
    expect(singleField.aggregationPolicy).toBeUndefined();
  });

  it("选项可整体覆盖；默认行单元格可逐格修改", () => {
    const { config, sectionKey } = withSection();
    const preset = insertPreset(config, sectionKey, "STAFFING_TABLE");
    if (!preset.ok) throw new Error("preset failed");
    const table = preset.config.components[0];
    if (table?.kind !== "REPEATABLE_TABLE") throw new Error("not a table");

    const withRow = addDefaultRow(preset.config, table.stableKey);
    if (!withRow.ok) throw new Error("addDefaultRow failed");
    const countColumn = table.columns.find(
      (column) => column.semanticRole === "STAFFING_COUNT",
    )!;
    const rows = (
      withRow.config.components[0] as {
        defaultRows: Array<Record<string, unknown>>;
      }
    ).defaultRows;
    const edited = setDefaultRowValue(
      withRow.config,
      table.stableKey,
      rows.length - 1,
      countColumn.stableKey,
      3,
    );
    const editedRows = (
      edited.components[0] as {
        defaultRows: Array<Record<string, unknown>>;
      }
    ).defaultRows;
    expect(editedRows[editedRows.length - 1]?.[countColumn.stableKey]).toBe(3);

    const field = addComponent(edited, "FIELD", sectionKey);
    if (!field.ok) throw new Error("field failed");
    // 文本字段：setter 必须忽略（不允许产出带选项的非选择字段）
    const ignored = setComponentOptions(field.config, field.stableKey, [
      { value: "a", label: "甲", priceDeltaFen: "500" },
    ]);
    expect(ignored).toEqual(field.config);

    // 选择字段：选项被整体覆盖
    const asSelect = updateComponent(field.config, field.stableKey, {
      fieldType: "SINGLE_SELECT",
    });
    const withOptions = setComponentOptions(asSelect, field.stableKey, [
      { value: "a", label: "甲", priceDeltaFen: "500" },
    ]);
    const selectField = withOptions.components.find(
      (component) => component.stableKey === field.stableKey,
    );
    if (selectField?.kind !== "FIELD") throw new Error("not a field");
    expect(selectField.options).toEqual([
      { value: "a", label: "甲", priceDeltaFen: "500" },
    ]);
  });

  it("表格列类型切换：非单选列移除选项，单选列自动补选项", () => {
    const { config, sectionKey } = withSection();
    const preset = insertPreset(config, sectionKey, "STAFFING_TABLE");
    if (!preset.ok) throw new Error("preset failed");
    const table = preset.config.components[0];
    if (table?.kind !== "REPEATABLE_TABLE") throw new Error("not a table");
    const labelColumn = table.columns.find(
      (column) => column.semanticRole === "STAFFING_LABEL",
    )!;

    const asSelect = updateTableColumn(
      preset.config,
      table.stableKey,
      labelColumn.stableKey,
      {
        columnType: "SINGLE_SELECT",
      },
    );
    const selectColumn = (
      asSelect.components[0] as {
        columns: Array<{ stableKey: string; options?: unknown[] }>;
      }
    ).columns.find((column) => column.stableKey === labelColumn.stableKey);
    expect(selectColumn?.options?.length).toBeGreaterThan(0);

    const backToText = updateTableColumn(
      asSelect,
      table.stableKey,
      labelColumn.stableKey,
      {
        columnType: "TEXT",
      },
    );
    const textColumn = (
      backToText.components[0] as {
        columns: Array<{ stableKey: string; options?: unknown[] }>;
      }
    ).columns.find((column) => column.stableKey === labelColumn.stableKey);
    expect(textColumn?.options).toBeUndefined();
  });
});
describe("镜像类型与 S2 契约的一致性（编译期 + 运行期）", () => {
  it("编辑器模型可以原样交给契约类型（保存草稿时的边界转换）", () => {
    const { config, sectionKey } = withSection();
    const added = addComponent(config, "FIELD", sectionKey);
    if (!added.ok) throw new Error("addComponent failed");
    const preset = insertPreset(added.config, sectionKey, "STAFFING_TABLE");
    if (!preset.ok) throw new Error("preset failed");

    // 编译期：DraftConfigV2（字面量判别）必须能赋给契约类型
    const contract: TemplateDraftConfig = toContractConfig(preset.config);
    // 运行期：结构一致，不做任何字段改名
    expect(JSON.parse(JSON.stringify(contract))).toEqual(
      JSON.parse(JSON.stringify(preset.config)),
    );
  });
});

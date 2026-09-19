import { describe, expect, it } from "vitest";
import {
  reorderComponent,
  updateComponent,
  type DraftConfigV2,
  type DraftFieldComponentV2,
  type DraftNoteComponentV2,
} from "./template-draft-state";
/**
 * 组件补丁字段的覆盖测试。
 *
 * 设计规格 v0.2 需要「占位提示」可编辑，而 updateComponent 的补丁类型原先不含
 * placeholder；这里锁定新增字段的行为：只作用于 FIELD、超长截断、不改原对象。
 */
function field(
  patch: Partial<DraftFieldComponentV2> = {},
): DraftFieldComponentV2 {
  return {
    kind: "FIELD",
    stableKey: "f1",
    sectionKey: "s1",
    label: "时长",
    enabled: true,
    sortOrder: 0,
    layout: { colSpan: 1, rowBreakBefore: false },
    fieldType: "NUMBER",
    semanticRole: "CUSTOM",
    required: false,
    ...patch,
  };
}
function note(): DraftNoteComponentV2 {
  return {
    kind: "NOTE",
    stableKey: "n1",
    sectionKey: "s1",
    label: "",
    enabled: true,
    sortOrder: 1,
    layout: { colSpan: 2, rowBreakBefore: false },
    text: "下单须知",
  };
}
function baseConfig(components: DraftConfigV2["components"]): DraftConfigV2 {
  return {
    schemaVersion: 2,
    sections: [
      {
        stableKey: "s1",
        label: "基本信息",
        enabled: true,
        sortOrder: 0,
        layout: { columns: 2 },
      },
    ],
    components,
    staffingSource: { kind: "FIXED", count: 1 },
  };
}
describe("updateComponent：placeholder 补丁", () => {
  it("可以给字段设置占位提示", () => {
    const config = baseConfig([field()]);
    const next = updateComponent(config, "f1", { placeholder: "例如 120" });
    const target = next.components[0];
    expect(target?.kind).toBe("FIELD");
    expect(target?.kind === "FIELD" ? target.placeholder : null).toBe(
      "例如 120",
    );
  });
  it("占位提示超过 200 字会被截断", () => {
    const config = baseConfig([field()]);
    const next = updateComponent(config, "f1", {
      placeholder: "字".repeat(260),
    });
    const target = next.components[0];
    expect(target?.kind === "FIELD" ? target.placeholder?.length : -1).toBe(
      200,
    );
  });
  it("不改动原配置对象", () => {
    const config = baseConfig([field()]);
    updateComponent(config, "f1", { placeholder: "例如 120" });
    expect(
      config.components[0]?.kind === "FIELD"
        ? config.components[0].placeholder
        : undefined,
    ).toBeUndefined();
  });
  it("说明组件不会被塞进 placeholder", () => {
    const config = baseConfig([note()]);
    const next = updateComponent(config, "n1", { placeholder: "不该出现" });
    const target = next.components[0];
    expect(target !== undefined && "placeholder" in target).toBe(false);
  });
});
function orders(config: DraftConfigV2, sectionKey: string): string[] {
  return config.components
    .filter((component) => component.sectionKey === sectionKey)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((component) => component.stableKey);
}
function twoSections(): DraftConfigV2 {
  return {
    schemaVersion: 2,
    sections: [
      {
        stableKey: "s1",
        label: "第一组",
        enabled: true,
        sortOrder: 0,
        layout: { columns: 2 },
      },
      {
        stableKey: "s2",
        label: "第二组",
        enabled: true,
        sortOrder: 1,
        layout: { columns: 2 },
      },
    ],
    components: [
      field({ stableKey: "a", sectionKey: "s1", sortOrder: 0 }),
      field({ stableKey: "b", sectionKey: "s1", sortOrder: 1 }),
      field({ stableKey: "c", sectionKey: "s1", sortOrder: 2 }),
      field({ stableKey: "x", sectionKey: "s2", sortOrder: 0 }),
    ],
    staffingSource: { kind: "FIXED", count: 1 },
  };
}
describe("reorderComponent：拖拽排序", () => {
  it("同组内拖到目标之前", () => {
    const next = reorderComponent(twoSections(), "c", "a", "before");
    expect(orders(next, "s1")).toEqual(["c", "a", "b"]);
  });
  it("同组内拖到目标之后", () => {
    const next = reorderComponent(twoSections(), "a", "c", "after");
    expect(orders(next, "s1")).toEqual(["b", "c", "a"]);
  });
  it("跨组拖动会改分组并按新位置重排序号", () => {
    const next = reorderComponent(twoSections(), "a", "x", "before");
    expect(orders(next, "s1")).toEqual(["b", "c"]);
    expect(orders(next, "s2")).toEqual(["a", "x"]);
    const moved = next.components.find((item) => item.stableKey === "a");
    expect(moved?.sectionKey).toBe("s2");
  });
  it("拖到自己身上原样返回", () => {
    const config = twoSections();
    expect(reorderComponent(config, "a", "a", "before")).toBe(config);
  });
  it("未知组件原样返回", () => {
    const config = twoSections();
    expect(reorderComponent(config, "missing", "a", "before")).toBe(config);
    expect(reorderComponent(config, "a", "missing", "before")).toBe(config);
  });
});

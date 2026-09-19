import { describe, expect, it } from "vitest";
import {
  columnSpanLabel,
  layoutV2Rows,
  type LayoutV2ComponentLike,
  type LayoutV2SectionLike,
} from "./form-layout";

function section(
  stableKey: string,
  columns: number,
  sortOrder = 0,
): LayoutV2SectionLike {
  return { stableKey, enabled: true, sortOrder, layout: { columns } };
}

function component(
  stableKey: string,
  sectionKey: string,
  overrides: Partial<LayoutV2ComponentLike> = {},
): LayoutV2ComponentLike {
  return {
    stableKey,
    sectionKey,
    enabled: true,
    sortOrder: 0,
    layout: { colSpan: 1, rowBreakBefore: false },
    ...overrides,
  };
}

describe("form-layout v2：区块列数装箱", () => {
  it("2 列区块：两个半宽同行，第三个回落到新行", () => {
    const rows = layoutV2Rows(
      [section("base", 2)],
      [
        component("a", "base", { sortOrder: 0 }),
        component("b", "base", { sortOrder: 1 }),
        component("c", "base", { sortOrder: 2 }),
      ],
    );
    expect(
      rows[0]?.rows.map((row) => row.components.map((c) => c.stableKey)),
    ).toEqual([["a", "b"], ["c"]]);
    expect(rows[0]?.rows.map((row) => row.widthUsed)).toEqual([2, 1]);
  });

  it("整行组件自带换行；rowBreakBefore 强制新行", () => {
    const rows = layoutV2Rows(
      [section("base", 3)],
      [
        component("a", "base", { sortOrder: 0 }),
        component("table", "base", {
          sortOrder: 1,
          layout: { colSpan: 3, rowBreakBefore: false },
        }),
        component("note", "base", {
          sortOrder: 2,
          layout: { colSpan: 1, rowBreakBefore: true },
        }),
      ],
    );
    expect(
      rows[0]?.rows.map((row) => row.components.map((c) => c.stableKey)),
    ).toEqual([["a"], ["table"], ["note"]]);
  });

  it("colSpan 超过区块列数时收敛到列数（不产生越界行）", () => {
    const rows = layoutV2Rows(
      [section("base", 2)],
      [
        component("wide", "base", {
          layout: { colSpan: 4, rowBreakBefore: false },
        }),
      ],
    );
    expect(rows[0]?.rows[0]?.widthUsed).toBe(2);
  });

  it("默认跳过停用组件；includeDisabled 时保留并按顺序参与装箱", () => {
    const components = [
      component("a", "base", { sortOrder: 0 }),
      component("b", "base", { sortOrder: 1, enabled: false }),
    ];
    const preview = layoutV2Rows([section("base", 2)], components);
    expect(preview[0]?.rows[0]?.components.map((c) => c.stableKey)).toEqual([
      "a",
    ]);

    const editor = layoutV2Rows([section("base", 2)], components, {
      includeDisabled: true,
    });
    expect(editor[0]?.rows[0]?.components.map((c) => c.stableKey)).toEqual([
      "a",
      "b",
    ]);
  });

  it("区块按 sortOrder 输出，组件只落在自己的区块", () => {
    const rows = layoutV2Rows(
      [section("second", 1, 1), section("first", 1, 0)],
      [
        component("a", "first", { sortOrder: 0 }),
        component("b", "second", { sortOrder: 0 }),
      ],
    );
    expect(rows.map((row) => row.section.stableKey)).toEqual([
      "first",
      "second",
    ]);
    expect(rows[0]?.rows[0]?.components.map((c) => c.stableKey)).toEqual(["a"]);
  });

  it("列宽标签按真实列数计算", () => {
    expect(columnSpanLabel(2, 2)).toBe("整行");
    expect(columnSpanLabel(2, 1)).toBe("半宽");
    expect(columnSpanLabel(3, 3)).toBe("整行");
    expect(columnSpanLabel(3, 1)).toBe("1/3");
    expect(columnSpanLabel(4, 2)).toBe("2/4");
    expect(columnSpanLabel(2, 9)).toBe("整行");
  });
});

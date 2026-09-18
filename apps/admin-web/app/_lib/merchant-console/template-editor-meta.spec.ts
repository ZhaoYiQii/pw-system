import { describe, expect, it } from "vitest";
import type {
  DraftConfigV2,
  DraftFieldComponentV2,
  DraftNoteComponentV2,
  DraftTableComponentV2,
} from "./template-draft-state";
import {
  BINDING_OPTIONS,
  COMPONENT_KIND_LABELS,
  FIELD_TYPE_LABELS,
  TABLE_COLUMN_TYPE_LABELS,
  bindingOwner,
  componentSummary,
  fenToYuanInput,
  issueCountByComponent,
  yuanToFenString,
} from "./template-editor-meta";
function field(
  stableKey: string,
  patch: Partial<DraftFieldComponentV2> = {},
): DraftFieldComponentV2 {
  return {
    kind: "FIELD",
    stableKey,
    sectionKey: "s1",
    label: "字段",
    enabled: true,
    sortOrder: 0,
    layout: { colSpan: 1, rowBreakBefore: false },
    fieldType: "TEXT",
    semanticRole: "CUSTOM",
    required: false,
    ...patch,
  };
}
function table(stableKey: string, label = "表格"): DraftTableComponentV2 {
  return {
    kind: "REPEATABLE_TABLE",
    stableKey,
    sectionKey: "s1",
    label,
    enabled: true,
    sortOrder: 1,
    layout: { colSpan: 2, rowBreakBefore: false },
    columns: [
      {
        stableKey: "c1",
        label: "岗位",
        columnType: "TEXT",
        semanticRole: "CUSTOM",
        required: true,
      },
      {
        stableKey: "c2",
        label: "人数",
        columnType: "NUMBER",
        semanticRole: "CUSTOM",
        required: true,
      },
      {
        stableKey: "c3",
        label: "单价",
        columnType: "NUMBER",
        semanticRole: "CUSTOM",
        required: false,
      },
    ],
    defaultRows: [{}],
  };
}
function note(stableKey: string, text: string): DraftNoteComponentV2 {
  return {
    kind: "NOTE",
    stableKey,
    sectionKey: "s1",
    label: "",
    enabled: true,
    sortOrder: 2,
    layout: { colSpan: 2, rowBreakBefore: false },
    text,
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
describe("template-editor-meta：标签表", () => {
  it("覆盖全部字段类型与表格列类型，且都是白话", () => {
    expect(FIELD_TYPE_LABELS.TEXT).toBe("单行文本");
    expect(FIELD_TYPE_LABELS.MONEY_FEN).toBe("金额");
    expect(FIELD_TYPE_LABELS.SINGLE_SELECT).toBe("单选");
    expect(TABLE_COLUMN_TYPE_LABELS.SINGLE_SELECT).toBe("单选");
    expect(COMPONENT_KIND_LABELS.FIELD).toBe("字段");
    expect(COMPONENT_KIND_LABELS.REPEATABLE_TABLE).toBe("表格");
    expect(COMPONENT_KIND_LABELS.NOTE).toBe("说明");
  });
  it("算价绑定只有三个中性取值，不含任何预置字段名", () => {
    expect(BINDING_OPTIONS.map((option) => option.label)).toEqual([
      "不用",
      "人数",
      "时长",
    ]);
    expect(BINDING_OPTIONS.map((option) => option.role)).toEqual([
      null,
      "STAFFING_COUNT",
      "DURATION_MINUTES",
    ]);
  });
});
describe("template-editor-meta：属性摘要", () => {
  it("单选字段摘要包含选项数与加价项数", () => {
    const config = baseConfig([
      field("f1", {
        fieldType: "SINGLE_SELECT",
        options: [
          { value: "a", label: "黄金" },
          { value: "b", label: "铂金", priceDeltaFen: "2000" },
          { value: "c", label: "钻石" },
        ],
      }),
    ]);
    expect(componentSummary(config, "f1")).toBe("单选 · 3 个选项 · 1 项加价");
  });
  it("没有加价的单选只报选项数", () => {
    const config = baseConfig([
      field("f1", {
        fieldType: "SINGLE_SELECT",
        options: [
          { value: "a", label: "电信一区" },
          { value: "b", label: "网通一区" },
        ],
      }),
    ]);
    expect(componentSummary(config, "f1")).toBe("单选 · 2 个选项");
  });
  it("普通文本字段只报类型", () => {
    const config = baseConfig([field("f1", { fieldType: "TEXTAREA" })]);
    expect(componentSummary(config, "f1")).toBe("多行文本");
  });
  it("表格摘要报列数与默认行数", () => {
    const config = baseConfig([table("t1")]);
    expect(componentSummary(config, "t1")).toBe("3 列 · 默认 1 行");
  });
  it("说明超过 18 字时截断并加省略号", () => {
    const config = baseConfig([note("n1", "abcdefghijklmnopqrstuvwxyz")]);
    expect(componentSummary(config, "n1")).toBe("abcdefghijklmnopqr…");
  });
  it("说明不超过 18 字时原样返回", () => {
    const config = baseConfig([note("n1", "下单后客服会确认")]);
    expect(componentSummary(config, "n1")).toBe("下单后客服会确认");
  });
  it("找不到组件时返回空串", () => {
    expect(componentSummary(baseConfig([]), "missing")).toBe("");
  });
});
describe("template-editor-meta：按组件统计问题", () => {
  it("只统计带 componentKey 的问题，区块级问题不计入组件", () => {
    const config = baseConfig([
      field("f1", { fieldType: "SINGLE_SELECT", options: [] }),
    ]);
    config.staffingSource = { kind: "FIXED", count: 0 };
    const counts = issueCountByComponent(config);
    expect(counts.get("f1")).toBe(1);
    expect(counts.size).toBe(1);
  });
  it("同一组件多个问题时累加", () => {
    const config = baseConfig([
      field("f1", { fieldType: "MULTI_SELECT", options: [] }),
    ]);
    expect(issueCountByComponent(config).get("f1")).toBe(2);
  });
  it("没有问题时返回空表", () => {
    const config = baseConfig([
      field("f1", {
        fieldType: "SINGLE_SELECT",
        options: [{ value: "a", label: "黄金" }],
      }),
    ]);
    expect(issueCountByComponent(config).size).toBe(0);
  });
});
describe("template-editor-meta：算价占用判定", () => {
  it("返回占用者名称，并排除自己", () => {
    const config = baseConfig([
      field("f1", { label: "人数", semanticRole: "STAFFING_COUNT" }),
    ]);
    expect(bindingOwner(config, "STAFFING_COUNT", "other")).toBe("人数");
    expect(bindingOwner(config, "STAFFING_COUNT", "f1")).toBeNull();
  });
  it("停用组件不占用", () => {
    const config = baseConfig([
      field("f1", {
        label: "人数",
        semanticRole: "STAFFING_COUNT",
        enabled: false,
      }),
    ]);
    expect(bindingOwner(config, "STAFFING_COUNT", "other")).toBeNull();
  });
  it("表格列也能占用，占用者显示所属表格名", () => {
    const config = baseConfig([table("t1", "陪玩安排")]);
    const withRole: DraftConfigV2 = {
      ...config,
      components: [
        {
          ...table("t1", "陪玩安排"),
          columns: [
            {
              stableKey: "c1",
              label: "人数",
              columnType: "NUMBER",
              semanticRole: "STAFFING_COUNT",
              required: true,
            },
          ],
        },
      ],
    };
    expect(bindingOwner(withRole, "STAFFING_COUNT", "f1")).toBe("陪玩安排");
  });
  it("没有占用者时返回 null", () => {
    const config = baseConfig([field("f1")]);
    expect(bindingOwner(config, "DURATION_MINUTES", "f1")).toBeNull();
  });
});

describe("template-editor-meta：元分转换（不经过浮点）", () => {
  it("整元与角分都能正确转成分", () => {
    expect(yuanToFenString("20")).toEqual({ ok: true, fen: "2000" });
    expect(yuanToFenString("20.5")).toEqual({ ok: true, fen: "2050" });
    expect(yuanToFenString("0.05")).toEqual({ ok: true, fen: "5" });
  });
  it("空字符串表示不加价，非法输入被拒绝", () => {
    expect(yuanToFenString("")).toEqual({ ok: true });
    expect(yuanToFenString("1.234").ok).toBe(false);
    expect(yuanToFenString("abc").ok).toBe(false);
    expect(yuanToFenString("-1").ok).toBe(false);
  });
  it("分转回显示值时保留两位", () => {
    expect(fenToYuanInput("2000")).toBe("20");
    expect(fenToYuanInput("2050")).toBe("20.50");
    expect(fenToYuanInput("5")).toBe("0.05");
    expect(fenToYuanInput(undefined)).toBe("");
  });
});

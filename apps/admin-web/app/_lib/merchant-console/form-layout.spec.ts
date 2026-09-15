import { describe, expect, it } from "vitest";
import {
  activeFormFields,
  clampColumns,
  DEFAULT_POSITION_LABEL,
  DEFAULT_FORM_COLUMNS,
  DEFAULT_SECTION_STYLE,
  dispatchLines,
  fieldSpan,
  formSectionStyle,
  formSections,
  fieldsForSection,
  isFormField,
  layoutFormRows,
  moveFieldWithinSection,
} from "./form-layout";

const text = (fieldKey: string) => ({ fieldKey, fieldType: "text" });
const wide = (fieldKey: string) => ({ fieldKey, fieldType: "multiline" });

function shape<T>(rows: Array<Array<{ field: T; span: number }>>) {
  return rows.map((row) => row.map((slot) => slot.span));
}

describe("派单表单 2×N 布局", () => {
  it("默认每行两个字段，行数随字段数量增长", () => {
    const rows = layoutFormRows([
      text("a"),
      text("b"),
      text("c"),
      text("d"),
      text("e"),
    ]);
    expect(DEFAULT_FORM_COLUMNS).toBe(2);
    expect(shape(rows)).toEqual([[1, 1], [1, 1], [1]]);
    expect(rows.flat().map((slot) => slot.field.fieldKey)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
  });

  it("多行文本与说明文字独占整行，剩余列不够时先换行", () => {
    const rows = layoutFormRows([text("a"), wide("remark"), text("b")]);
    expect(shape(rows)).toEqual([[1], [2], [1]]);
    expect(rows[1]![0]!.field.fieldKey).toBe("remark");
  });

  it("整行字段正好落在行首时不产生空行", () => {
    const rows = layoutFormRows([text("a"), text("b"), wide("remark")]);
    expect(shape(rows)).toEqual([[1, 1], [2]]);
  });

  it("单列模式下行数等于字段数", () => {
    const rows = layoutFormRows([text("a"), text("b"), text("c")], 1);
    expect(shape(rows)).toEqual([[1], [1], [1]]);
  });

  it("列数被夹在 1..4 之间，非法值回退默认", () => {
    expect(clampColumns(0)).toBe(1);
    expect(clampColumns(9)).toBe(4);
    expect(clampColumns(Number.NaN)).toBe(DEFAULT_FORM_COLUMNS);
    expect(
      layoutFormRows([text("a"), text("b"), text("c")], 3)[0],
    ).toHaveLength(3);
  });

  it("span 不超过列数，宽字段在单列下仍是一列", () => {
    expect(fieldSpan(wide("x"), 1)).toBe(1);
    expect(fieldSpan(text("x"), 4)).toBe(1);
  });

  it("尊重自定义跨列与另起一行", () => {
    const rows = layoutFormRows(
      [
        { ...text("a"), colSpan: 2 },
        text("b"),
        { ...text("c"), rowBreakBefore: true },
        { ...text("d"), colSpan: 2 },
      ],
      3,
    );
    expect(shape(rows)).toEqual([
      [2, 1],
      [1, 2],
    ]);
  });

  it("时长字段不进入下单表单", () => {
    expect(isFormField({ fieldKey: "d", fieldType: "duration" })).toBe(false);
    expect(isFormField(text("a"))).toBe(true);
  });

  it("只返回启用区块中的可填写字段", () => {
    const sections = [
      { id: "hidden", enabled: false, sortOrder: 0 },
      { id: "visible", enabled: true, sortOrder: 1 },
    ];
    const fields = [
      { ...text("hidden_required"), sectionId: "hidden", required: true },
      { ...text("disabled"), sectionId: "visible", enabled: false },
      { fieldKey: "help", fieldType: "note", sectionId: "visible" },
      { ...text("name"), sectionId: "visible", required: true },
    ];

    expect(
      activeFormFields(sections, fields).map((field) => field.fieldKey),
    ).toEqual(["name"]);
  });

  it("预览与创建页共享相同的启用区块和可见字段", () => {
    const sections = [
      {
        id: "later",
        name: "陪玩要求",
        columns: 2,
        enabled: true,
        sortOrder: 2,
      },
      { id: "off", name: "停用区块", columns: 2, enabled: false, sortOrder: 1 },
      {
        id: "first",
        name: "需求信息",
        columns: 3,
        enabled: true,
        sortOrder: 0,
      },
    ];
    const fields = [
      { ...text("hidden"), sectionId: "off" },
      { ...text("game"), sectionId: "first" },
      { fieldKey: "help", fieldType: "note", sectionId: "first" },
      { ...text("disabled"), sectionId: "first", enabled: false },
    ];

    const visibleSections = formSections(sections);
    expect(visibleSections.map((section) => section.id)).toEqual([
      "first",
      "later",
    ]);
    expect(
      fieldsForSection(visibleSections[0]!, visibleSections, fields).map(
        (field) => field.fieldKey,
      ),
    ).toEqual(["game", "help"]);
  });

  it("字段只在所属区块内移动", () => {
    const fields = [
      { fieldKey: "a1", sectionKey: "a" },
      { fieldKey: "b1", sectionKey: "b" },
      { fieldKey: "a2", sectionKey: "a" },
    ];

    expect(
      moveFieldWithinSection(fields, 2, -1).map((field) => field.fieldKey),
    ).toEqual(["a2", "b1", "a1"]);
    expect(moveFieldWithinSection(fields, 0, -1)).toBe(fields);
  });

  it("没有配置岗位席位时兜底一个通用位置行", () => {
    expect(dispatchLines([])).toEqual([
      { positionLabel: DEFAULT_POSITION_LABEL, requiredCount: 1 },
    ]);
  });

  it("配置了岗位时按人数生成位置行，且人数至少为 1", () => {
    const positions = [
      { id: "p1", label: "主力", defaultCount: 2 },
      { id: "p2", label: "辅助", defaultCount: 1 },
    ];
    expect(dispatchLines(positions, { p1: 3 })).toEqual([
      { positionLabel: "主力", requiredCount: 3 },
      { positionLabel: "辅助", requiredCount: 1 },
    ]);
    expect(dispatchLines(positions, { p1: 0 })[0]!.requiredCount).toBe(1);
  });

  it("区块样式缺省为卡片/宽松/左对齐，非法值回退缺省", () => {
    expect(formSectionStyle(undefined, "需求信息")).toEqual(
      DEFAULT_SECTION_STYLE,
    );
    expect(
      formSectionStyle(
        { sections: { 需求信息: { variant: "怪样式" } } },
        "需求信息",
      ),
    ).toEqual(DEFAULT_SECTION_STYLE);
  });

  it("区块样式按名称读取并可独立设置", () => {
    const labels = {
      sections: {
        需求信息: { variant: "plain", density: "compact", align: "center" },
      },
    };
    expect(formSectionStyle(labels, "需求信息")).toEqual({
      variant: "plain",
      density: "compact",
      align: "center",
    });
    expect(formSectionStyle(labels, "陪玩要求")).toEqual(DEFAULT_SECTION_STYLE);
  });
});

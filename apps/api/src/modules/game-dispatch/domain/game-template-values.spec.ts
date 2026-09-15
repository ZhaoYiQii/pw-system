import { describe, expect, it } from "vitest";
import {
  activeTemplateFields,
  activeTemplateValues,
  templateFormValueError,
} from "./game-template-values.js";

const sections = [
  { id: "off", enabled: false, sortOrder: 0 },
  { id: "on", enabled: true, sortOrder: 1 },
];

const fields = [
  {
    fieldKey: "hidden",
    label: "隐藏必填项",
    fieldType: "text",
    required: true,
    enabled: true,
    sectionId: "off",
    options: [],
  },
  {
    fieldKey: "rank",
    label: "目标段位",
    fieldType: "select",
    required: true,
    enabled: true,
    sectionId: "on",
    options: ["黄金", "王者"],
  },
  {
    fieldKey: "legacy_off",
    label: "停用字段",
    fieldType: "text",
    required: true,
    enabled: false,
    sectionId: "on",
    options: [],
  },
];

describe("派单模板有效字段与服务端值校验", () => {
  it("停用区块和停用字段不参与创建派单", () => {
    expect(
      activeTemplateFields(sections, fields).map((field) => field.fieldKey),
    ).toEqual(["rank"]);
  });

  it("启用的必填字段缺失时返回字段错误", () => {
    expect(
      templateFormValueError(activeTemplateFields(sections, fields), {}),
    ).toBe("请填写目标段位");
  });

  it("下拉值必须来自模板选项", () => {
    expect(
      templateFormValueError(activeTemplateFields(sections, fields), {
        rank: "不存在的段位",
      }),
    ).toBe("目标段位的值不在模板选项中");
    expect(
      templateFormValueError(activeTemplateFields(sections, fields), {
        rank: "王者",
      }),
    ).toBeNull();
  });

  it("只保留启用字段的值，忽略停用字段和未知键", () => {
    const activeFields = activeTemplateFields(sections, fields);
    expect(
      activeTemplateValues(activeFields, {
        rank: "王者",
        hidden: "不应写入",
        legacy_off: "不应写入",
        injected: "不应写入",
      }),
    ).toEqual({ rank: "王者" });
  });
});

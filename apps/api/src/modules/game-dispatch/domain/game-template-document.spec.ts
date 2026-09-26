import { describe, expect, it } from "vitest";
import type { PublishedConfigV2 } from "./game-template-config-v2.js";
import {
  renderDispatchDocument,
  TemplateDocumentError,
} from "./game-template-document.js";

function documentConfig(): PublishedConfigV2 {
  return {
    schemaVersion: 2,
    documentRendererVersion: 1,
    sections: [
      {
        stableKey: "details",
        label: "补充信息",
        enabled: true,
        sortOrder: 1,
        layout: { columns: 1 },
      },
      {
        stableKey: "basic",
        label: "基本信息",
        enabled: true,
        sortOrder: 0,
        layout: { columns: 2 },
      },
      {
        stableKey: "hidden",
        label: "隐藏区块",
        enabled: false,
        sortOrder: 2,
        layout: { columns: 1 },
      },
    ],
    components: [
      {
        kind: "FIELD",
        stableKey: "note",
        sectionKey: "details",
        label: "补充需求",
        enabled: true,
        sortOrder: 0,
        layout: { colSpan: 1, rowBreakBefore: false },
        fieldType: "TEXTAREA",
        semanticRole: "ORDER_NOTE",
        required: false,
      },
      {
        kind: "NOTE",
        stableKey: "reminder",
        sectionKey: "basic",
        label: "温馨提示",
        enabled: true,
        sortOrder: 1,
        layout: { colSpan: 2, rowBreakBefore: true },
        text: "请准时上线",
      },
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
        stableKey: "secret",
        sectionKey: "hidden",
        label: "隐藏内容",
        enabled: true,
        sortOrder: 0,
        layout: { colSpan: 1, rowBreakBefore: false },
        fieldType: "TEXT",
        semanticRole: "CUSTOM",
        required: false,
      },
    ],
    staffingSource: { kind: "FIXED", count: 1 },
  };
}

describe("通用模板自动文案", () => {
  it("按区块和组件顺序输出，跳过空值与禁用内容且不泄露内部键", () => {
    const document = renderDispatchDocument(documentConfig(), {
      mode: "ranked",
      note: "",
    });

    expect(document).toEqual({
      schemaVersion: 1,
      rendererVersion: 1,
      rows: [
        {
          sectionLabel: "基本信息",
          fieldLabel: "游戏模式",
          value: "排位",
        },
        {
          sectionLabel: "基本信息",
          fieldLabel: "温馨提示",
          value: "请准时上线",
        },
      ],
      plainText: "【基本信息】\n游戏模式：排位\n温馨提示：请准时上线",
    });
    expect(JSON.stringify(document)).not.toContain("mode");
    expect(JSON.stringify(document)).not.toContain("semanticRole");
  });

  it("必填字段缺失时返回带路径的结构化错误", () => {
    expect(() => renderDispatchDocument(documentConfig(), {})).toThrow(
      TemplateDocumentError,
    );
    try {
      renderDispatchDocument(documentConfig(), {});
    } catch (error) {
      expect(error).toMatchObject({
        code: "TEMPLATE_VALUE_INVALID",
        path: "$.values.mode",
      });
    }
    expect(() =>
      renderDispatchDocument(documentConfig(), {
        mode: "ranked",
        client_total: 99,
      }),
    ).toThrow(/未知字段/);
  });

  it("豁免语义角色（MODE）的库外值在文案里原样显示（ADR-0010 决定 4）", () => {
    const document = renderDispatchDocument(documentConfig(), {
      mode: "自定义模式",
    });

    expect(document.rows).toEqual([
      {
        sectionLabel: "基本信息",
        fieldLabel: "游戏模式",
        value: "自定义模式",
      },
      {
        sectionLabel: "基本信息",
        fieldLabel: "温馨提示",
        value: "请准时上线",
      },
    ]);
    expect(document.plainText).toContain("游戏模式：自定义模式");
  });

  it("逐行输出可重复表格，并格式化选择项、整数分和 ISO 时间", () => {
    const config = documentConfig();
    config.components = [
      {
        kind: "REPEATABLE_TABLE",
        stableKey: "staffing",
        sectionKey: "basic",
        label: "岗位",
        enabled: true,
        sortOrder: 0,
        layout: { colSpan: 2, rowBreakBefore: false },
        columns: [
          {
            stableKey: "role",
            label: "位置",
            columnType: "SINGLE_SELECT",
            semanticRole: "STAFFING_LABEL",
            required: true,
            options: [
              { value: "jungle", label: "打野" },
              { value: "support", label: "辅助" },
            ],
          },
          {
            stableKey: "count",
            label: "人数",
            columnType: "NUMBER",
            semanticRole: "STAFFING_COUNT",
            required: true,
          },
        ],
        defaultRows: [],
      },
      {
        kind: "FIELD",
        stableKey: "budget",
        sectionKey: "details",
        label: "预算",
        enabled: true,
        sortOrder: 0,
        layout: { colSpan: 1, rowBreakBefore: false },
        fieldType: "MONEY_FEN",
        semanticRole: "CUSTOM",
        required: true,
      },
      {
        kind: "FIELD",
        stableKey: "start_at",
        sectionKey: "details",
        label: "开始时间",
        enabled: true,
        sortOrder: 1,
        layout: { colSpan: 1, rowBreakBefore: false },
        fieldType: "DATETIME",
        semanticRole: "CUSTOM",
        required: true,
      },
    ];

    const document = renderDispatchDocument(config, {
      staffing: [
        { role: "jungle", count: 2 },
        { role: "support", count: 1 },
      ],
      budget: "12345",
      start_at: "2026-09-14T12:30:00+08:00",
    });

    expect(document.rows).toEqual([
      {
        sectionLabel: "基本信息",
        fieldLabel: "岗位[1] · 位置",
        value: "打野",
      },
      {
        sectionLabel: "基本信息",
        fieldLabel: "岗位[1] · 人数",
        value: "2",
      },
      {
        sectionLabel: "基本信息",
        fieldLabel: "岗位[2] · 位置",
        value: "辅助",
      },
      {
        sectionLabel: "基本信息",
        fieldLabel: "岗位[2] · 人数",
        value: "1",
      },
      {
        sectionLabel: "补充信息",
        fieldLabel: "预算",
        value: "12345 分",
      },
      {
        sectionLabel: "补充信息",
        fieldLabel: "开始时间",
        value: "2026-09-14T04:30:00.000Z",
      },
    ]);
    expect(() =>
      renderDispatchDocument(config, {
        staffing: [{ role: "jungle" }],
        budget: "12345",
        start_at: "2026-09-14T12:30:00+08:00",
      }),
    ).toThrow(/请填写岗位第 1 行的人数/);
    expect(() =>
      renderDispatchDocument(config, {
        staffing: [{ role: "jungle", count: 1, client_total: 99 }],
        budget: "12345",
        start_at: "2026-09-14T12:30:00+08:00",
      }),
    ).toThrow(/未知列/);
    expect(() =>
      renderDispatchDocument(config, {
        staffing: [{ role: "unknown", count: 1 }],
        budget: "12345",
        start_at: "2026-09-14T12:30:00+08:00",
      }),
    ).toThrow(expect.objectContaining({ path: "$.values.staffing[0].role" }));
    expect(() =>
      renderDispatchDocument(config, {
        staffing: [{ role: "jungle", count: 1 }],
        budget: "12345",
        start_at: "2026-09-14T12:30:00",
      }),
    ).toThrow(/时区/);
  });

  it("把不可信文本和未知旧组件作为受限纯文本并保持确定性", () => {
    const config = documentConfig();
    config.components = Array.from({ length: 11 }, (_, index) => ({
      kind: "FIELD" as const,
      stableKey: `text_${index}`,
      sectionKey: "basic",
      label: `文本 ${index + 1}`,
      enabled: true,
      sortOrder: index,
      layout: { colSpan: 1 as const, rowBreakBefore: false },
      fieldType: "TEXTAREA" as const,
      semanticRole: "CUSTOM" as const,
      required: true,
    }));
    config.components.push({
      kind: "LEGACY_WIDGET",
      stableKey: "legacy_widget",
      sectionKey: "basic",
      label: "旧组件",
      enabled: true,
      sortOrder: 20,
      layout: { colSpan: 1, rowBreakBefore: false },
    } as unknown as PublishedConfigV2["components"][number]);
    const values = Object.fromEntries(
      Array.from({ length: 11 }, (_, index) => [
        `text_${index}`,
        `${index === 0 ? "<script>alert(1)</script>\u0000\n\t" : ""}${"文".repeat(2_100)}`,
      ]),
    );

    const first = renderDispatchDocument(config, values);
    const second = renderDispatchDocument(config, values);
    expect(first).toEqual(second);
    expect(first.rows[0]?.value).toContain("<script>alert(1)</script>");
    expect(first.rows[0]?.value).not.toContain("\u0000");
    expect(first.rows[0]?.value).not.toMatch(/[\n\t]/);
    expect(first.rows[0]?.value).toMatch(/…\[已截断\]$/);
    expect(first.rows.at(-1)).toEqual({
      sectionLabel: "基本信息",
      fieldLabel: "旧组件",
      value: "[不支持的组件：LEGACY_WIDGET]",
    });
    expect(first.plainText.length).toBeLessThanOrEqual(20_000);
    expect(first.plainText).toMatch(/…\[已截断\]$/);
  });
});

import { describe, expect, it } from "vitest";
import type { DraftConfigV2 } from "./template-draft-state";
import {
  PreviewDocumentError,
  previewTemplateDocument,
  renderTemplateDocument,
} from "./template-document-preview";

/**
 * 这些配置与断言直接移植自服务端 game-template-document.spec.ts 的工作示例，
 * 用来证明前端预览与服务端文案规则一致（服务端仍是唯一事实源）。
 */
function documentConfig(): DraftConfigV2 {
  return {
    schemaVersion: 2,
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

describe("template-document-preview：与服务端一致的文案规则", () => {
  it("按区块与组件顺序输出，跳过空值与停用内容，且不泄露内部键", () => {
    const document = renderTemplateDocument(documentConfig(), {
      mode: "ranked",
      note: "",
    });

    expect(document.rows).toEqual([
      { sectionLabel: "基本信息", fieldLabel: "游戏模式", value: "排位" },
      { sectionLabel: "基本信息", fieldLabel: "温馨提示", value: "请准时上线" },
    ]);
    expect(document.plainText).toBe(
      "【基本信息】\n游戏模式：排位\n温馨提示：请准时上线",
    );
    expect(JSON.stringify(document)).not.toContain("semanticRole");
  });

  it("必填缺失与未知字段都会给出带路径的错误", () => {
    expect(() => renderTemplateDocument(documentConfig(), {})).toThrow(
      PreviewDocumentError,
    );
    try {
      renderTemplateDocument(documentConfig(), {});
    } catch (error) {
      expect(error).toMatchObject({
        code: "TEMPLATE_VALUE_INVALID",
        path: "$.values.mode",
      });
    }
    expect(() =>
      renderTemplateDocument(documentConfig(), {
        mode: "ranked",
        client_total: 99,
      }),
    ).toThrow(/未知字段/);
  });

  it("可重复表格逐行输出，金额显示为分、时间归一化为 UTC", () => {
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

    const document = renderTemplateDocument(config, {
      staffing: [
        { role: "jungle", count: 2 },
        { role: "support", count: 1 },
      ],
      budget: "12345",
      start_at: "2026-09-14T12:30:00+08:00",
    });

    expect(document.rows).toEqual([
      { sectionLabel: "基本信息", fieldLabel: "岗位[1] · 位置", value: "打野" },
      { sectionLabel: "基本信息", fieldLabel: "岗位[1] · 人数", value: "2" },
      { sectionLabel: "基本信息", fieldLabel: "岗位[2] · 位置", value: "辅助" },
      { sectionLabel: "基本信息", fieldLabel: "岗位[2] · 人数", value: "1" },
      { sectionLabel: "补充信息", fieldLabel: "预算", value: "12345 分" },
      {
        sectionLabel: "补充信息",
        fieldLabel: "开始时间",
        value: "2026-09-14T04:30:00.000Z",
      },
    ]);
    expect(() =>
      renderTemplateDocument(config, {
        staffing: [{ role: "unknown", count: 1 }],
        budget: "12345",
        start_at: "2026-09-14T12:30:00+08:00",
      }),
    ).toThrow(expect.objectContaining({ path: "$.values.staffing[0].role" }));
  });

  it("不可信文本按受限纯文本处理，未知旧组件给安全占位", () => {
    const config = documentConfig();
    config.components = [
      {
        kind: "FIELD",
        stableKey: "text_0",
        sectionKey: "basic",
        label: "文本 1",
        enabled: true,
        sortOrder: 0,
        layout: { colSpan: 1, rowBreakBefore: false },
        fieldType: "TEXTAREA",
        semanticRole: "CUSTOM",
        required: true,
      },
      {
        kind: "LEGACY_WIDGET",
        stableKey: "legacy_widget",
        sectionKey: "basic",
        label: "旧组件",
        enabled: true,
        sortOrder: 20,
        layout: { colSpan: 1, rowBreakBefore: false },
      } as unknown as DraftConfigV2["components"][number],
    ];
    const document = renderTemplateDocument(config, {
      text_0: `<script>alert(1)</script>\u0000\n\t${"文".repeat(2_100)}`,
    });

    expect(document.rows[0]?.value).toContain("<script>alert(1)</script>");
    expect(document.rows[0]?.value).not.toContain("\u0000");
    expect(document.rows[0]?.value).not.toMatch(/[\n\t]/);
    expect(document.rows[0]?.value).toMatch(/…\[已截断\]$/);
    expect(document.rows.at(-1)).toEqual({
      sectionLabel: "基本信息",
      fieldLabel: "旧组件",
      value: "[不支持的组件：LEGACY_WIDGET]",
    });
  });
});

describe("template-document-preview：草稿预览（无订单时）", () => {
  it("用示例值预览：选择字段显示选项名，表格用默认行，文本显示待填写", () => {
    const config: DraftConfigV2 = {
      schemaVersion: 2,
      sections: [
        {
          stableKey: "base",
          label: "下单信息",
          enabled: true,
          sortOrder: 0,
          layout: { columns: 2 },
        },
      ],
      components: [
        {
          kind: "FIELD",
          stableKey: "mode",
          sectionKey: "base",
          label: "游戏模式",
          enabled: true,
          sortOrder: 0,
          layout: { colSpan: 1, rowBreakBefore: false },
          fieldType: "SINGLE_SELECT",
          semanticRole: "MODE",
          required: true,
          options: [
            { value: "ranked", label: "排位", priceDeltaFen: "1000" },
            { value: "normal", label: "匹配" },
          ],
        },
        {
          kind: "FIELD",
          stableKey: "note",
          sectionKey: "base",
          label: "补充需求",
          enabled: true,
          sortOrder: 1,
          layout: { colSpan: 1, rowBreakBefore: false },
          fieldType: "TEXTAREA",
          semanticRole: "ORDER_NOTE",
          required: false,
        },
        {
          kind: "REPEATABLE_TABLE",
          stableKey: "staffing",
          sectionKey: "base",
          label: "岗位",
          enabled: true,
          sortOrder: 2,
          layout: { colSpan: 2, rowBreakBefore: true },
          columns: [
            {
              stableKey: "role",
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
          defaultRows: [{ role: "陪玩", count: 1 }],
        },
        {
          kind: "FIELD",
          stableKey: "hidden_field",
          sectionKey: "base",
          label: "停用字段",
          enabled: false,
          sortOrder: 3,
          layout: { colSpan: 1, rowBreakBefore: false },
          fieldType: "TEXT",
          semanticRole: "CUSTOM",
          required: false,
        },
      ],
      staffingSource: {
        kind: "REPEATABLE_TABLE_SUM",
        componentKey: "staffing",
        columnKey: "count",
      },
    };

    const preview = previewTemplateDocument(config);
    const labels = preview.rows.map((row) => row.fieldLabel);
    expect(labels).toEqual([
      "游戏模式",
      "补充需求",
      "岗位[1] · 位置",
      "岗位[1] · 人数",
    ]);
    // 文案值与服务端一致：只显示选项名；加价只作为编辑器 note，不进入文案
    expect(preview.rows[0]?.value).toBe("排位");
    expect(preview.rows[0]?.note).toContain("+1000 分");
    expect(preview.rows[1]?.value).toBe("（待填写）");
    expect(preview.rows[3]?.value).toBe("1");
    expect(labels).not.toContain("停用字段");
    expect(preview.plainText).toContain("【下单信息】");
  });

  it("空草稿给出可读的空预览而不是报错", () => {
    const preview = previewTemplateDocument({
      schemaVersion: 2,
      sections: [],
      components: [],
      staffingSource: { kind: "FIXED", count: 1 },
    });
    expect(preview.rows).toHaveLength(0);
    expect(preview.plainText).toBe("");
  });
});

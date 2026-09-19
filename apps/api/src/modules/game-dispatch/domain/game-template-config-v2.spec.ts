import { describe, expect, it } from "vitest";
import {
  validateDraftConfigV2,
  validatePublishedConfigV2,
} from "./game-template-config-v2.js";

function draftWithSectionCount(sectionCount: number): unknown {
  const sections = Array.from({ length: sectionCount }, (_, index) => ({
    stableKey: `section_${index}`,
    label: `区块 ${index + 1}`,
    enabled: true,
    sortOrder: index,
    layout: { columns: 1 },
  }));

  return {
    schemaVersion: 2,
    sections,
    components: sections.map((section, index) => ({
      kind: "FIELD",
      stableKey: `field_${index}`,
      sectionKey: section.stableKey,
      label: `字段 ${index + 1}`,
      enabled: index !== 1,
      sortOrder: index,
      layout: { colSpan: 1, rowBreakBefore: false },
      fieldType: "TEXT",
      semanticRole: "CUSTOM",
      required: false,
    })),
    staffingSource: { kind: "FIXED", count: 1 },
  };
}

function issueCodes(config: unknown): string[] {
  return validateDraftConfigV2(config).map((issue) => issue.code);
}

function baseDraft(): Record<string, unknown> {
  return draftWithSectionCount(1) as Record<string, unknown>;
}

function staffingDraft(enabled = true): Record<string, unknown> {
  const draft = baseDraft();
  draft.components = [
    {
      kind: "REPEATABLE_TABLE",
      stableKey: "staffing_table",
      sectionKey: "section_0",
      label: "岗位与人数",
      enabled,
      sortOrder: 0,
      layout: { colSpan: 1, rowBreakBefore: false },
      columns: [
        {
          stableKey: "staffing_label",
          label: "岗位",
          columnType: "TEXT",
          semanticRole: "STAFFING_LABEL",
          required: true,
        },
        {
          stableKey: "staffing_count",
          label: "人数",
          columnType: "NUMBER",
          semanticRole: "STAFFING_COUNT",
          required: true,
        },
      ],
      defaultRows: [{ staffing_label: "打野", staffing_count: 2 }],
    },
  ];
  draft.staffingSource = {
    kind: "REPEATABLE_TABLE_SUM",
    componentKey: "staffing_table",
    columnKey: "staffing_count",
  };
  return draft;
}

describe("通用派单模板 v2 草稿校验", () => {
  it("允许模板自由使用两个或五个区块并保留禁用组件", () => {
    expect(validateDraftConfigV2(draftWithSectionCount(2))).toEqual([]);
    expect(validateDraftConfigV2(draftWithSectionCount(5))).toEqual([]);
  });

  it("拒绝超过通用文档规模上限的草稿", () => {
    expect(issueCodes(draftWithSectionCount(21))).toContain(
      "TEMPLATE_COMPONENT_INVALID",
    );

    const tooManyComponents = baseDraft();
    tooManyComponents.components = Array.from({ length: 101 }, (_, index) => ({
      kind: "FIELD",
      stableKey: `field_${index}`,
      sectionKey: "section_0",
      label: `字段 ${index + 1}`,
      enabled: true,
      sortOrder: index,
      layout: { colSpan: 1, rowBreakBefore: false },
      fieldType: "TEXT",
      semanticRole: "CUSTOM",
      required: false,
    }));
    expect(issueCodes(tooManyComponents)).toContain(
      "TEMPLATE_COMPONENT_INVALID",
    );

    const tableWithTooManyColumns = baseDraft();
    tableWithTooManyColumns.components = [
      {
        kind: "REPEATABLE_TABLE",
        stableKey: "staffing_table",
        sectionKey: "section_0",
        label: "岗位",
        enabled: true,
        sortOrder: 0,
        layout: { colSpan: 1, rowBreakBefore: false },
        columns: Array.from({ length: 11 }, (_, index) => ({
          stableKey: `column_${index}`,
          label: `列 ${index + 1}`,
          columnType: "TEXT",
          semanticRole: "CUSTOM",
          required: false,
        })),
        defaultRows: [],
      },
    ];
    expect(issueCodes(tableWithTooManyColumns)).toContain(
      "TEMPLATE_COMPONENT_INVALID",
    );

    const tableWithTooManyRows = structuredClone(tableWithTooManyColumns);
    const table = (
      tableWithTooManyRows.components as Array<Record<string, unknown>>
    )[0];
    if (table) {
      table.columns = (table.columns as unknown[]).slice(0, 1);
      table.defaultRows = Array.from({ length: 51 }, () => ({}));
    }
    expect(issueCodes(tableWithTooManyRows)).toContain(
      "TEMPLATE_COMPONENT_INVALID",
    );

    const fieldWithTooManyOptions = baseDraft();
    fieldWithTooManyOptions.components = [
      {
        kind: "FIELD",
        stableKey: "target_rank",
        sectionKey: "section_0",
        label: "目标段位",
        enabled: true,
        sortOrder: 0,
        layout: { colSpan: 1, rowBreakBefore: false },
        fieldType: "SINGLE_SELECT",
        semanticRole: "TARGET_RANK",
        required: true,
        options: Array.from({ length: 101 }, (_, index) => ({
          value: `rank_${index}`,
          label: `段位 ${index + 1}`,
        })),
      },
    ];
    expect(issueCodes(fieldWithTooManyOptions)).toContain(
      "TEMPLATE_COMPONENT_INVALID",
    );
  });

  it("拒绝不稳定或有歧义的组件引用", () => {
    const invalidKey = baseDraft();
    const invalidKeySections = invalidKey.sections as Array<
      Record<string, unknown>
    >;
    if (invalidKeySections[0]) invalidKeySections[0].stableKey = "1-非法";
    expect(issueCodes(invalidKey)).toContain("TEMPLATE_COMPONENT_INVALID");

    const duplicateKey = baseDraft();
    duplicateKey.components = [
      {
        kind: "REPEATABLE_TABLE",
        stableKey: "section_0",
        sectionKey: "section_0",
        label: "岗位",
        enabled: true,
        sortOrder: 0,
        layout: { colSpan: 1, rowBreakBefore: false },
        columns: [
          {
            stableKey: "section_0",
            label: "岗位名称",
            columnType: "TEXT",
            semanticRole: "CUSTOM",
            required: true,
          },
        ],
        defaultRows: [],
      },
    ];
    expect(issueCodes(duplicateKey)).toContain("TEMPLATE_COMPONENT_INVALID");

    const orphanComponent = baseDraft();
    const orphanComponents = orphanComponent.components as Array<
      Record<string, unknown>
    >;
    if (orphanComponents[0]) orphanComponents[0].sectionKey = "missing";
    expect(issueCodes(orphanComponent)).toContain("TEMPLATE_BINDING_INVALID");

    const duplicateRole = draftWithSectionCount(2) as Record<string, unknown>;
    const duplicateRoleComponents = duplicateRole.components as Array<
      Record<string, unknown>
    >;
    for (const component of duplicateRoleComponents) {
      component.semanticRole = "MODE";
    }
    expect(issueCodes(duplicateRole)).toContain("TEMPLATE_COMPONENT_INVALID");
  });

  it("拒绝不符合判别联合的字段和价格选项", () => {
    const draftFor = (component: Record<string, unknown>) => {
      const draft = baseDraft();
      draft.components = [
        {
          stableKey: "field_main",
          sectionKey: "section_0",
          label: "字段",
          enabled: true,
          sortOrder: 0,
          layout: { colSpan: 1, rowBreakBefore: false },
          semanticRole: "CUSTOM",
          required: false,
          ...component,
        },
      ];
      return draft;
    };

    expect(issueCodes(draftFor({ kind: "UNKNOWN" }))).toContain(
      "TEMPLATE_COMPONENT_INVALID",
    );
    expect(
      issueCodes(draftFor({ kind: "FIELD", fieldType: "NOTE" })),
    ).toContain("TEMPLATE_COMPONENT_INVALID");
    expect(
      issueCodes(draftFor({ kind: "FIELD", fieldType: "SINGLE_SELECT" })),
    ).toContain("TEMPLATE_COMPONENT_INVALID");
    expect(
      issueCodes(
        draftFor({
          kind: "FIELD",
          fieldType: "TEXT",
          options: [{ value: "unexpected", label: "不应存在" }],
        }),
      ),
    ).toContain("TEMPLATE_COMPONENT_INVALID");
    expect(
      issueCodes(
        draftFor({
          kind: "FIELD",
          fieldType: "MULTI_SELECT",
          options: [{ value: "a", label: "A" }],
        }),
      ),
    ).toContain("TEMPLATE_COMPONENT_INVALID");
    expect(
      issueCodes(
        draftFor({
          kind: "FIELD",
          fieldType: "SINGLE_SELECT",
          options: [{ value: "a", label: "A", priceDeltaFen: "1.5" }],
        }),
      ),
    ).toContain("TEMPLATE_PRICE_RULE_INVALID");
  });

  it("发布时只接受指向启用数字来源的显式人数绑定", () => {
    const validPublished = {
      ...staffingDraft(),
      documentRendererVersion: 1,
    };
    expect(validatePublishedConfigV2(validPublished)).toEqual([]);

    const disabledTable = {
      ...staffingDraft(false),
      documentRendererVersion: 1,
    };
    expect(issueCodes(disabledTable)).toContain("TEMPLATE_BINDING_INVALID");

    const missingComponent = staffingDraft();
    missingComponent.staffingSource = {
      kind: "NUMBER_FIELD",
      componentKey: "missing_field",
    };
    expect(issueCodes(missingComponent)).toContain("TEMPLATE_BINDING_INVALID");

    const wrongFieldType = baseDraft();
    wrongFieldType.staffingSource = {
      kind: "NUMBER_FIELD",
      componentKey: "field_0",
    };
    expect(issueCodes(wrongFieldType)).toContain("TEMPLATE_BINDING_INVALID");
  });

  it("拒绝越界文案、布局、默认行和 UTF-8 文档体积", () => {
    const longSectionLabel = baseDraft();
    const longLabelSections = longSectionLabel.sections as Array<
      Record<string, unknown>
    >;
    if (longLabelSections[0]) longLabelSections[0].label = "区".repeat(51);
    expect(issueCodes(longSectionLabel)).toContain(
      "TEMPLATE_COMPONENT_INVALID",
    );

    const invalidLayout = baseDraft();
    const invalidLayoutSections = invalidLayout.sections as Array<
      Record<string, unknown>
    >;
    if (invalidLayoutSections[0]) {
      invalidLayoutSections[0].layout = { columns: 5 };
    }
    expect(issueCodes(invalidLayout)).toContain("TEMPLATE_COMPONENT_INVALID");

    const invalidDefaultRow = staffingDraft();
    const invalidTable = (
      invalidDefaultRow.components as Array<Record<string, unknown>>
    )[0];
    if (invalidTable) {
      invalidTable.defaultRows = [{ unknown_column: "不允许" }];
    }
    expect(issueCodes(invalidDefaultRow)).toContain(
      "TEMPLATE_COMPONENT_INVALID",
    );

    const oversized = baseDraft();
    oversized.unrecognizedPadding = "界".repeat(90_000);
    expect(issueCodes(oversized)).toContain("TEMPLATE_COMPONENT_INVALID");
  });

  it("允许遗留规则留在草稿中但禁止未确认草稿发布", () => {
    const needsReview = baseDraft();
    needsReview.legacyCompatibility = {
      unboundPriceRules: [
        { label: "王者", priceDeltaFen: "1000", sortOrder: 0 },
      ],
    };
    expect(validateDraftConfigV2(needsReview)).toEqual([]);

    const publishIssues = validatePublishedConfigV2({
      ...needsReview,
      documentRendererVersion: 1,
    });
    expect(publishIssues.map((issue) => issue.code)).toContain(
      "TEMPLATE_LEGACY_REVIEW_REQUIRED",
    );

    const unsupportedRenderer = validatePublishedConfigV2({
      ...baseDraft(),
      documentRendererVersion: 2,
    });
    expect(unsupportedRenderer.map((issue) => issue.code)).toContain(
      "TEMPLATE_COMPONENT_INVALID",
    );
  });

  it("拒绝表格默认值、选项名称、说明和遗留价格中的畸形嵌套值", () => {
    const invalidRowValue = staffingDraft();
    const invalidRowTable = (
      invalidRowValue.components as Array<Record<string, unknown>>
    )[0];
    if (invalidRowTable) {
      invalidRowTable.defaultRows = [
        { staffing_label: "打野", staffing_count: "两人" },
      ];
    }
    expect(issueCodes(invalidRowValue)).toContain("TEMPLATE_COMPONENT_INVALID");

    const invalidOptionLabel = baseDraft();
    invalidOptionLabel.components = [
      {
        kind: "FIELD",
        stableKey: "target_rank",
        sectionKey: "section_0",
        label: "目标段位",
        enabled: true,
        sortOrder: 0,
        layout: { colSpan: 1, rowBreakBefore: false },
        fieldType: "SINGLE_SELECT",
        semanticRole: "TARGET_RANK",
        required: true,
        options: [{ value: "king", label: "王".repeat(51) }],
      },
    ];
    expect(issueCodes(invalidOptionLabel)).toContain(
      "TEMPLATE_COMPONENT_INVALID",
    );

    const invalidNote = baseDraft();
    invalidNote.components = [
      {
        kind: "NOTE",
        stableKey: "notice",
        sectionKey: "section_0",
        label: "说明",
        enabled: true,
        sortOrder: 0,
        layout: { colSpan: 1, rowBreakBefore: false },
        text: "注".repeat(501),
      },
    ];
    expect(issueCodes(invalidNote)).toContain("TEMPLATE_COMPONENT_INVALID");

    const invalidLegacyPrice = baseDraft();
    invalidLegacyPrice.legacyCompatibility = {
      unboundPriceRules: [
        { label: "王者", priceDeltaFen: "10.5", sortOrder: 0 },
      ],
    };
    expect(issueCodes(invalidLegacyPrice)).toContain(
      "TEMPLATE_PRICE_RULE_INVALID",
    );
  });
});

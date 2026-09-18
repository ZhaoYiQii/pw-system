import { describe, expect, it } from "vitest";
import {
  TEMPLATE_WRITABLE_AUDIENCES_V2,
  billingComponentsHiddenFromV2,
  collectPublishBlockingIssuesV2,
  partitionValuesV2,
  resolveAudiencesV2,
  validateDraftConfigV2,
  validatePublishedConfigV2,
  visibleComponentsV2,
  visibleConfigV2,
  type PublishedConfigV2,
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

/* ── 端口可见性（模板字段端口可见性设计规格 v0.1，V-1 至 V-11）──────── */

describe("模板字段端口可见性（v2 领域校验）", () => {
  const componentDraft = (
    component: Record<string, unknown>,
    section: Record<string, unknown> = {},
  ): Record<string, unknown> => {
    const draft = baseDraft();
    const sections = draft.sections as Array<Record<string, unknown>>;
    const first = sections[0];
    if (first) Object.assign(first, section);
    draft.components = [
      {
        kind: "FIELD",
        stableKey: "target_rank",
        sectionKey: "section_0",
        label: "目标段位",
        enabled: true,
        sortOrder: 0,
        layout: { colSpan: 1, rowBreakBefore: false },
        fieldType: "TEXT",
        semanticRole: "CUSTOM",
        required: false,
        ...component,
      },
    ];
    return draft;
  };

  const issuePaths = (config: unknown): string[] =>
    validateDraftConfigV2(config).map((issue) => issue.path);

  it("历史模板没有标记时照旧合法（V-8：视为两个端口全选）", () => {
    expect(validateDraftConfigV2(baseDraft())).toEqual([]);
  });

  it("合法标记：单端口、双端口，重复项按去重处理（V-2）", () => {
    expect(
      validateDraftConfigV2(componentDraft({ audiences: ["CS"] })),
    ).toEqual([]);
    expect(
      validateDraftConfigV2(componentDraft({ audiences: ["CS", "CUSTOMER"] })),
    ).toEqual([]);
    expect(
      validateDraftConfigV2(componentDraft({ audiences: ["CS", "CS"] })),
    ).toEqual([]);
    expect(
      validateDraftConfigV2(componentDraft({}, { audiences: ["CUSTOMER"] })),
    ).toEqual([]);
  });

  it("空数组、未知端口与非数组都按组件路径报错（V-2：至少一个端口）", () => {
    const empty = validateDraftConfigV2(componentDraft({ audiences: [] }));
    expect(empty.map((issue) => issue.code)).toContain(
      "TEMPLATE_COMPONENT_INVALID",
    );
    expect(empty.map((issue) => issue.path)).toContain(
      "$.components[0].audiences",
    );

    expect(issuePaths(componentDraft({ audiences: ["BOSS"] }))).toContain(
      "$.components[0].audiences",
    );
    expect(issuePaths(componentDraft({ audiences: "CS" }))).toContain(
      "$.components[0].audiences",
    );
  });

  it("分组标记同样校验：组件覆盖分组不豁免分组自身（V-3）", () => {
    expect(
      issuePaths(componentDraft({ audiences: ["CS"] }, { audiences: [] })),
    ).toContain("$.sections[0].audiences");
  });

  it("发布校验沿用同一规则：空标记阻断发布", () => {
    const published = {
      ...componentDraft({ audiences: [] }),
      documentRendererVersion: 1,
    };
    expect(
      validatePublishedConfigV2(published).map((issue) => issue.code),
    ).toContain("TEMPLATE_COMPONENT_INVALID");
  });

  it("可见性与必填互不影响（V-10）", () => {
    expect(
      validateDraftConfigV2(
        componentDraft({ audiences: ["CS"], required: true }),
      ),
    ).toEqual([]);
    expect(
      validateDraftConfigV2(
        componentDraft({ audiences: ["CUSTOMER"], required: true }),
      ),
    ).toEqual([]);
  });

  it("解析生效端口：缺省全选、继承分组、组件覆盖、非法回落（V-3 / V-8）", () => {
    expect(resolveAudiencesV2(undefined, undefined)).toEqual([
      "CS",
      "CUSTOMER",
    ]);
    expect(resolveAudiencesV2(undefined, { audiences: ["CS"] })).toEqual([
      "CS",
    ]);
    expect(
      resolveAudiencesV2({ audiences: ["CUSTOMER"] }, { audiences: ["CS"] }),
    ).toEqual(["CUSTOMER"]);
    expect(resolveAudiencesV2({}, { audiences: ["CS", "CS"] })).toEqual(["CS"]);
    // 非法声明按"没有声明"回落；错误由校验层负责报告，不在这里二次报错。
    expect(
      resolveAudiencesV2({ audiences: [] }, { audiences: ["CS"] }),
    ).toEqual(["CS"]);
  });
});

describe("端口过滤（读取与写入的服务端权威，V-5 / V-6 / V-10）", () => {
  /** 两个分组、四个组件：分组声明 + 组件覆盖 + 缺省继承三种情形各一。 */
  function mixedConfig(): PublishedConfigV2 {
    return {
      schemaVersion: 2,
      documentRendererVersion: 1,
      sections: [
        {
          stableKey: "public_info",
          label: "需求信息",
          enabled: true,
          sortOrder: 0,
          layout: { columns: 2 },
          audiences: ["CS", "CUSTOMER"],
        },
        {
          stableKey: "internal",
          label: "内部信息",
          enabled: true,
          sortOrder: 1,
          layout: { columns: 2 },
          audiences: ["CS"],
        },
      ],
      components: [
        {
          kind: "FIELD",
          stableKey: "server_region",
          sectionKey: "public_info",
          label: "区服",
          enabled: true,
          sortOrder: 0,
          layout: { colSpan: 1, rowBreakBefore: false },
          fieldType: "TEXT",
          semanticRole: "SERVER_REGION",
          required: true,
        },
        {
          kind: "FIELD",
          stableKey: "customer_note",
          sectionKey: "public_info",
          label: "客户备注",
          enabled: true,
          sortOrder: 1,
          layout: { colSpan: 1, rowBreakBefore: false },
          fieldType: "TEXTAREA",
          semanticRole: "ORDER_NOTE",
          required: true,
          audiences: ["CUSTOMER"],
        },
        {
          kind: "FIELD",
          stableKey: "internal_note",
          sectionKey: "internal",
          label: "内部备注",
          enabled: true,
          sortOrder: 2,
          layout: { colSpan: 1, rowBreakBefore: false },
          fieldType: "TEXT",
          semanticRole: "CUSTOM",
          required: false,
        },
        {
          kind: "NOTE",
          stableKey: "notice",
          sectionKey: "public_info",
          label: "须知",
          enabled: true,
          sortOrder: 3,
          layout: { colSpan: 2, rowBreakBefore: true },
          text: "上号前请确认订单",
        },
      ],
      staffingSource: { kind: "FIXED", count: 1 },
    };
  }

  const keys = (config: unknown, audience: "CS" | "CUSTOMER"): string[] =>
    visibleComponentsV2(config as PublishedConfigV2, audience).map(
      (component) => component.stableKey,
    );

  it("按端口挑组件：组件覆盖分组、未声明继承分组（V-3 / V-5）", () => {
    expect(keys(mixedConfig(), "CS")).toEqual([
      "server_region",
      "internal_note",
      "notice",
    ]);
    expect(keys(mixedConfig(), "CUSTOMER")).toEqual([
      "server_region",
      "customer_note",
      "notice",
    ]);
  });

  /** 历史模板的等价物：与 mixedConfig 逐字段相同，只是完全没有 audiences。 */
  function withoutAudiences(config: PublishedConfigV2): PublishedConfigV2 {
    const clone = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
    for (const list of ["sections", "components"] as const) {
      for (const entry of clone[list] as Array<Record<string, unknown>>) {
        delete entry.audiences;
      }
    }
    return clone as unknown as PublishedConfigV2;
  }

  it("历史模板没有标记时两个端口都看得到全部（V-8）", () => {
    const legacy = withoutAudiences(mixedConfig());
    expect(keys(legacy, "CS")).toEqual([
      "server_region",
      "customer_note",
      "internal_note",
      "notice",
    ]);
    expect(keys(legacy, "CUSTOMER")).toEqual(keys(legacy, "CS"));
  });

  it("过滤整份配置：只保留有可见组件的分组，其余属性原样保留（V-6）", () => {
    const customer = visibleConfigV2(mixedConfig(), "CUSTOMER");
    expect(customer.sections.map((section) => section.stableKey)).toEqual([
      "public_info",
    ]);
    expect(customer.components.map((component) => component.stableKey)).toEqual(
      ["server_region", "customer_note", "notice"],
    );
    expect(customer.documentRendererVersion).toBe(1);
    expect(customer.staffingSource).toEqual({ kind: "FIXED", count: 1 });

    const cs = visibleConfigV2(mixedConfig(), "CS");
    expect(cs.sections.map((section) => section.stableKey)).toEqual([
      "public_info",
      "internal",
    ]);
    expect(cs.components.map((component) => component.stableKey)).toEqual([
      "server_region",
      "internal_note",
      "notice",
    ]);
  });

  it("写入过滤：丢弃「配置里存在但该端口看不见」的值，未知键留给下游报错（V-5）", () => {
    const values = {
      server_region: "艾欧尼亚",
      customer_note: "给我留个辅助位",
      internal_note: "老板是老朋友",
      forged_total: "99",
    };

    const cs = partitionValuesV2(mixedConfig(), values, "CS");
    expect(cs.visible).toEqual({
      server_region: "艾欧尼亚",
      internal_note: "老板是老朋友",
      forged_total: "99",
    });
    expect(cs.droppedKeys).toEqual(["customer_note"]);

    const customer = partitionValuesV2(mixedConfig(), values, "CUSTOMER");
    expect(customer.visible).toEqual({
      server_region: "艾欧尼亚",
      customer_note: "给我留个辅助位",
      forged_total: "99",
    });
    expect(customer.droppedKeys).toEqual(["internal_note"]);
  });

  it("没有标记的历史配置对两个端口都不丢弃值（V-8）", () => {
    const config = {
      ...mixedConfig(),
      sections: [
        {
          stableKey: "only",
          label: "唯一分组",
          enabled: true,
          sortOrder: 0,
          layout: { columns: 1 },
        },
      ],
      components: [
        {
          kind: "FIELD",
          stableKey: "server_region",
          sectionKey: "only",
          label: "区服",
          enabled: true,
          sortOrder: 0,
          layout: { colSpan: 1, rowBreakBefore: false },
          fieldType: "TEXT",
          semanticRole: "SERVER_REGION",
          required: false,
        },
      ],
    };
    const values = { server_region: "艾欧尼亚" };
    for (const audience of ["CS", "CUSTOMER"] as const) {
      const partitioned = partitionValuesV2(
        config as PublishedConfigV2,
        values,
        audience,
      );
      expect(partitioned.visible).toEqual(values);
      expect(partitioned.droppedKeys).toEqual([]);
    }
  });
});

describe("值类内容必须对可写入端口可见（只有客服能填写时的产品规则）", () => {
  /** 模块级夹具：一个分组 + 一个 TEXT 字段，人数来源固定为 1。 */
  function valueFixture(): PublishedConfigV2 {
    return {
      ...baseDraft(),
      documentRendererVersion: 1,
    } as unknown as PublishedConfigV2;
  }

  const componentAt = (
    config: PublishedConfigV2,
    index: number,
  ): Record<string, unknown> =>
    (config.components as unknown as Record<string, unknown>[])[index]!;

  /** 把第 0 个字段变成「带加价的单选」。 */
  function priced(config: PublishedConfigV2): PublishedConfigV2 {
    const field = componentAt(config, 0);
    field.fieldType = "SINGLE_SELECT";
    field.semanticRole = "MODE";
    field.options = [{ value: "ranked", label: "排位", priceDeltaFen: "1500" }];
    return config;
  }

  it("目前只有客服是可写入端口", () => {
    expect(TEMPLATE_WRITABLE_AUDIENCES_V2).toEqual(["CS"]);
  });

  it("发布拒绝：值类内容被标成对客服不可见（没人能填它）", () => {
    const config = valueFixture();
    componentAt(config, 0).audiences = ["CUSTOMER"];
    expect(collectPublishBlockingIssuesV2(config)).toContainEqual(
      expect.objectContaining({
        code: "TEMPLATE_COMPONENT_INVALID",
        componentKey: "field_0",
        message: expect.stringContaining("客服"),
      }),
    );
    // 只挡发布：已发布的历史版本仍然可读（V-8 / V-9）
    expect(validatePublishedConfigV2(config)).toEqual([]);
  });

  it("发布拒绝：整组只给客户时，组内的值类内容同样没人能填", () => {
    const config = valueFixture();
    (config.sections[0] as unknown as Record<string, unknown>).audiences = [
      "CUSTOMER",
    ];
    expect(collectPublishBlockingIssuesV2(config)).toContainEqual(
      expect.objectContaining({
        code: "TEMPLATE_COMPONENT_INVALID",
        componentKey: "field_0",
      }),
    );
  });

  it("发布放行：说明类只给客户看是允许的（它不需要被填写）", () => {
    const config = valueFixture();
    config.components = [
      {
        kind: "NOTE",
        stableKey: "notice",
        sectionKey: "section_0",
        label: "须知",
        enabled: true,
        sortOrder: 0,
        layout: { colSpan: 2, rowBreakBefore: true },
        text: "上号前请确认订单",
        audiences: ["CUSTOMER"],
      },
    ] as unknown as PublishedConfigV2["components"];
    expect(collectPublishBlockingIssuesV2(config)).toEqual([]);
  });

  it("草稿保存不受这条规则约束（只有发布才阻断）", () => {
    const config = valueFixture();
    componentAt(config, 0).audiences = ["CUSTOMER"];
    expect(validateDraftConfigV2(config)).toEqual([]);
    expect(collectPublishBlockingIssuesV2(config)).not.toEqual([]);
  });

  it("参与算价或人数的内容，对该端口不可见时会被点名（运行期兜底依据）", () => {
    // ① 带加价的选项字段只给客户
    const priceHidden = priced(valueFixture());
    componentAt(priceHidden, 0).audiences = ["CUSTOMER"];
    expect(
      billingComponentsHiddenFromV2(priceHidden, "CS").map(
        (component) => component.stableKey,
      ),
    ).toEqual(["field_0"]);

    // ② 人数来源只给客户
    const staffingHidden = valueFixture();
    componentAt(staffingHidden, 0).audiences = ["CUSTOMER"];
    staffingHidden.staffingSource = {
      kind: "NUMBER_FIELD",
      componentKey: "field_0",
    };
    expect(
      billingComponentsHiddenFromV2(staffingHidden, "CS").map(
        (component) => component.stableKey,
      ),
    ).toEqual(["field_0"]);

    // 对该端口可见时不算问题
    expect(billingComponentsHiddenFromV2(valueFixture(), "CS")).toEqual([]);
  });
});

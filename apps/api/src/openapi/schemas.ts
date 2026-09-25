/** OpenAPI 内联 schema 常量。金额一律 decimal-string 分（MoneyFen），禁止 number/浮点（主规格 10.5/12.1）。 */

interface SchemaProperty {
  type?: string;
  format?: string;
  nullable?: boolean;
  example?: string | number | boolean;
  pattern?: string;
  description?: string;
  minimum?: number;
  maximum?: number;
  items?: unknown;
  properties?: Record<string, unknown>;
  required?: string[];
  oneOf?: unknown[];
  /** OpenAPI 判别联合：让生成器把 kind 渲染成字面量联合而不是 string。 */
  discriminator?: { propertyName: string; mapping?: Record<string, string> };
  enum?: unknown[];
  const?: unknown;
  additionalProperties?: unknown;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
}

export interface OpenApiSchema {
  type?: string;
  format?: string;
  nullable?: boolean;
  description?: string;
  required?: string[];
  properties?: Record<string, unknown>;
  items?: OpenApiSchema;
  oneOf?: unknown[];
  /** OpenAPI 判别联合：让生成器把 kind 渲染成字面量联合而不是 string。 */
  discriminator?: { propertyName: string; mapping?: Record<string, string> };
  enum?: unknown[];
  const?: unknown;
  additionalProperties?: unknown;
  minItems?: number;
  maxItems?: number;
}

const positiveFen = (label: string): SchemaProperty => ({
  type: "string",
  pattern: "^[1-9][0-9]*$",
  example: "1500",
  description: `${label}（十进制字符串分，>0）`,
});

const nonNegativeFen = (label: string): SchemaProperty => ({
  type: "string",
  pattern: "^(?:0|[1-9][0-9]*)$",
  example: "800",
  description: `${label}（十进制字符串分，>=0）`,
});

const optionalString = (
  description: string,
  nullable = false,
): SchemaProperty => ({
  type: "string",
  nullable,
  description,
});

const dateTime = (description: string, nullable = false): SchemaProperty => ({
  type: "string",
  format: "date-time",
  nullable,
  description,
});

const integer = (description: string, minimum = 0): SchemaProperty => ({
  type: "integer",
  minimum,
  description,
});

const bool = (description: string): SchemaProperty => ({
  type: "boolean",
  description,
});

const stringField = (description: string): SchemaProperty => ({
  type: "string",
  description,
});

function object(
  required: string[],
  properties: Record<string, unknown>,
  description?: string,
): OpenApiSchema {
  return {
    type: "object",
    required,
    properties,
    ...(description ? { description } : {}),
  };
}

export function dataSchema(item: OpenApiSchema): OpenApiSchema {
  return object(["data"], { data: item });
}

export function dataArraySchema(item: OpenApiSchema): OpenApiSchema {
  return object(["data"], { data: { type: "array", items: item } });
}

export const pricingRuleBodySchema: OpenApiSchema = object(
  ["durationSeconds", "priceFen"],
  {
    durationSeconds: integer("时长（秒）", 1),
    priceFen: positiveFen("售价"),
    playerCostFen: nonNegativeFen("陪玩成本"),
    enabled: bool("是否启用"),
  },
  "创建价格规则",
);

export const updatePricingRuleBodySchema: OpenApiSchema = object(
  [],
  {
    durationSeconds: integer("时长（秒）", 1),
    priceFen: positiveFen("售价"),
    playerCostFen: nonNegativeFen("陪玩成本"),
    enabled: bool("是否启用"),
  },
  "更新价格规则",
);

export const pricingRuleSchema: OpenApiSchema = object(
  [
    "id",
    "tenantId",
    "serviceProductId",
    "durationSeconds",
    "priceFen",
    "playerCostFen",
    "enabled",
    "createdAt",
    "updatedAt",
  ],
  {
    id: stringField("价格规则 id"),
    tenantId: stringField("租户 id"),
    serviceProductId: stringField("服务产品 id"),
    durationSeconds: integer("时长（秒）"),
    priceFen: positiveFen("售价"),
    playerCostFen: nonNegativeFen("陪玩成本"),
    enabled: bool("是否启用"),
    createdAt: dateTime("创建时间"),
    updatedAt: dateTime("更新时间"),
  },
  "价格规则（金额字段为十进制字符串分）",
);

export const orderRequirementSchema: OpenApiSchema = object(
  ["description"],
  {
    description: stringField("需求描述"),
    gameId: optionalString("游戏 id", true),
    serviceProductId: optionalString("服务产品 id", true),
    gameName: optionalString("游戏名", true),
    productName: optionalString("产品名", true),
    desiredStartAt: dateTime("期望开始时间", true),
    durationSeconds: integer("时长（秒）", 1),
    minBudgetFen: nonNegativeFen("最低预算"),
    maxBudgetFen: nonNegativeFen("最高预算"),
    note: optionalString("备注", true),
  },
  "订单需求",
);

export const orderSnapshotLineSchema: OpenApiSchema = object(
  [
    "serviceProductId",
    "productName",
    "regionName",
    "durationSeconds",
    "unitPriceFen",
    "playerCostFen",
    "lineTotalFen",
    "currency",
  ],
  {
    serviceProductId: optionalString("服务产品 id", true),
    productName: stringField("产品名"),
    regionName: optionalString("区服名", true),
    durationSeconds: integer("时长（秒）"),
    unitPriceFen: positiveFen("单价"),
    playerCostFen: nonNegativeFen("陪玩成本"),
    lineTotalFen: positiveFen("行小计"),
    currency: stringField("币种"),
  },
  "订单价格快照行",
);

const orderTimelineEventSchema: OpenApiSchema = object(
  ["id", "eventType", "fromStatus", "toStatus", "occurredAt"],
  {
    id: stringField("事件 id"),
    eventType: stringField("事件类型"),
    fromStatus: optionalString("原状态", true),
    toStatus: optionalString("目标状态", true),
    occurredAt: dateTime("发生时间"),
  },
);

export const orderSchema: OpenApiSchema = object(
  [
    "id",
    "tenantId",
    "orderNo",
    "customerProfileId",
    "customerName",
    "status",
    "scheduledStartAt",
    "remark",
    "version",
    "createdAt",
    "updatedAt",
    "requirement",
    "snapshot",
    "timeline",
  ],
  {
    id: stringField("订单 id"),
    tenantId: stringField("租户 id"),
    orderNo: stringField("订单号"),
    customerProfileId: stringField("客户档案 id"),
    customerName: stringField("客户名"),
    status: stringField("订单状态"),
    scheduledStartAt: dateTime("计划开始", true),
    remark: optionalString("备注", true),
    version: integer("乐观锁版本"),
    createdAt: dateTime("创建时间"),
    updatedAt: dateTime("更新时间"),
    requirement: {
      type: "object",
      nullable: true,
      properties: orderRequirementSchema.properties,
      required: orderRequirementSchema.required,
    },
    snapshot: { type: "array", items: orderSnapshotLineSchema, nullable: true },
    timeline: { type: "array", items: orderTimelineEventSchema },
  },
  "订单视图（金额字段为十进制字符串分）",
);

export const hallOrderSchema: OpenApiSchema = object(
  [
    "id",
    "orderNo",
    "productName",
    "durationSeconds",
    "unitPriceFen",
    "desiredStartAt",
    "createdAt",
  ],
  {
    id: stringField("订单 id"),
    orderNo: stringField("订单号"),
    productName: stringField("产品名"),
    durationSeconds: integer("时长（秒）"),
    unitPriceFen: positiveFen("单价"),
    desiredStartAt: dateTime("期望开始", true),
    createdAt: dateTime("创建时间"),
  },
  "接单大厅订单",
);

export const accountingResultSchema: OpenApiSchema = object(
  ["earningId", "playerShareFen"],
  {
    earningId: stringField("earning id"),
    playerShareFen: nonNegativeFen("陪玩分成"),
  },
  "订单核算结果",
);

export const playerFinanceSchema: OpenApiSchema = object(
  ["pendingFen", "batchedFen", "paidFen"],
  {
    pendingFen: nonNegativeFen("待入账金额"),
    batchedFen: nonNegativeFen("已入批金额"),
    paidFen: nonNegativeFen("已支付金额"),
  },
  "陪玩财务汇总",
);

export const financeRulesSchema: OpenApiSchema = object(
  ["platformFeeBp", "storeCutBp"],
  {
    platformFeeBp: integer("平台费率 bp"),
    storeCutBp: integer("门店抽成 bp"),
  },
);

export const splitPreviewBodySchema: OpenApiSchema = object(
  ["amountFen"],
  { amountFen: positiveFen("老板应付金额") },
  "分账试算入参（十进制字符串分）",
);

export const splitPreviewSchema: OpenApiSchema = object(
  ["platformFeeFen", "storeCutFen", "playerShareFen"],
  {
    platformFeeFen: nonNegativeFen("平台服务费"),
    storeCutFen: nonNegativeFen("门店抽成"),
    playerShareFen: nonNegativeFen("陪玩到手"),
  },
  "分账试算结果",
);

/* ------------------------------------------------------------------ *
 * S2 通用派单模板（schemaVersion 2）契约
 * 上限与 Zod / 领域常量一致：20 区块、100 组件、10 列、50 行、100 选项、256 KiB。
 * 金额（priceDeltaFen）一律 decimal string，禁止 number/浮点。
 * ------------------------------------------------------------------ */

const templateStableKey = (description: string): SchemaProperty => ({
  type: "string",
  pattern: "^[a-z][a-z0-9_]{0,63}$",
  description,
});

const templateLabel = (description: string): SchemaProperty => ({
  type: "string",
  minLength: 1,
  maxLength: 50,
  description,
});

const templateHelpText = (description: string): SchemaProperty => ({
  type: "string",
  maxLength: 500,
  description,
});

/** 选项/旧价格规则的加价：十进制字符串分（>0 的售价类规则在此允许 0）。 */
export const priceDeltaFenSchema: SchemaProperty = {
  type: "string",
  pattern: "^(?:0|[1-9][0-9]*)$",
  example: "1000",
  description: "选项加价（十进制字符串分，禁止 number/浮点）",
};

/**
 * 端口可见性（设计规格 v0.1，V-1 / V-2）：
 * 可选；缺省表示继承（组件 → 分组 → 两个端口全选，V-3 / V-8）；显式声明时至少一个端口。
 */
const templateAudiences = (description: string): SchemaProperty => ({
  type: "array",
  items: { type: "string", enum: ["CS", "CUSTOMER"] },
  minItems: 1,
  description,
});

const templateLayout = (description: string): OpenApiSchema =>
  object(
    ["colSpan", "rowBreakBefore"],
    {
      colSpan: {
        type: "integer",
        enum: [1, 2, 3, 4],
        description: "栅格宽度（1-4）",
      },
      rowBreakBefore: bool("是否在此组件前换行"),
    },
    description,
  );

export const genericTemplateSectionSchema: OpenApiSchema = object(
  ["stableKey", "label", "enabled", "sortOrder", "layout"],
  {
    stableKey: templateStableKey("区块稳定键（发布后不可改）"),
    label: templateLabel("区块名称"),
    description: templateHelpText("区块说明"),
    audiences: templateAudiences(
      "端口可见性（CS=客服，CUSTOMER=客户；缺省=继承并回落两个端口全选）",
    ),
    enabled: bool("区块是否启用"),
    sortOrder: integer("区块顺序"),
    layout: object(
      ["columns"],
      {
        columns: {
          type: "integer",
          enum: [1, 2, 3, 4],
          description: "列数（1-4）",
        },
        density: {
          type: "string",
          enum: ["comfortable", "compact"],
          description: "密度",
        },
        align: {
          type: "string",
          enum: ["left", "center"],
          description: "对齐",
        },
      },
      "区块布局",
    ),
  },
  "模板区块",
);

export const genericTemplateOptionSchema: OpenApiSchema = object(
  ["value", "label"],
  {
    value: templateStableKey("选项值（稳定键）"),
    label: templateLabel("选项名称"),
    priceDeltaFen: priceDeltaFenSchema,
  },
  "选择项（含可选加价）",
);

export const genericTemplateFieldComponentSchema: OpenApiSchema = object(
  [
    "kind",
    "stableKey",
    "sectionKey",
    "label",
    "enabled",
    "sortOrder",
    "layout",
    "fieldType",
    "semanticRole",
    "required",
  ],
  {
    kind: { type: "string", const: "FIELD", description: "组件类型" },
    stableKey: templateStableKey("组件稳定键"),
    sectionKey: templateStableKey("所属区块稳定键"),
    label: templateLabel("组件名称"),
    description: templateHelpText("组件说明"),
    audiences: templateAudiences(
      "端口可见性（CS=客服，CUSTOMER=客户；缺省=继承所属区块）",
    ),
    enabled: bool("组件是否启用"),
    sortOrder: integer("组件顺序"),
    layout: templateLayout("组件布局"),
    fieldType: {
      type: "string",
      enum: [
        "TEXT",
        "TEXTAREA",
        "NUMBER",
        "MONEY_FEN",
        "DATETIME",
        "SINGLE_SELECT",
        "MULTI_SELECT",
      ],
      description: "字段类型",
    },
    semanticRole: {
      type: "string",
      enum: [
        "CUSTOM",
        "MODE",
        "TARGET_RANK",
        "CURRENT_RANK",
        "DURATION_MINUTES",
        "SERVER_REGION",
        "CONTACT",
        "ORDER_NOTE",
        "STAFFING_LABEL",
        "STAFFING_COUNT",
      ],
      description: "业务语义角色（非 CUSTOM 时全局唯一）",
    },
    required: bool("是否必填"),
    placeholder: templateHelpText("占位提示"),
    options: {
      type: "array",
      maxItems: 100,
      items: genericTemplateOptionSchema,
      description: "选择项（选择类字段必须至少一个）",
    },
    aggregationPolicy: {
      type: "string",
      enum: ["SUM", "MAX"],
      description: "多选字段的聚合策略（MULTI_SELECT 必填）",
    },
  },
  "FIELD 组件",
);

export const genericTemplateTableColumnSchema: OpenApiSchema = object(
  ["stableKey", "label", "columnType", "semanticRole", "required"],
  {
    stableKey: templateStableKey("列稳定键"),
    label: templateLabel("列名称"),
    columnType: {
      type: "string",
      enum: ["TEXT", "NUMBER", "SINGLE_SELECT"],
      description: "列类型",
    },
    semanticRole: {
      type: "string",
      enum: [
        "CUSTOM",
        "MODE",
        "TARGET_RANK",
        "CURRENT_RANK",
        "DURATION_MINUTES",
        "SERVER_REGION",
        "CONTACT",
        "ORDER_NOTE",
        "STAFFING_LABEL",
        "STAFFING_COUNT",
      ],
      description: "业务语义角色",
    },
    required: bool("是否必填"),
    options: {
      type: "array",
      maxItems: 100,
      items: genericTemplateOptionSchema,
      description: "单选列的选项",
    },
  },
  "可重复表格列",
);

export const genericTemplateTableComponentSchema: OpenApiSchema = object(
  [
    "kind",
    "stableKey",
    "sectionKey",
    "label",
    "enabled",
    "sortOrder",
    "layout",
    "columns",
    "defaultRows",
  ],
  {
    kind: {
      type: "string",
      const: "REPEATABLE_TABLE",
      description: "组件类型",
    },
    stableKey: templateStableKey("组件稳定键"),
    sectionKey: templateStableKey("所属区块稳定键"),
    label: templateLabel("组件名称"),
    description: templateHelpText("组件说明"),
    audiences: templateAudiences(
      "端口可见性（CS=客服，CUSTOMER=客户；缺省=继承所属区块）",
    ),
    enabled: bool("组件是否启用"),
    sortOrder: integer("组件顺序"),
    layout: templateLayout("组件布局"),
    columns: {
      type: "array",
      maxItems: 10,
      items: genericTemplateTableColumnSchema,
      description: "表格列（最多 10 列）",
    },
    defaultRows: {
      type: "array",
      maxItems: 50,
      items: { type: "object", additionalProperties: true },
      description: "默认行（键必须是已定义的列）",
    },
  },
  "REPEATABLE_TABLE 组件",
);

export const genericTemplateNoteComponentSchema: OpenApiSchema = object(
  [
    "kind",
    "stableKey",
    "sectionKey",
    "label",
    "enabled",
    "sortOrder",
    "layout",
    "text",
  ],
  {
    kind: { type: "string", const: "NOTE", description: "组件类型" },
    stableKey: templateStableKey("组件稳定键"),
    sectionKey: templateStableKey("所属区块稳定键"),
    label: templateLabel("组件名称"),
    description: templateHelpText("组件说明"),
    audiences: templateAudiences(
      "端口可见性（CS=客服，CUSTOMER=客户；缺省=继承所属区块）",
    ),
    enabled: bool("组件是否启用"),
    sortOrder: integer("组件顺序"),
    layout: templateLayout("组件布局"),
    text: templateHelpText("说明纯文本（不支持 HTML/脚本）"),
  },
  "NOTE 组件",
);

/** 组件判别联合：FIELD / REPEATABLE_TABLE / NOTE，按 kind 区分。 */
export const genericTemplateComponentSchema: OpenApiSchema = {
  oneOf: [
    genericTemplateFieldComponentSchema,
    genericTemplateTableComponentSchema,
    genericTemplateNoteComponentSchema,
  ],
  discriminator: { propertyName: "kind" },
  description: "模板组件（判别联合，按 kind 区分）",
};

/** 人数来源判别联合：FIXED / NUMBER_FIELD / REPEATABLE_TABLE_SUM。 */
export const genericTemplateStaffingSourceSchema: OpenApiSchema = {
  discriminator: { propertyName: "kind" },
  oneOf: [
    object(
      ["kind", "count"],
      {
        kind: { type: "string", const: "FIXED", description: "固定人数" },
        count: integer("人数", 1),
      },
      "固定人数",
    ),
    object(
      ["kind", "componentKey"],
      {
        kind: {
          type: "string",
          const: "NUMBER_FIELD",
          description: "取启用数字字段",
        },
        componentKey: templateStableKey("人数字段稳定键"),
      },
      "数字字段人数",
    ),
    object(
      ["kind", "componentKey", "columnKey"],
      {
        kind: {
          type: "string",
          const: "REPEATABLE_TABLE_SUM",
          description: "汇总表格列",
        },
        componentKey: templateStableKey("表格组件稳定键"),
        columnKey: templateStableKey("STAFFING_COUNT 数字列稳定键"),
      },
      "表格列求和人数",
    ),
  ],
  description: "人数来源（判别联合，按 kind 区分）",
};

/** 可编辑草稿：schemaVersion=2，允许携带仅迁移用 legacyCompatibility。 */
export const genericTemplateDraftConfigSchema: OpenApiSchema = object(
  ["schemaVersion", "sections", "components", "staffingSource"],
  {
    schemaVersion: {
      type: "integer",
      enum: [2],
      description: "配置版本（固定 2）",
    },
    sections: {
      type: "array",
      maxItems: 20,
      items: genericTemplateSectionSchema,
      description: "内容区块（最多 20）",
    },
    components: {
      type: "array",
      maxItems: 100,
      items: genericTemplateComponentSchema,
      description: "通用组件（最多 100）",
    },
    staffingSource: genericTemplateStaffingSourceSchema,
    legacyCompatibility: object(
      ["unboundPriceRules"],
      {
        unboundPriceRules: {
          type: "array",
          maxItems: 100,
          items: object(
            ["label", "priceDeltaFen", "sortOrder"],
            {
              label: templateLabel("旧价格规则名称"),
              priceDeltaFen: priceDeltaFenSchema,
              sortOrder: integer("排序"),
            },
            "未绑定的旧价格规则",
          ),
          description: "仅迁移兼容；非空时不允许发布",
        },
      },
      "旧模板迁移兼容信息（发布配置中会被移除）",
    ),
  },
  "通用模板草稿配置（schemaVersion 2）",
);

/** 发布配置：不含 legacyCompatibility，且必须带服务端加入的 documentRendererVersion。 */
export const genericTemplatePublishedConfigSchema: OpenApiSchema = object(
  [
    "schemaVersion",
    "sections",
    "components",
    "staffingSource",
    "documentRendererVersion",
  ],
  {
    schemaVersion: {
      type: "integer",
      enum: [2],
      description: "配置版本（固定 2）",
    },
    sections: {
      type: "array",
      maxItems: 20,
      items: genericTemplateSectionSchema,
      description: "内容区块",
    },
    components: {
      type: "array",
      maxItems: 100,
      items: genericTemplateComponentSchema,
      description: "通用组件",
    },
    staffingSource: genericTemplateStaffingSourceSchema,
    documentRendererVersion: {
      type: "integer",
      enum: [1],
      description: "文案渲染器版本（仅由服务端写入）",
    },
  },
  "通用模板发布配置（不可变版本内容，服务端字段）",
);

export const genericTemplateSummarySchema: OpenApiSchema = object(
  [
    "id",
    "game",
    "name",
    "description",
    "status",
    "activeVersionNo",
    "revision",
    "isDefault",
    "lastUsedAt",
    "updatedAt",
    "updatedBy",
    "hasUnpublishedChanges",
  ],
  {
    id: stringField("模板 id"),
    game: object(
      ["id", "name"],
      {
        id: stringField("游戏 id（未归类旧模板为空串）"),
        name: stringField("游戏名（未归类旧模板为空串）"),
      },
      "所属游戏",
    ),
    name: stringField("模板名称"),
    description: optionalString("模板说明", true),
    status: {
      type: "string",
      enum: ["DRAFT", "PUBLISHED", "UNPUBLISHED_CHANGES", "ARCHIVED"],
      description: "派生状态（UNPUBLISHED_CHANGES 不落库）",
    },
    activeVersionNo: {
      type: "integer",
      nullable: true,
      description: "生效版本号",
    },
    revision: integer("乐观锁修订号"),
    isDefault: bool("是否该游戏默认模板"),
    lastUsedAt: dateTime("最近使用时间", true),
    updatedAt: dateTime("更新时间"),
    updatedBy: optionalString("最后修改人", true),
    hasUnpublishedChanges: bool("草稿是否与生效版本不同"),
  },
  "模板列表摘要（不含 config 与旧固定模块）",
);

export const genericTemplateVersionSummarySchema: OpenApiSchema = object(
  [
    "id",
    "versionNo",
    "schemaVersion",
    "sourceVersionId",
    "changeNote",
    "publishedAt",
    "publishedBy",
  ],
  {
    id: stringField("版本 id"),
    versionNo: integer("版本号", 1),
    schemaVersion: integer("配置版本（1 为只读历史）"),
    sourceVersionId: optionalString("溯源来源版本 id", true),
    changeNote: optionalString("发布备注", true),
    publishedAt: dateTime("发布时间"),
    publishedBy: stringField("发布人"),
  },
  "版本摘要（不返回 configJson）",
);

export const genericTemplateDraftViewSchema: OpenApiSchema = object(
  [
    "id",
    "game",
    "name",
    "description",
    "status",
    "activeVersionNo",
    "revision",
    "isDefault",
    "lastUsedAt",
    "updatedAt",
    "updatedBy",
    "hasUnpublishedChanges",
    "config",
    "activeVersion",
  ],
  {
    ...genericTemplateSummarySchema.properties,
    config: genericTemplateDraftConfigSchema,
    activeVersion: {
      ...genericTemplateVersionSummarySchema,
      nullable: true,
      description: "生效版本摘要（只读）",
    },
  },
  "模板草稿视图（config 为可编辑草稿）",
);

export const genericTemplateListPageSchema: OpenApiSchema = object(
  ["data", "page"],
  {
    data: {
      type: "array",
      items: genericTemplateSummarySchema,
      description: "模板摘要列表",
    },
    page: object(
      ["nextCursor"],
      {
        nextCursor: {
          type: "string",
          nullable: true,
          description: "下一页游标（与排序绑定，null 表示结束）",
        },
      },
      "分页信息",
    ),
  },
  "模板摘要分页响应",
);

export const genericTemplateVersionsPageSchema: OpenApiSchema = object(
  ["data", "page"],
  {
    data: {
      type: "array",
      items: genericTemplateVersionSummarySchema,
      description: "版本摘要列表",
    },
    page: object(
      ["nextCursor"],
      {
        nextCursor: {
          type: "string",
          nullable: true,
          description: "下一页游标（按 publishedAt+id，null 表示结束）",
        },
      },
      "分页信息",
    ),
  },
  "版本历史分页响应",
);

export const genericTemplateCreateBodySchema: OpenApiSchema = object(
  ["gameId", "name"],
  {
    gameId: { type: "string", format: "uuid", description: "目标游戏 id" },
    name: templateLabel("模板名称"),
    description: optionalString("模板说明", true),
  },
  "创建模板（生成最小有效 v2 草稿）",
);

export const genericTemplateSaveDraftBodySchema: OpenApiSchema = object(
  ["expectedRevision", "config"],
  {
    expectedRevision: integer("客户端持有的修订号（必须与当前一致）"),
    config: genericTemplateDraftConfigSchema,
  },
  "整份保存草稿（乐观锁）",
);

export const genericTemplatePublishBodySchema: OpenApiSchema = object(
  ["expectedRevision"],
  {
    expectedRevision: integer("客户端持有的修订号"),
    changeNote: optionalString("发布备注", true),
    sourceVersionId: {
      type: "string",
      format: "uuid",
      nullable: true,
      description: "溯源来源版本 id（仅同模板版本，不决定发布配置）",
    },
  },
  "发布（发布配置取服务端当前草稿）",
);

export const genericTemplateRestoreBodySchema: OpenApiSchema = object(
  ["versionId", "expectedRevision"],
  {
    versionId: {
      type: "string",
      format: "uuid",
      description: "要还原的 v2 版本 id",
    },
    expectedRevision: integer("客户端持有的修订号"),
  },
  "还原历史版本到草稿",
);

export const genericTemplateCopyBodySchema: OpenApiSchema = object(
  ["targetGameId", "newName"],
  {
    targetGameId: {
      type: "string",
      format: "uuid",
      description: "目标游戏 id（必须同租户）",
    },
    newName: templateLabel("新模板名称"),
  },
  "复制到目标游戏（生成独立 DRAFT）",
);

export const genericTemplateExpectedRevisionBodySchema: OpenApiSchema = object(
  ["expectedRevision"],
  { expectedRevision: integer("客户端持有的修订号") },
  "仅需修订号的幂等动作（default/archive/unarchive）",
);

/* 查询参数：列表 query 由 Zod 在 API 边界统一校验并转型。 */
export const genericTemplateGameIdQuerySchema: SchemaProperty = {
  type: "string",
  format: "uuid",
  description: "按游戏过滤",
};

/** 列表的游戏范围参数：ALL（默认）或 UNCLASSIFIED（未归类旧模板）。 */
export const genericTemplateGameScopeQuerySchema: SchemaProperty = {
  type: "string",
  enum: ["ALL", "UNCLASSIFIED"],
  description: "游戏范围；与 gameId 互斥",
};

export const genericTemplateStatusQuerySchema: SchemaProperty = {
  type: "string",
  enum: ["DRAFT", "PUBLISHED", "UNPUBLISHED_CHANGES", "ARCHIVED"],
  description: "派生状态过滤（默认不含已归档）",
};

export const genericTemplateSortQuerySchema: SchemaProperty = {
  type: "string",
  enum: ["UPDATED_DESC", "UPDATED_ASC", "NAME_ASC", "LAST_USED_DESC"],
  description: "排序（默认 UPDATED_DESC）",
};

export const genericTemplateSearchQuerySchema: SchemaProperty = {
  type: "string",
  maxLength: 100,
  description: "按名称/说明搜索",
};

export const genericTemplateCursorQuerySchema: SchemaProperty = {
  type: "string",
  maxLength: 2000,
  description: "上一页返回的游标",
};

export const genericTemplateLimitQuerySchema: SchemaProperty = {
  type: "string",
  pattern: "^[1-9][0-9]*$",
  description: "每页条数（1-100，默认 30/版本历史 20）",
};

export const genericTemplateExpectedRevisionQuerySchema: SchemaProperty = {
  type: "string",
  pattern: "^(?:0|[1-9][0-9]*)$",
  description: "客户端持有的修订号（DELETE 走 query）",
};

/* 受控错误：code 枚举 + 固定 details 类型。 */
export const genericTemplateErrorCodeSchema: SchemaProperty = {
  type: "string",
  enum: [
    "TEMPLATE_CURSOR_INVALID",
    "TEMPLATE_NOT_FOUND",
    "TEMPLATE_REVISION_CONFLICT",
    "TEMPLATE_ARCHIVED",
    "TEMPLATE_NAME_CONFLICT",
    "TEMPLATE_DELETE_RESTRICTED",
    "TEMPLATE_VERSION_UNAVAILABLE",
    "TEMPLATE_COMPONENT_INVALID",
    "TEMPLATE_BINDING_INVALID",
    "TEMPLATE_PRICE_RULE_INVALID",
    "TEMPLATE_LEGACY_REVIEW_REQUIRED",
    "TEMPLATE_IDEMPOTENCY_REQUIRED",
    "TEMPLATE_IDEMPOTENCY_MISMATCH",
    "TEMPLATE_IDEMPOTENCY_IN_FLIGHT",
  ],
  description: "受控业务错误码",
};

export const genericTemplateValidationIssueSchema: OpenApiSchema = object(
  ["code", "path", "message"],
  {
    code: {
      type: "string",
      enum: [
        "TEMPLATE_COMPONENT_INVALID",
        "TEMPLATE_BINDING_INVALID",
        "TEMPLATE_PRICE_RULE_INVALID",
        "TEMPLATE_LEGACY_REVIEW_REQUIRED",
      ],
      description: "校验问题码",
    },
    path: stringField("配置内定位路径"),
    componentKey: optionalString("相关组件稳定键", true),
    message: stringField("问题说明（不含完整 config）"),
  },
  "校验问题",
);

export const genericTemplateRevisionConflictDetailsSchema: OpenApiSchema =
  object(
    [
      "expectedRevision",
      "currentRevision",
      "currentEditor",
      "currentUpdatedAt",
    ],
    {
      expectedRevision: integer("客户端提交的修订号"),
      currentRevision: integer("服务端当前修订号"),
      currentEditor: optionalString("当前编辑人", true),
      currentUpdatedAt: optionalString("当前更新时间", true),
    },
    "修订冲突明细",
  );

export const genericTemplateValidationErrorSchema: OpenApiSchema = object(
  ["code", "message", "details"],
  {
    code: genericTemplateErrorCodeSchema,
    message: stringField("错误说明"),
    details: object(
      ["issues"],
      {
        issues: {
          type: "array",
          items: genericTemplateValidationIssueSchema,
          description: "校验问题列表",
        },
      },
      "校验失败明细",
    ),
  },
  "配置校验失败（422）",
);

export const genericTemplateRevisionConflictErrorSchema: OpenApiSchema = object(
  ["code", "message", "details"],
  {
    code: genericTemplateErrorCodeSchema,
    message: stringField("错误说明"),
    details: genericTemplateRevisionConflictDetailsSchema,
  },
  "修订冲突（409）",
);

export const genericTemplateDeleteRestrictedErrorSchema: OpenApiSchema = object(
  ["code", "message", "details"],
  {
    code: genericTemplateErrorCodeSchema,
    message: stringField("错误说明"),
    details: object(
      ["templateId", "versionCount", "snapshotCount", "orderCount"],
      {
        templateId: stringField("模板 id"),
        versionCount: integer("已存在版本数"),
        snapshotCount: integer("订单快照引用数"),
        orderCount: integer("派单引用数"),
      },
      "删除受限明细",
    ),
  },
  "删除受限（409，应改为归档）",
);

export const genericTemplateErrorSchema: OpenApiSchema = object(
  ["code", "message"],
  {
    code: genericTemplateErrorCodeSchema,
    message: stringField("错误说明"),
    details: {
      type: "object",
      nullable: true,
      additionalProperties: true,
      description: "受控明细（不含 config、订单值或凭据）",
    },
  },
  "受控业务错误（{ code, message, details? }）",
);

export const genericTemplateSaveDraftResultSchema: OpenApiSchema = object(
  ["revision", "updatedAt", "updatedBy", "validationWarnings"],
  {
    revision: integer("保存后的修订号"),
    updatedAt: dateTime("更新时间"),
    updatedBy: stringField("最后修改人"),
    validationWarnings: {
      type: "array",
      items: genericTemplateValidationIssueSchema,
      description: "非阻断提示（阻断问题会直接返回 422）",
    },
  },
  "保存草稿结果",
);

/** restore 额外返回溯源用 sourceVersionId，供后续 publish 回传。 */
export const genericTemplateRestoreResultSchema: OpenApiSchema = object(
  [
    "id",
    "game",
    "name",
    "description",
    "status",
    "activeVersionNo",
    "revision",
    "isDefault",
    "lastUsedAt",
    "updatedAt",
    "updatedBy",
    "hasUnpublishedChanges",
    "config",
    "activeVersion",
    "sourceVersionId",
  ],
  {
    ...genericTemplateDraftViewSchema.properties,
    sourceVersionId: stringField(
      "本次还原的来源版本 id（发布时可作为溯源回传）",
    ),
  },
  "还原结果（草稿视图 + 来源版本）",
);

export const genericTemplateDeleteResultSchema: OpenApiSchema = object(
  ["ok"],
  { ok: bool("是否删除成功") },
  "删除结果",
);

/** S4 新建派单：该游戏可派单的模板摘要（不含 config、不含草稿字段）。 */
export const genericTemplatePublishedSummarySchema: OpenApiSchema = object(
  ["templateId", "name", "versionId", "versionNo", "isDefault", "lastUsedAt"],
  {
    templateId: stringField("模板 id"),
    name: stringField("模板名称"),
    description: {
      type: "string",
      nullable: true,
      description: "模板说明",
    },
    versionId: stringField("锁定的发布版本 id"),
    versionNo: integer("版本号", 1),
    isDefault: bool("是否为该游戏默认模板"),
    lastUsedAt: dateTime("最近使用时间", true),
  },
  "可派单模板摘要",
);

export const genericTemplatePublishedListSchema: OpenApiSchema = {
  ...dataArraySchema(genericTemplatePublishedSummarySchema),
  description: "该游戏可派单的模板（默认优先，其次最近使用）",
};

/** 客户入口第一步：该店可下单的游戏（至少有一个已发布 v2 模板）。 */
export const genericTemplatePublishedGameSummarySchema: OpenApiSchema = object(
  ["gameId", "name"],
  {
    gameId: { type: "string", format: "uuid", description: "游戏 id" },
    name: stringField("游戏名称"),
  },
  "可下单游戏摘要",
);

export const genericTemplatePublishedGameListSchema: OpenApiSchema = {
  ...dataArraySchema(genericTemplatePublishedGameSummarySchema),
  description: "客户可下单的游戏（按名称排序，未归档且有生效版本）",
};

/** S4 派单表单：锁定发布版本的完整发布配置。 */
export const genericTemplateVersionFormSchema: OpenApiSchema = {
  ...dataSchema(
    object(
      ["templateId", "gameId", "versionId", "versionNo", "config"],
      {
        templateId: stringField("模板 id"),
        gameId: {
          type: "string",
          format: "uuid",
          nullable: true,
          description: "所属游戏 id（未归类模板为 null）",
        },
        versionId: stringField("发布版本 id"),
        versionNo: integer("版本号", 1),
        config: genericTemplatePublishedConfigSchema,
      },
      "发布版本派单表单",
    ),
  ),
  description: "锁定发布版本的派单表单配置",
};

/** S4 创建派单：客户端只提交归属与通用组件值，人数与价格一律由服务端计算。 */
export const genericTemplateOrderCreateBodySchema: OpenApiSchema = object(
  ["gameId", "templateId", "templateVersionId", "customerProfileId", "values"],
  {
    gameId: { type: "string", format: "uuid", description: "游戏 id" },
    templateId: { type: "string", format: "uuid", description: "模板 id" },
    templateVersionId: {
      type: "string",
      format: "uuid",
      description: "锁定的发布版本 id",
    },
    customerProfileId: {
      type: "string",
      format: "uuid",
      description: "客户 id",
    },
    values: {
      type: "object",
      additionalProperties: true,
      description: "通用组件值（按 stableKey 提交，不含最终人数或价格）",
    },
    desiredStartAt: dateTime("期望开始时间", true),
    durationMinutes: integer("服务时长（分钟）", 15),
  },
  "创建派单请求（幂等键在 Idempotency-Key 请求头）",
);

/** 客户自助下单入参：与客服端同形状，但**不含** customerProfileId（由登录身份推导）。 */
export const genericTemplateCustomerOrderCreateBodySchema: OpenApiSchema =
  object(
    ["gameId", "templateId", "templateVersionId", "values"],
    {
      gameId: { type: "string", format: "uuid", description: "游戏 id" },
      templateId: { type: "string", format: "uuid", description: "模板 id" },
      templateVersionId: {
        type: "string",
        format: "uuid",
        description: "锁定的发布版本 id",
      },
      values: {
        type: "object",
        additionalProperties: true,
        description: "通用组件值（按 stableKey 提交，不含最终人数或价格）",
      },
      desiredStartAt: dateTime("期望开始时间", true),
      durationMinutes: integer("服务时长（分钟）", 15),
    },
    "客户自助下单请求（不含 customerProfileId；幂等键在 Idempotency-Key 请求头）",
  );

export const genericTemplateOrderResultSchema: OpenApiSchema = {
  ...dataSchema(
    object(
      [
        "orderId",
        "dispatchOrderId",
        "templateVersionId",
        "staffingSummary",
        "priceAdjustmentFen",
        "document",
      ],
      {
        orderId: { type: "string", format: "uuid", description: "订单 id" },
        dispatchOrderId: {
          type: "string",
          format: "uuid",
          description: "派单 id",
        },
        templateVersionId: {
          type: "string",
          format: "uuid",
          description: "本单锁定的发布版本 id",
        },
        staffingSummary: object(
          ["total", "rows"],
          {
            total: integer("服务端计算的总人数", 0),
            rows: {
              type: "array",
              description: "按发布快照分组的人数",
              items: object(
                ["label", "count"],
                {
                  label: stringField("分组名称"),
                  count: integer("人数", 0),
                },
                "人数分组",
              ),
            },
          },
          "服务端计算的人数摘要",
        ),
        priceAdjustmentFen: {
          type: "string",
          description: "服务端计算的加价合计（十进制字符串分）",
        },
        document: object(
          ["schemaVersion", "rendererVersion", "rows", "plainText"],
          {
            schemaVersion: integer("文案结构版本", 1),
            rendererVersion: integer("文案渲染器版本", 1),
            rows: {
              type: "array",
              description: "文案行（区块 / 字段 / 值）",
              items: object(
                ["sectionLabel", "fieldLabel", "value"],
                {
                  sectionLabel: stringField("区块名称"),
                  fieldLabel: stringField("字段名称"),
                  value: stringField("字段值"),
                },
                "文案行",
              ),
            },
            plainText: stringField("可直接复制的纯文本文案"),
          },
          "订单自动文案",
        ),
      },
      "创建派单结果",
    ),
  ),
  description: "创建派单结果（含服务端计算与自动文案）",
};

/**
 * 订单中心列表行（Slice 0）：把列表页真正会读的字段写进契约。
 * 未选中陪玩的订单 `playerName` / `unitPriceFen` / `estimatedAmountFen` 为 null。
 */
export const gameDispatchListRowSchema: OpenApiSchema = object(
  [
    "orderId",
    "dispatchNo",
    "status",
    "durationMinutes",
    "customerProfileId",
    "customerName",
    "playerName",
    "gameName",
    "positionLabel",
    "slotId",
    "reviewedDurationMinutes",
    "reportSubmittedAt",
    "sessionStatus",
    "sessionDurationSeconds",
    "settlementAmountFen",
    "unitPriceFen",
    "estimatedAmountFen",
    "createdAt",
  ],
  {
    orderId: { type: "string", format: "uuid", description: "订单 id" },
    dispatchNo: stringField("派单号"),
    status: stringField("订单状态"),
    durationMinutes: integer("服务时长（分钟）", 1),
    customerProfileId: {
      type: "string",
      format: "uuid",
      description: "老板档案 id",
    },
    customerName: stringField("老板名"),
    playerName: {
      type: "string",
      nullable: true,
      description: "已选中的陪玩名；未选人为 null",
    },
    gameName: {
      type: "string",
      nullable: true,
      description: "游戏名（列表「游戏 / 位置」列）；未归类到游戏的派单为 null",
    },
    positionLabel: {
      type: "string",
      nullable: true,
      description: "该单第一个岗位名（与游戏名同列展示）；没有岗位行为 null",
    },
    slotId: {
      type: "string",
      format: "uuid",
      nullable: true,
      description: "已选中的档位 id（order_slots.id）；未选人为 null",
    },
    reviewedDurationMinutes: {
      type: "integer",
      nullable: true,
      description: "核定分钟（报单审批通过后的生效值）；未报单/未核定为 null",
    },
    reportSubmittedAt: dateTime("报单提交时间（未报单为 null）", true),
    sessionStatus: {
      type: "string",
      nullable: true,
      description: "场次状态（如 ENDED / IN_PROGRESS）；没有场次为 null",
    },
    sessionDurationSeconds: {
      type: "integer",
      nullable: true,
      description: "报单证据计时（秒，仅作对照）；无证据计时为 null",
    },
    settlementAmountFen: {
      ...nonNegativeFen("已核定金额"),
      nullable: true,
      description: "已核定金额合计（分，多档求和）；未核定为 null",
    },
    unitPriceFen: {
      ...nonNegativeFen("档位单价（分/小时）"),
      nullable: true,
      description: "档位单价（分/小时，不乘时长）；未选人为 null",
    },
    estimatedAmountFen: {
      ...nonNegativeFen("预估金额"),
      nullable: true,
      description:
        "按「单价 × 时长 / 60 向上取整」算出的整额（分）；未选人为 null",
    },
    createdAt: dateTime("创建时间", false),
  },
  "派单列表行",
);

/** 订单中心页头汇总（KPI 数字的真实来源）。 */
export const dispatchSummarySchema: OpenApiSchema = dataSchema(
  object(
    ["pendingReportCount", "breachCount", "pendingSettlementAmountFen"],
    {
      pendingReportCount: integer("待审批报单条数"),
      breachCount: integer("违约记录条数"),
      pendingSettlementAmountFen: nonNegativeFen("已核定金额合计"),
    },
    "订单中心页头汇总",
  ),
);

/** 订单中心列表响应：保持 `{ data: [...] }` 形状，并带 `total` 分页元信息。 */
export const gameDispatchListPageSchema: OpenApiSchema = object(
  ["data", "total"],
  {
    data: {
      type: "array",
      description: "当前页派单列表",
      items: gameDispatchListRowSchema,
    },
    total: integer("当前筛选条件下的总条数"),
  },
  "派单列表页",
);

/**
 * S4 订单详情：既有字段（此前未在契约中描述）保持原样，
 * 新增 document 为 v2 订单的自动文案；旧订单为 null。
 */
export const gameDispatchOrderViewSchema: OpenApiSchema = {
  ...dataSchema(
    object(
      [
        "orderId",
        "dispatchOrderId",
        "dispatchNo",
        "status",
        "customerProfileId",
        "templateName",
        "formValues",
        "durationMinutes",
        "desiredStartAt",
        "lines",
        "round",
        "copyText",
        "applyUrl",
        "bossUrl",
        "document",
        "settlement",
      ],
      {
        orderId: { type: "string", format: "uuid", description: "订单 id" },
        dispatchOrderId: {
          type: "string",
          format: "uuid",
          description: "派单 id",
        },
        dispatchNo: stringField("派单号"),
        status: stringField("订单状态"),
        customerProfileId: {
          type: "string",
          format: "uuid",
          description: "客户 id",
        },
        templateName: stringField("模板名称（旧字段，v2 订单可能为空串）"),
        formValues: {
          type: "object",
          additionalProperties: true,
          description: "订单提交值（按 stableKey）",
        },
        durationMinutes: integer("服务时长（分钟）", 1),
        desiredStartAt: dateTime("期望开始时间", true),
        lines: {
          type: "array",
          description: "派单岗位行",
          items: object(
            ["id", "positionLabel", "requiredCount", "applications"],
            {
              id: { type: "string", format: "uuid", description: "岗位行 id" },
              positionLabel: stringField("岗位名称"),
              requiredCount: integer("需要人数", 0),
              applications: {
                type: "array",
                description: "报名记录",
                items: object(
                  [
                    "id",
                    "playerId",
                    "playerName",
                    "positionLabel",
                    "status",
                    "createdAt",
                  ],
                  {
                    id: {
                      type: "string",
                      format: "uuid",
                      description: "报名 id",
                    },
                    playerId: {
                      type: "string",
                      format: "uuid",
                      description: "陪玩 id",
                    },
                    playerName: stringField("陪玩名称"),
                    positionLabel: stringField("报名岗位"),
                    status: stringField("报名状态"),
                    createdAt: dateTime("报名时间"),
                    slotId: {
                      type: "string",
                      format: "uuid",
                      nullable: true,
                      description:
                        "选中后落下的档位 id（商家端「释放名额」入口）；未选中或被释放为 null",
                    },
                    unitPriceFen: {
                      ...nonNegativeFen("该陪玩在本单的单价"),
                      nullable: true,
                      description:
                        "单价（分/小时）= 底价 + 命中加价，不乘时长（设计规格 §3.4）；未设置底价为 null",
                    },
                  },
                  "报名记录",
                ),
              },
            },
            "派单岗位行",
          ),
        },
        round: {
          type: "object",
          nullable: true,
          description: "最新轮次（无轮次时为 null）",
          required: ["roundNo", "opensAt", "closesAt", "status"],
          properties: {
            roundNo: integer("轮次序号", 1),
            opensAt: dateTime("开放时间"),
            closesAt: dateTime("关闭时间"),
            status: stringField("轮次状态"),
          },
        },
        copyText: stringField("派单文案（旧字段）"),
        applyUrl: stringField("陪玩报名链接（旧字段）"),
        bossUrl: stringField("老板选人链接（旧字段）"),
        document: {
          type: "object",
          nullable: true,
          description: "v2 订单自动文案（旧订单为 null）",
          required: [
            "schemaVersion",
            "rendererVersion",
            "rows",
            "plainText",
            "generatedFromSnapshotAt",
          ],
          properties: {
            schemaVersion: integer("文案结构版本", 1),
            rendererVersion: integer("文案渲染器版本", 1),
            rows: {
              type: "array",
              description: "文案行（区块 / 字段 / 值）",
              items: object(
                ["sectionLabel", "fieldLabel", "value"],
                {
                  sectionLabel: stringField("区块名称"),
                  fieldLabel: stringField("字段名称"),
                  value: stringField("字段值"),
                },
                "文案行",
              ),
            },
            plainText: stringField("可直接复制的纯文本文案"),
            generatedFromSnapshotAt: dateTime("快照生成时间"),
          },
        },
        settlement: object(
          [
            "orderAmountFen",
            "playerShareFen",
            "storeProfitFen",
            "storeCutFen",
            "platformFeeFen",
            "splitApplied",
            "approvedSlotCount",
            "activeSlotCount",
          ],
          {
            orderAmountFen: {
              ...nonNegativeFen("老板支出"),
              description:
                "老板支出（分）= 已核定档位的整额合计（ADR-0004 后取分账明细 grossFen），与确认结算的实际扣款额一致",
            },
            playerShareFen: {
              ...nonNegativeFen("陪玩实收"),
              description:
                "陪玩实收（分）= 整额 − 平台费 − 门店抽成（ADR-0004 分账口径；历史行仍是整额）",
            },
            storeProfitFen: {
              ...nonNegativeFen("门店毛利"),
              description: "门店毛利（分）= 支出 − 实收 = 平台费 + 门店抽成",
            },
            storeCutFen: {
              type: "string",
              nullable: true,
              description:
                "门店抽成（分）；历史口径（切换前产生、无分账明细）时为 null，此时 splitApplied=false",
            },
            platformFeeFen: {
              type: "string",
              nullable: true,
              description:
                "平台费（分，ADR-0004 后为 0）；历史口径时为 null，此时 splitApplied=false",
            },
            splitApplied: bool(
              "是否已按费率分账（ADR-0004 起为 true；历史掉队行为 false）",
            ),
            approvedSlotCount: integer("已核定档位数", 0),
            activeSlotCount: integer("生效档位数（不含已释放）", 0),
          },
          "费用口径",
        ),
      },
      "派单详情",
    ),
  ),
  description: "派单详情（含 v2 自动文案）",
};

/**
 * 算价模型（ADR-0003）契约：按游戏的加价规则库 + 陪玩×游戏底价。
 * 金额一律十进制字符串分；命中键 = 模板字段 stableKey + 选项值（如 `mode=ranked`）。
 */
export const gamePricingRuleItemSchema: OpenApiSchema = object(
  ["id", "kind", "dimensionKey", "amountFen", "sortOrder"],
  {
    id: { type: "string", format: "uuid", description: "规则项 id" },
    kind: {
      type: "string",
      enum: ["SURCHARGE", "FIXED"],
      description: "规则类型（本版只写 SURCHARGE；FIXED 保留类型位）",
    },
    dimensionKey: stringField("命中键：字段标识=选项值，如 mode=ranked"),
    amountFen: nonNegativeFen("加价"),
    sortOrder: integer("排序", 0),
  },
  "加价规则项",
);

export const gamePricingRuleViewSchema: OpenApiSchema = {
  ...dataSchema(
    object(
      ["gameId", "enabled", "items", "updatedAt"],
      {
        gameId: { type: "string", format: "uuid", description: "游戏 id" },
        enabled: bool("规则是否启用"),
        items: {
          type: "array",
          description: "该游戏的加价规则项",
          items: gamePricingRuleItemSchema,
        },
        updatedAt: dateTime("最近更新时间；null 表示尚未配置", true),
      },
      "游戏加价规则库",
    ),
  ),
  description: "某游戏的加价规则库（写入为 PUT 整表替换）",
};

export const gamePricingRuleSaveBodySchema: OpenApiSchema = object(
  ["items"],
  {
    enabled: bool("是否启用（缺省启用；停用即整条规则不参与计价）"),
    items: {
      type: "array",
      description: "整表替换的规则项（最多 200 条）",
      items: object(
        ["dimensionKey", "amountFen"],
        {
          kind: {
            type: "string",
            enum: ["SURCHARGE", "FIXED"],
            description: "缺省 SURCHARGE；本版拒绝 FIXED（固定价后续单独立项）",
          },
          dimensionKey: stringField("命中键：字段标识=选项值，如 mode=ranked"),
          amountFen: nonNegativeFen("加价"),
          sortOrder: integer("排序（缺省按数组顺序）", 0),
        },
        "加价规则项入参",
      ),
    },
  },
  "加价规则库写入请求（整表替换）",
);

export const playerGamePriceViewSchema: OpenApiSchema = {
  ...dataSchema(
    object(
      [
        "playerId",
        "gameId",
        "basePricePerHourFen",
        "fallbackBasePricePerHourFen",
        "status",
      ],
      {
        playerId: { type: "string", format: "uuid", description: "陪玩 id" },
        gameId: { type: "string", format: "uuid", description: "游戏 id" },
        basePricePerHourFen: {
          ...nonNegativeFen("陪玩×游戏底价"),
          nullable: true,
          description:
            "陪玩×游戏底价（分/小时）；null 表示未设置，计价时回退到陪玩级兜底",
        },
        fallbackBasePricePerHourFen: {
          ...nonNegativeFen("陪玩级兜底底价"),
          nullable: true,
          description: "陪玩级兜底底价（分/小时）；null 表示也没有兜底",
        },
        status: {
          type: "string",
          enum: ["ACTIVE", "INACTIVE"],
          nullable: true,
          description: "底价状态；null 表示未设置",
        },
      },
      "陪玩×游戏底价",
    ),
  ),
  description: "陪玩在某游戏的底价（含陪玩级兜底，便于显示未设置时会用哪个价）",
};

export const playerGamePriceSaveBodySchema: OpenApiSchema = object(
  ["basePricePerHourFen"],
  {
    basePricePerHourFen: nonNegativeFen("底价（分/小时）"),
    status: {
      type: "string",
      enum: ["ACTIVE", "INACTIVE"],
      description: "缺省 ACTIVE；INACTIVE 时计价回退到陪玩级兜底",
    },
  },
  "陪玩×游戏底价写入请求",
);

/**
 * 算价模型 Task 3 契约：陪玩报单（申报时长 + 截图证据）与客服审批。
 * 金额一律十进制字符串分；证据计时长只作对照，不参与计费。
 */
export const slotReportViewSchema: OpenApiSchema = {
  ...dataSchema(
    object(
      [
        "slotId",
        "sessionId",
        "orderId",
        "playerId",
        "unitPriceFen",
        "reportStatus",
        "declaredDurationMinutes",
        "durationSeconds",
        "reportSubmittedAt",
        "reportReviewedAt",
        "reportReviewedBy",
        "reportReviewNote",
        "earningFen",
      ],
      {
        slotId: { type: "string", format: "uuid", description: "服务档位 id" },
        sessionId: { type: "string", format: "uuid", description: "场次 id" },
        orderId: { type: "string", format: "uuid", description: "订单 id" },
        playerId: { type: "string", format: "uuid", description: "陪玩 id" },
        unitPriceFen: nonNegativeFen("单价（分/小时，下单时落库的快照）"),
        reportStatus: {
          type: "string",
          enum: ["NOT_REPORTED", "PENDING_REVIEW", "APPROVED", "REJECTED"],
          description: "报单状态：未报单 / 待审批 / 已通过 / 已驳回",
        },
        declaredDurationMinutes: {
          type: "integer",
          minimum: 15,
          maximum: 1440,
          nullable: true,
          description: "申报（或客服核定后）的总时长（分钟）",
        },
        durationSeconds: {
          type: "integer",
          minimum: 0,
          nullable: true,
          description: "证据计时长（秒），仅作对照，本版不做自动比对",
        },
        reportSubmittedAt: dateTime("报单提交时间", true),
        reportReviewedAt: dateTime("客服审批时间", true),
        reportReviewedBy: {
          type: "string",
          format: "uuid",
          nullable: true,
          description: "审批人账号 id",
        },
        reportReviewNote: {
          type: "string",
          nullable: true,
          description: "审批备注 / 时长修正理由",
        },
        earningFen: {
          ...nonNegativeFen("审批后落库的实收金额"),
          nullable: true,
          description: "审批通过后的金额（分）；未通过审批为 null",
        },
      },
      "报单与客服审批状态",
    ),
  ),
  description: "报单与客服审批状态（金额以审批后的 SlotEarning 为准）",
};

/** 陪玩提交报单：只提交申报总时长，截图先走证据通道。 */
export const slotReportSubmitBodySchema: OpenApiSchema = object(
  ["declaredDurationMinutes"],
  {
    declaredDurationMinutes: {
      type: "integer",
      minimum: 15,
      maximum: 1440,
      description: "申报总时长（分钟，15–1440）",
    },
  },
  "陪玩提交报单",
);

/** 客服审批：可修正时长（修正后按修正值计费），reason 同时作为审批留痕。 */
export const slotReportReviewBodySchema: OpenApiSchema = object(
  ["approve"],
  {
    approve: bool("是否通过；false 为驳回（不产生金额，可重新报单）"),
    declaredDurationMinutes: {
      type: "integer",
      minimum: 15,
      maximum: 1440,
      description: "客服修正后的核定时长（分钟）；缺省沿用申报值",
    },
    reason: optionalString("修正理由 / 审批备注", true),
  },
  "客服审批报单",
);

/**
 * 算价模型 Task 4 契约：陪玩端报名大厅 / 我的报名、商家释放名额与违约记录。
 * 金额不出现在这些 schema 里（单价与金额由报单与结算链路返回）。
 */
export const playerHallLineSchema: OpenApiSchema = object(
  [
    "lineId",
    "positionLabel",
    "requiredCount",
    "appliedCount",
    "myApplicationId",
    "myApplicationStatus",
  ],
  {
    lineId: { type: "string", format: "uuid", description: "位置行 id" },
    positionLabel: stringField("岗位名称"),
    requiredCount: integer("需要人数", 0),
    appliedCount: integer("当前报名人数（APPLIED）", 0),
    myApplicationId: {
      type: "string",
      format: "uuid",
      nullable: true,
      description: "我在该行的报名 id；未报名为 null",
    },
    myApplicationStatus: {
      type: "string",
      nullable: true,
      description: "我在该行的报名状态（APPLIED/SELECTED/…）；未报名为 null",
    },
  },
  "报名大厅位置行",
);

export const playerHallOrderViewSchema: OpenApiSchema = object(
  [
    "orderId",
    "dispatchNo",
    "orderNo",
    "durationMinutes",
    "desiredStartAt",
    "roundClosesAt",
    "lines",
  ],
  {
    orderId: { type: "string", format: "uuid", description: "订单 id" },
    dispatchNo: stringField("派单号"),
    orderNo: stringField("订单号"),
    durationMinutes: integer("服务时长（分钟）", 1),
    desiredStartAt: dateTime("期望开始时间", true),
    roundClosesAt: dateTime("本轮报名截止时间", true),
    unitPriceFen: {
      ...nonNegativeFen("我的单价"),
      nullable: true,
      description:
        "单价（分/小时，不乘时长）：底价 + 命中加价；未设置底价为 null",
    },
    lines: {
      type: "array",
      description: "可报名的位置行",
      items: playerHallLineSchema,
    },
  },
  "报名大厅订单",
);

export const playerApplicationViewSchema: OpenApiSchema = object(
  [
    "applicationId",
    "orderId",
    "dispatchNo",
    "orderNo",
    "orderStatus",
    "lineId",
    "positionLabel",
    "status",
    "createdAt",
    "slotId",
    "canWithdraw",
  ],
  {
    applicationId: { type: "string", format: "uuid", description: "报名 id" },
    orderId: { type: "string", format: "uuid", description: "订单 id" },
    dispatchNo: stringField("派单号"),
    orderNo: stringField("订单号"),
    orderStatus: stringField("订单状态"),
    lineId: { type: "string", format: "uuid", description: "位置行 id" },
    positionLabel: stringField("岗位名称"),
    status: stringField("报名状态"),
    createdAt: dateTime("报名时间"),
    slotId: {
      type: "string",
      format: "uuid",
      nullable: true,
      description:
        "选中后落下的档位 id（开始/结束服务与报单入口）；未选中为 null",
    },
    canWithdraw: bool("是否可自助取消（未选中且报名仍为 APPLIED）"),
    unitPriceFen: {
      ...nonNegativeFen("单价"),
      nullable: true,
      description:
        "单价（分/小时，不乘时长）：选中后取档位快照价，未选中按当前规则库计算；未设置底价为 null",
    },
  },
  "我的报名",
);

export const slotReleaseBodySchema: OpenApiSchema = object(
  [],
  { reason: optionalString("释放原因（写入审计留痕）", true) },
  "释放名额请求",
);

export const slotReleaseViewSchema: OpenApiSchema = {
  ...dataSchema(
    object(
      ["slotId", "orderId", "playerId", "orderStatus", "roundNo", "releasedAt"],
      {
        slotId: { type: "string", format: "uuid", description: "档位 id" },
        orderId: { type: "string", format: "uuid", description: "订单 id" },
        playerId: {
          type: "string",
          format: "uuid",
          description: "被释放的陪玩 id",
        },
        orderStatus: stringField("释放后的订单状态（回到 DISPATCHING）"),
        roundNo: integer("重开的报名轮次号", 1),
        releasedAt: dateTime("释放时间"),
      },
      "释放名额结果",
    ),
  ),
  description: "释放名额结果（档位标记 RELEASED，订单回到报名阶段并重开一轮）",
};

/** P3 / D1：选人请求体——applicationIds 必填，fixedPrices 为可选「本单固定价」。 */
export const assignmentBodySchema: OpenApiSchema = object(
  ["applicationIds"],
  {
    applicationIds: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: { type: "string", format: "uuid" },
      description: "本次选中的报名 id",
    },
    fixedPrices: {
      type: "array",
      maxItems: 100,
      description:
        "可选：本单固定价（分/小时，整数十进制字符串，1–1000000），命中即覆盖算法单价（ADR-0006）",
      items: object(
        ["applicationId", "unitPriceFen"],
        {
          applicationId: {
            type: "string",
            format: "uuid",
            description: "必须属于本次 applicationIds",
          },
          unitPriceFen: {
            type: "string",
            pattern: "^(?:0|[1-9][0-9]*)$",
            description: "固定单价（分/小时），1–1000000，整数十进制字符串",
          },
        },
        "固定价条目",
      ),
    },
  },
  "选人请求体",
);

export const playerBreachBodySchema: OpenApiSchema = object(
  ["playerId", "reason"],
  {
    playerId: { type: "string", format: "uuid", description: "违约陪玩 id" },
    orderSlotId: {
      type: "string",
      format: "uuid",
      nullable: true,
      description: "相关档位 id（可选，必须属于该订单与陪玩）",
    },
    reason: stringField("违约事由（必填，写入审计与通知）"),
  },
  "记录违约请求",
);

/** 单条违约记录（列表与写入响应共用同一个条目 schema）。 */
export const playerBreachItemSchema: OpenApiSchema = object(
  [
    "id",
    "playerId",
    "playerName",
    "orderId",
    "orderSlotId",
    "reason",
    "createdAt",
  ],
  {
    id: { type: "string", format: "uuid", description: "违约记录 id" },
    playerId: { type: "string", format: "uuid", description: "陪玩 id" },
    playerName: stringField("陪玩名称"),
    orderId: { type: "string", format: "uuid", description: "订单 id" },
    orderSlotId: {
      type: "string",
      format: "uuid",
      nullable: true,
      description: "相关档位 id；未关联为 null",
    },
    reason: stringField("违约事由"),
    createdAt: dateTime("记录时间"),
  },
  "违约记录",
);

export const playerBreachViewSchema: OpenApiSchema = {
  ...dataSchema(playerBreachItemSchema),
  description: "违约记录（同时写审计并经 Outbox 通知老板）",
};

/** 资金账户类型（四种精确枚举值，顺序与 DS-002 契约一致）。 */
export const fundAccountKindSchema: OpenApiSchema = {
  type: "string",
  enum: ["WECHAT_SETTLEMENT", "BANK", "CASH", "OFFLINE"],
  description: "资金账户类型",
};

/** 资金账户状态（本任务只创建 ACTIVE，不提供归档入口）。 */
export const fundAccountStatusSchema: OpenApiSchema = {
  type: "string",
  enum: ["ACTIVE", "ARCHIVED"],
  description: "资金账户状态",
};

/** DS-002 创建资金账户请求体；code 规范化（trim 转大写）后必须匹配 pattern。 */
export const createFundAccountBodySchema: OpenApiSchema = object(
  ["code", "name", "kind"],
  {
    code: {
      type: "string",
      pattern: "^[A-Za-z][A-Za-z0-9_]{1,31}$",
      example: "WECHAT_MAIN",
      description:
        "账户编码（服务端 trim 并转大写，规范化后须符合 ^[A-Z][A-Z0-9_]{1,31}$，每租户唯一）",
    },
    name: stringField("账户名称（去空白后 1-64 字符）"),
    kind: fundAccountKindSchema,
    externalRef: {
      type: "string",
      nullable: true,
      description:
        "外部引用（可空；BANK 账户非空时必须包含 * 掩码，不得存完整卡号）",
    },
  },
  "创建资金账户请求体",
);

/** 资金账户视图：仅契约字段，不含 tenantId、余额、流水、日结与对账数据。 */
export const fundAccountViewSchema: OpenApiSchema = object(
  ["id", "code", "name", "kind", "status", "externalRef", "createdAt"],
  {
    id: { type: "string", format: "uuid", description: "资金账户 id" },
    code: stringField("账户编码"),
    name: stringField("账户名称"),
    kind: fundAccountKindSchema,
    status: fundAccountStatusSchema,
    externalRef: {
      type: "string",
      nullable: true,
      description: "外部引用；未传或空白为 null",
    },
    createdAt: dateTime("创建时间"),
  },
  "资金账户视图",
);

/** GET /api/v1/tenant/funds/accounts 响应：{ data: { items: FundAccountView[] } }。 */
export const fundAccountListSchema: OpenApiSchema = dataSchema(
  object(
    ["items"],
    {
      items: {
        type: "array",
        items: fundAccountViewSchema,
        description: "当前服务端租户的资金账户（按 createdAt 升序）",
      },
    },
    "资金账户列表",
  ),
);

/* -------------------------------------------------------------------------- */
/* DS-008：统一资金台账（只读）列表与 CSV 导出                                   */
/* -------------------------------------------------------------------------- */

/** 台账事件类型：与 Prisma `LedgerEventType` 逐一对应。 */
export const fundLedgerEventTypeSchema: OpenApiSchema = {
  type: "string",
  enum: [
    "ORDER_ACCOUNTING",
    "PAYMENT_CONFIRMED",
    "WALLET_CONSUMED",
    "REFUND_CONFIRMED",
    "PLAYER_PAYOUT_CONFIRMED",
    "RECONCILIATION_ADJUSTMENT",
    "REVERSAL",
  ],
  description: "台账事件类型",
};

/** 交易状态：与 Prisma `LedgerTransactionStatus` 逐一对应。 */
export const fundLedgerTransactionStatusSchema: OpenApiSchema = {
  type: "string",
  enum: ["DRAFT", "CONFIRMED", "RECONCILED", "REVERSED"],
  description: "交易状态",
};

/** 对账状态展示映射：只有 RECONCILED 交易算已对账；原始 status 同时返回。 */
export const fundLedgerReconciliationStatusSchema: OpenApiSchema = {
  type: "string",
  enum: ["RECONCILED", "UNRECONCILED"],
  description: "对账状态展示值（只有 RECONCILED 交易算已对账）",
};

/** 资金流方向：`null` = 没有挂接交易头资金账户的分录；两种方向都有为 MIXED。 */
export const fundFlowDirectionSchema: OpenApiSchema = {
  type: "string",
  enum: ["DEBIT", "CREDIT", "MIXED"],
  nullable: true,
  description: "资金流方向；无匹配分录为 null，借贷都有为 MIXED",
};

/** 辅助核算引用（去重并按 (type, id) 升序后的最小追溯维度）。 */
export const fundLedgerAuxiliaryRefSchema: OpenApiSchema = object(
  ["type", "id"],
  {
    type: stringField("辅助核算类型（如 customer_profile）"),
    id: { type: "string", description: "辅助核算对象 id" },
  },
  "辅助核算引用",
);

/** 交易头资金账户引用；交易头未挂账户或账户不存在时为 `null`。 */
export const fundLedgerFundAccountRefSchema: OpenApiSchema = object(
  ["id", "code", "name", "kind", "status"],
  {
    id: { type: "string", format: "uuid", description: "资金账户 id" },
    code: stringField("账户编码"),
    name: stringField("账户名称"),
    kind: fundAccountKindSchema,
    status: fundAccountStatusSchema,
  },
  "交易头资金账户引用",
);

/** 台账行视图：金额为十进制字符串分，时间为 ISO 8601，可空字段显式 nullable。 */
export const fundLedgerRowSchema: OpenApiSchema = object(
  [
    "transactionId",
    "txNo",
    "eventType",
    "status",
    "reconciliationStatus",
    "sourceType",
    "sourceId",
    "description",
    "amountFen",
    "debitFen",
    "creditFen",
    "balanced",
    "fundFlowDirection",
    "fundAccount",
    "auxiliaries",
    "createdBy",
    "confirmedBy",
    "occurredAt",
    "confirmedAt",
    "createdAt",
  ],
  {
    transactionId: { type: "string", format: "uuid", description: "交易 id" },
    txNo: stringField("交易号"),
    eventType: { ...fundLedgerEventTypeSchema, nullable: true },
    status: fundLedgerTransactionStatusSchema,
    reconciliationStatus: fundLedgerReconciliationStatusSchema,
    sourceType: optionalString("来源类型；无来源为 null", true),
    sourceId: optionalString("来源单据 id；无来源为 null", true),
    description: optionalString("摘要；无摘要为 null", true),
    amountFen: nonNegativeFen("金额（该交易借方分录合计）"),
    debitFen: nonNegativeFen("借方合计"),
    creditFen: nonNegativeFen("贷方合计"),
    balanced: bool("借贷是否平衡（借方合计 = 贷方合计且大于 0）"),
    fundFlowDirection: fundFlowDirectionSchema,
    fundAccount: { ...fundLedgerFundAccountRefSchema, nullable: true },
    auxiliaries: {
      type: "array",
      items: fundLedgerAuxiliaryRefSchema,
      description: "去重并按 (type, id) 升序的辅助核算引用",
    },
    createdBy: optionalString("创建人 id；无记录为 null", true),
    confirmedBy: optionalString("确认人 id；未确认为 null", true),
    occurredAt: dateTime("发生时间"),
    confirmedAt: dateTime("确认时间；未确认为 null", true),
    createdAt: dateTime("创建时间"),
  },
  "统一资金台账交易行",
);

/** 列表视图：分页、排序与总数回显（导出端点不返回该结构）。 */
export const fundLedgerViewSchema: OpenApiSchema = object(
  ["rows", "total", "page", "pageSize", "sortBy", "sortDir"],
  {
    rows: {
      type: "array",
      items: fundLedgerRowSchema,
      description: "当前页交易行",
    },
    total: integer("同一筛选条件下的交易总数（不受 pageSize 影响）", 0),
    page: { type: "integer", minimum: 1, description: "页码（1 起算）" },
    pageSize: {
      type: "integer",
      minimum: 1,
      maximum: 200,
      description: "每页条数（上限 200）",
    },
    sortBy: {
      type: "string",
      enum: ["occurredAt", "confirmedAt", "createdAt", "amountFen", "txNo"],
      description: "排序字段（默认 occurredAt）",
    },
    sortDir: {
      type: "string",
      enum: ["asc", "desc"],
      description: "排序方向（默认 desc）",
    },
  },
  "统一资金台账分页视图",
);

/** GET /api/v1/tenant/funds/ledger 响应：{ data: FundLedgerView }。 */
export const fundLedgerResponseSchema: OpenApiSchema =
  dataSchema(fundLedgerViewSchema);

/** 事件类型查询参数（列表与导出共用同一份 schema，避免契约漂移）。 */
export const fundLedgerEventTypeQuerySchema: SchemaProperty = {
  type: "string",
  enum: [
    "ORDER_ACCOUNTING",
    "PAYMENT_CONFIRMED",
    "WALLET_CONSUMED",
    "REFUND_CONFIRMED",
    "PLAYER_PAYOUT_CONFIRMED",
    "RECONCILIATION_ADJUSTMENT",
    "REVERSAL",
  ],
  description: "单个合法 LedgerEventType（精确匹配）",
};

/** 交易状态查询参数。 */
export const fundLedgerStatusQuerySchema: SchemaProperty = {
  type: "string",
  enum: ["DRAFT", "CONFIRMED", "RECONCILED", "REVERSED"],
  description: "单个合法 LedgerTransactionStatus（精确匹配）",
};

/** 交易头资金账户 id 查询参数。 */
export const fundLedgerFundAccountIdQuerySchema: SchemaProperty = {
  type: "string",
  format: "uuid",
  description: "按交易头资金账户过滤（uuid）",
};

/** 来源类型查询参数（trim 后 1–64 字符，精确匹配）。 */
export const fundLedgerSourceTypeQuerySchema: SchemaProperty = {
  type: "string",
  minLength: 1,
  maxLength: 64,
  description: "来源类型（trim 后 1–64 字符，精确匹配）",
};

/** 关键词查询参数（trim 后 1–50 字符；只有空白按未提供处理）。 */
export const fundLedgerSearchQuerySchema: SchemaProperty = {
  type: "string",
  minLength: 1,
  maxLength: 50,
  description:
    "关键词（单号/摘要/来源/资金账户编码或名称的包含匹配，trim 后 ≤50 字符）",
};

/** 发生时间下界（含）。 */
export const fundLedgerOccurredFromQuerySchema: SchemaProperty = {
  type: "string",
  format: "date-time",
  description: "发生时间下界，ISO 8601 带时区，含边界",
};

/** 发生时间上界（不含）。 */
export const fundLedgerOccurredToQuerySchema: SchemaProperty = {
  type: "string",
  format: "date-time",
  description: "发生时间上界，ISO 8601 带时区，不含边界且必须晚于 occurredFrom",
};

/** 金额下界（十进制字符串分，非负，含）。 */
export const fundLedgerMinAmountFenQuerySchema: SchemaProperty = {
  type: "string",
  pattern: "^(?:0|[1-9][0-9]*)$",
  description: "金额下界（十进制字符串分，非负，含边界）",
};

/** 金额上界（十进制字符串分，非负，含）。 */
export const fundLedgerMaxAmountFenQuerySchema: SchemaProperty = {
  type: "string",
  pattern: "^(?:0|[1-9][0-9]*)$",
  description: "金额上界（十进制字符串分，非负，含边界且不得小于下界）",
};

/** 排序字段查询参数。 */
export const fundLedgerSortByQuerySchema: SchemaProperty = {
  type: "string",
  enum: ["occurredAt", "confirmedAt", "createdAt", "amountFen", "txNo"],
  description: "排序字段（默认 occurredAt）",
};

/** 排序方向查询参数。 */
export const fundLedgerSortDirQuerySchema: SchemaProperty = {
  type: "string",
  enum: ["asc", "desc"],
  description: "排序方向（默认 desc）",
};

/** 页码查询参数（列表专用；导出不接受 page/pageSize）。 */
export const fundLedgerPageQuerySchema: SchemaProperty = {
  type: "integer",
  minimum: 1,
  description: "页码（1 起算，默认 1）",
};

/** 每页条数查询参数（列表专用；导出不接受 page/pageSize）。 */
export const fundLedgerPageSizeQuerySchema: SchemaProperty = {
  type: "integer",
  minimum: 1,
  maximum: 200,
  description: "每页条数（1-200，默认 50）",
};

/**
 * 通用 HTTP 错误响应：全局 `HttpErrorFilter` 实际写出的结构（RFC9457 风格 + 兼容 `message`）。
 *
 * 与 `genericTemplateErrorSchema` 的区别：后者是**控制器自行序列化**的受控业务错误
 * （`{ code, message, details? }`，`code` 是业务枚举）；本 schema 描述异常过滤器兜底写出的
 * 通用结构——`code` 为异常类名，并带 `type`/`title`/`status`/`requestId`。
 * 只要 `HttpException` 的 body 带 `{ code, message }`，过滤器就会原样透传到响应里。
 */
export const httpErrorSchema: OpenApiSchema = object(
  ["type", "title", "status", "code", "message", "requestId"],
  {
    type: stringField("错误类型标识（RFC9457，如 about:blank#http-error）"),
    title: stringField("HTTP 状态短语（如 Bad Request）"),
    status: integer("HTTP 状态码"),
    code: stringField("错误代码（异常类名，如 FundLedgerInputError）"),
    message: stringField("错误说明（面向调用方，可直接展示）"),
    requestId: stringField("请求 id（服务端追踪用；缺失时为空串）"),
  },
  "通用 HTTP 错误响应（全局 HttpErrorFilter 写出）",
);

/** DS-012：对账处理单状态。六个值与 DS-010 领域状态机、Prisma 枚举逐字符一致（大小写敏感）。 */
export const reconciliationCaseStatusSchema: OpenApiSchema = {
  type: "string",
  enum: [
    "OPEN",
    "CLAIMED",
    "PROCESSING",
    "PENDING_REVIEW",
    "CLOSED",
    "IGNORED",
  ],
  description: "对账处理单状态",
};

/** DS-012：处理单内嵌的对账差异（不可由 UI 改写的原始事实，只读引用）。 */
export const reconciliationCaseDifferenceSchema: OpenApiSchema = object(
  [
    "kind",
    "kindLabel",
    "amountFen",
    "detail",
    "paymentOrderId",
    "resolvedAt",
    "createdAt",
  ],
  {
    kind: stringField("差异类型原始值（如 AMOUNT_MISMATCH）"),
    kindLabel: stringField("差异类型中文说明；认不出的类型原样点名"),
    amountFen: {
      ...nonNegativeFen("差异金额"),
      nullable: true,
      description: "差异金额（十进制字符串分；状态类差异为 null）",
    },
    detail: optionalString("差异说明；无说明为 null", true),
    paymentOrderId: optionalString("关联支付单 id；无关联为 null", true),
    resolvedAt: dateTime("差异解决时间；未解决为 null", true),
    createdAt: dateTime("差异创建时间"),
  },
  "对账差异引用",
);

/**
 * DS-012：对账处理单行。**不含** `tenantId`；也不含处理人显示名、可执行动作或关联交易详情——
 * 本切片只暴露这一张处理单自身的字段。
 */
export const reconciliationCaseRowSchema: OpenApiSchema = object(
  [
    "id",
    "differenceId",
    "status",
    "ownerId",
    "resolutionType",
    "resolutionNote",
    "linkedTransactionId",
    "reviewedBy",
    "reviewedAt",
    "closedAt",
    "createdAt",
    "updatedAt",
    "version",
    "difference",
  ],
  {
    id: { type: "string", format: "uuid", description: "处理单 id" },
    differenceId: {
      type: "string",
      format: "uuid",
      description: "对账差异 id（一条差异最多一张处理单）",
    },
    status: reconciliationCaseStatusSchema,
    ownerId: optionalString("当前处理人 id；未认领为 null", true),
    resolutionType: optionalString(
      "处理结果类型；未处理为 null（取值不在本切片约束）",
      true,
    ),
    resolutionNote: optionalString("处理说明；无说明为 null", true),
    linkedTransactionId: optionalString(
      "关联的调整/冲销交易 id；无关联为 null",
      true,
    ),
    reviewedBy: optionalString("复核人 id；未复核为 null", true),
    reviewedAt: dateTime("复核时间；未复核为 null", true),
    closedAt: dateTime("关闭时间；未关闭为 null", true),
    createdAt: dateTime("创建时间"),
    updatedAt: dateTime("更新时间"),
    version: integer("乐观锁版本号", 1),
    difference: reconciliationCaseDifferenceSchema,
  },
  "对账处理单",
);

/** DS-012：对账处理单分页视图（排序固定 `createdAt DESC, id DESC`，不随请求变化）。 */
export const reconciliationCaseViewSchema: OpenApiSchema = object(
  ["rows", "total", "page", "pageSize"],
  {
    rows: {
      type: "array",
      items: reconciliationCaseRowSchema,
      description: "当前页处理单",
    },
    total: integer("同一筛选条件下的处理单总数（不受 pageSize 影响）", 0),
    page: { type: "integer", minimum: 1, description: "页码（1 起算）" },
    pageSize: {
      type: "integer",
      minimum: 1,
      // 与 RECONCILIATION_CASE_MAX_PAGE_SIZE 一致：本文件不引入依赖，故写字面量。
      maximum: 100,
      description: "每页条数（1-100）",
    },
  },
  "对账处理单分页视图",
);

/** GET /api/v1/tenant/reconciliation/cases 响应：{ data: ReconciliationCaseView }。 */
export const reconciliationCaseResponseSchema: OpenApiSchema = dataSchema(
  reconciliationCaseViewSchema,
);

/** 状态过滤查询参数：一个精确状态，缺省不过滤（空白、数组、小写别名在服务层被拒）。 */
export const reconciliationCaseStatusQuerySchema: SchemaProperty = {
  type: "string",
  enum: [
    "OPEN",
    "CLAIMED",
    "PROCESSING",
    "PENDING_REVIEW",
    "CLOSED",
    "IGNORED",
  ],
  description: "状态过滤（大小写敏感；缺省不过滤）",
};

/** 页码查询参数：服务端按规范十进制正整数字符串校验（`0`、前导零、符号、小数一律 400）。 */
export const reconciliationCasePageQuerySchema: SchemaProperty = {
  type: "integer",
  minimum: 1,
  description: "页码（1 起算，默认 1）",
};

/** 每页条数查询参数：与 RECONCILIATION_CASE_MAX_PAGE_SIZE 一致的上限。 */
export const reconciliationCasePageSizeQuerySchema: SchemaProperty = {
  type: "integer",
  minimum: 1,
  maximum: 100,
  description: "每页条数（1-100，默认 20）",
};

/**
 * DS-013：处理单命令的路径参数（`reconciliation_cases.id`）。
 * 与既有退款确认命令同一口径：形状不对在服务层拦成 400，不把客户端输入错误放进 Prisma。
 */
export const reconciliationCaseIdParamSchema: SchemaProperty = {
  type: "string",
  format: "uuid",
  description: "对账处理单 id（单个规范 UUID，不接受空白或换行）",
};

/**
 * DS-013：处理单命令请求体。
 *
 * **只允许 `expectedVersion` 一个字段**（`additionalProperties: false`）——服务层会拒绝多余字段，
 * 契约里就不把「多传字段也合法」画成允许；`minimum: 1` 对应「版本号自 1 起算」。
 * 目标状态、处理人、租户都**不**在请求体里：目标状态由命令路径决定，处理人与租户只来自登录态。
 */
export const reconciliationCaseTransitionCommandSchema: OpenApiSchema = {
  type: "object",
  required: ["expectedVersion"],
  additionalProperties: false,
  properties: {
    expectedVersion: integer(
      "客户端当前看到的处理单版本号（乐观锁；与库内不一致即 409）",
      1,
    ),
  },
  description: "对账处理单命令请求体（只接受 expectedVersion 一个字段）",
};

/**
 * 处理说明 / 忽略理由：与运行期 `RECONCILIATION_NOTE_{MIN,MAX}_CODE_POINTS` 同一口径
 * （先 trim，再按 **Unicode 码位**计 1-500，拒绝控制字符）。
 *
 * `minLength`/`maxLength` 只是给调用方的提示：运行期校验才是权威——
 * 「500 个 emoji」这类用例不是 schema 能替你挡的。
 */
const reconciliationNoteProperty: SchemaProperty = {
  type: "string",
  minLength: 1,
  maxLength: 500,
  description:
    "处理说明 / 忽略理由（先 trim 再计长，1-500 个 Unicode 码位；不接受控制字符或换行）",
};

/** 关联的统一账本交易 id：规范 UUID，且必须是**本租户已确认**的既有交易。 */
const reconciliationLinkedTransactionIdProperty: SchemaProperty = {
  type: "string",
  format: "uuid",
  description: "关联的统一账本交易 id（必须是本租户 CONFIRMED 的既有交易）",
};

/**
 * DS-014 提交复核请求体：按 `resolutionType` 判别的**两个完整分支**。
 *
 * 每个分支都是独立、完整且互斥的对象 schema，各自 `additionalProperties: false`：
 * - `NO_LEDGER_CHANGE`：`linkedTransactionId` **不在** `properties` 里，配合
 *   `additionalProperties: false` 就是**禁止**——不是「允许但忽略」，多写一个键即非法；
 * - `LEDGER_TRANSACTION`：`linkedTransactionId` 进 `required`，缺了即非法。
 *
 * 两个分支的 `const` 互斥，命中且只命中一个（判别联合的标准形状，与
 * `genericTemplateComponentSchema` 同一写法）。这里只描述**请求**词表：落库列
 * `resolution_type` 是自由 TEXT，忽略命令会往里写内部字面量 `IGNORED`，
 * 那个值不在本端点的分支里，只能由 ignore 命令产生。
 *
 * 契约与运行期同口径：服务层对这两种组合的取舍完全一致（不从宽也不从紧），
 * 这里的 `const`/`required`/`additionalProperties` 只是把运行期规则提前告诉调用方。
 */
export const reconciliationCaseSubmitReviewCommandSchema: OpenApiSchema = {
  oneOf: [
    {
      ...object(
        ["expectedVersion", "resolutionType", "resolutionNote"],
        {
          expectedVersion: integer(
            "客户端当前看到的处理单版本号（乐观锁；与库内不一致即 409）",
            1,
          ),
          resolutionType: {
            type: "string",
            const: "NO_LEDGER_CHANGE",
            description: "账目无需改动（本分支禁止携带 linkedTransactionId）",
          },
          resolutionNote: reconciliationNoteProperty,
        },
        "无需改账分支（不接受 linkedTransactionId，多传该键即非法）",
      ),
      additionalProperties: false,
    },
    {
      ...object(
        [
          "expectedVersion",
          "resolutionType",
          "resolutionNote",
          "linkedTransactionId",
        ],
        {
          expectedVersion: integer(
            "客户端当前看到的处理单版本号（乐观锁；与库内不一致即 409）",
            1,
          ),
          resolutionType: {
            type: "string",
            const: "LEDGER_TRANSACTION",
            description:
              "关联既有账本交易（本分支必须携带 linkedTransactionId）",
          },
          resolutionNote: reconciliationNoteProperty,
          linkedTransactionId: reconciliationLinkedTransactionIdProperty,
        },
        "关联既有交易分支（必须携带本租户 CONFIRMED 交易的 id）",
      ),
      additionalProperties: false,
    },
  ],
  discriminator: { propertyName: "resolutionType" },
  description:
    "提交复核请求体（判别联合：resolutionType 决定 linkedTransactionId 必须缺席还是必须携带）",
};

/**
 * DS-014 忽略请求体：理由必填，与运行期同一口径。
 *
 * 词表里只有 `expectedVersion` 与 `reason` 两个字段：忽略人、时间戳、落库用的
 * `resolutionType` 一律**不接受**客户端提交（第一个不在本切片，后两个由服务端决定）。
 */
export const reconciliationCaseIgnoreCommandSchema: OpenApiSchema = {
  type: "object",
  required: ["expectedVersion", "reason"],
  additionalProperties: false,
  properties: {
    expectedVersion: integer(
      "客户端当前看到的处理单版本号（乐观锁；与库内不一致即 409）",
      1,
    ),
    reason: reconciliationNoteProperty,
  },
  description: "忽略请求体（只接受 expectedVersion 与 reason 两个字段）",
};

/**
 * DS-013 命令成功响应：`{ data: ReconciliationCaseRow }`——与列表里的行**同一个** schema，
 * 命令成功后就地返回推进后的处理单，不另造一套「命令结果」结构。
 */
export const reconciliationCaseRowResponseSchema: OpenApiSchema = dataSchema(
  reconciliationCaseRowSchema,
);

/** OpenAPI 内联 schema 常量。金额一律 decimal-string 分（MoneyFen），禁止 number/浮点（主规格 10.5/12.1）。 */

interface SchemaProperty {
  type?: string;
  format?: string;
  nullable?: boolean;
  example?: string | number | boolean;
  pattern?: string;
  description?: string;
  minimum?: number;
  items?: unknown;
  properties?: Record<string, unknown>;
  required?: string[];
  oneOf?: unknown[];
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
  description: "模板组件（判别联合，按 kind 区分）",
};

/** 人数来源判别联合：FIXED / NUMBER_FIELD / REPEATABLE_TABLE_SUM。 */
export const genericTemplateStaffingSourceSchema: OpenApiSchema = {
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

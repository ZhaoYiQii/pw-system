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
}

export interface OpenApiSchema {
  type?: string;
  format?: string;
  nullable?: boolean;
  description?: string;
  required?: string[];
  properties?: Record<string, unknown>;
  items?: OpenApiSchema;
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

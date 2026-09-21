import { z } from "zod";
import {
  durationSeconds,
  fenMoney,
  positiveFenMoney,
} from "./api-input.schemas.js";
import { GAME_TEMPLATE_V2_LIMITS } from "../../modules/game-dispatch/domain/game-template-config-v2.js";
import { routeValidations } from "./validation-registry.js";

const nonEmptyText = (label: string, max: number) =>
  z.string().trim().min(1).max(max, `${label} 超长`);

/** P3 / D3：台账时间范围入参（ISO 8601 带时区 → Date）。 */
const isoInstant = z
  .string()
  .datetime({ offset: true, message: "需为 ISO 8601 时间" })
  .transform((value) => new Date(value));

const nullableText = (label: string, max: number) =>
  z.string().trim().max(max, `${label} 超长`).nullable().optional();

const statusEnum = z.enum(["ACTIVE", "INACTIVE"]);

routeValidations.set("POST /api/v1/auth/login", {
  body: z.strictObject({
    kind: z.enum(["platform", "tenant"]),
    username: z.string().min(1),
    password: z.string().min(1),
    tenantCode: z.string().min(1).optional(),
  }),
});

routeValidations.set("POST /api/v1/auth/refresh", {
  body: z.strictObject({
    scope: z.enum(["platform", "tenant"]),
  }),
});

routeValidations.set("POST /api/v1/platform/tenants", {
  body: z.strictObject({
    code: z.string().trim().min(1).max(40),
    name: nonEmptyText("name", 100),
    timezone: z.string().min(1).optional(),
    primaryHost: z.string().min(1).optional(),
  }),
});

routeValidations.set("POST /api/v1/tenant/customers", {
  body: z.strictObject({
    name: nonEmptyText("name", 60),
    mobile: nullableText("mobile", 32),
    remark: nullableText("remark", 500),
  }),
});

routeValidations.set("PATCH /api/v1/tenant/customers/:id", {
  body: z.strictObject({
    name: nonEmptyText("name", 60).optional(),
    mobile: nullableText("mobile", 32),
    remark: nullableText("remark", 500),
    status: statusEnum.optional(),
  }),
});

routeValidations.set("POST /api/v1/tenant/customers/:id/account", {
  body: z.strictObject({
    accountId: z.string().uuid(),
  }),
});

routeValidations.set("POST /api/v1/tenant/players", {
  body: z.strictObject({
    name: nonEmptyText("name", 60),
    mobile: nullableText("mobile", 32),
    intro: nullableText("intro", 1000),
    acceptingOrders: z.boolean().optional(),
    basePricePerHourFen: fenMoney("basePricePerHourFen").optional(),
  }),
});

routeValidations.set("PATCH /api/v1/tenant/players/:id", {
  body: z.strictObject({
    name: nonEmptyText("name", 60).optional(),
    mobile: nullableText("mobile", 32),
    intro: nullableText("intro", 1000),
    status: statusEnum.optional(),
    acceptingOrders: z.boolean().optional(),
    basePricePerHourFen: fenMoney("basePricePerHourFen").optional(),
  }),
});

routeValidations.set("POST /api/v1/tenant/players/:id/skills", {
  body: z.strictObject({
    gameId: z.string().uuid(),
    gameRegionId: z.string().uuid().nullable().optional(),
    title: nullableText("title", 100),
    note: nullableText("note", 500),
  }),
});

routeValidations.set("POST /api/v1/tenant/players/:id/account", {
  body: z.strictObject({
    accountId: z.string().uuid(),
  }),
});

routeValidations.set("PATCH /api/v1/tenant/player/me", {
  body: z.strictObject({
    acceptingOrders: z.boolean(),
  }),
});

routeValidations.set("POST /api/v1/tenant/player/availability", {
  body: z.strictObject({
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    reason: nullableText("reason", 200),
  }),
});

routeValidations.set("POST /api/v1/tenant/config", {
  body: z.strictObject({
    config: z.record(z.string(), z.unknown()),
  }),
});

routeValidations.set("POST /api/v1/platform/tenants/:tenantId/entitlements", {
  body: z.strictObject({
    featureKey: z.string().min(1),
    enabled: z.boolean(),
  }),
});

routeValidations.set("POST /api/v1/platform/onboarding/tenants", {
  body: z.strictObject({
    code: z.string().trim().min(1).max(40),
    name: nonEmptyText("name", 100),
    host: z.string().min(1).max(200),
    ownerUsername: z.string().min(1).max(60),
    ownerPassword: z.string().min(8).max(200),
    brandPrimary: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    brandAccent: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    logoText: z.string().max(40).optional(),
    storeCutBp: z.number().int().min(0).max(10000).optional(),
    packageCode: z.string().optional(),
  }),
});

routeValidations.set("POST /api/v1/platform/tenants/:tenantId/package", {
  body: z.strictObject({
    packageCode: z.string().min(1),
  }),
});

routeValidations.set("POST /api/v1/tenant/finance-rules/store-cut", {
  body: z.strictObject({
    storeCutBp: z.number().int().min(0).max(10000),
  }),
});

routeValidations.set("POST /api/v1/tenant/catalog/games", {
  body: z.strictObject({
    name: nonEmptyText("游戏名", 60),
  }),
});

routeValidations.set("PATCH /api/v1/tenant/catalog/games/:id", {
  body: z.strictObject({
    name: nonEmptyText("游戏名", 60).optional(),
    enabled: z.boolean().optional(),
  }),
});

routeValidations.set("POST /api/v1/tenant/catalog/games/:gameId/regions", {
  body: z.strictObject({
    name: nonEmptyText("区服名", 60),
  }),
});

routeValidations.set("PATCH /api/v1/tenant/catalog/regions/:id", {
  body: z.strictObject({
    name: nonEmptyText("区服名", 60).optional(),
    enabled: z.boolean().optional(),
  }),
});

routeValidations.set("POST /api/v1/tenant/catalog/products", {
  body: z.strictObject({
    gameId: z.string().uuid(),
    gameRegionId: z.string().uuid().nullable().optional(),
    name: nonEmptyText("产品名", 80),
    description: nullableText("description", 500),
  }),
});

routeValidations.set("PATCH /api/v1/tenant/catalog/products/:id", {
  body: z.strictObject({
    name: nonEmptyText("产品名", 80).optional(),
    description: nullableText("description", 500),
    enabled: z.boolean().optional(),
    gameRegionId: z.string().uuid().nullable().optional(),
  }),
});

routeValidations.set("POST /api/v1/tenant/settlements/:id/items", {
  body: z
    .strictObject({
      earningIds: z.array(z.string().uuid()).optional(),
      slotEarningIds: z.array(z.string().uuid()).optional(),
    })
    .refine(
      (v) =>
        (v.earningIds?.length ?? 0) > 0 || (v.slotEarningIds?.length ?? 0) > 0,
      { message: "至少提供一个 earningIds 或 slotEarningIds" },
    ),
});

routeValidations.set("POST /api/v1/tenant/orders/:orderId/disputes", {
  body: z.strictObject({
    reason: nonEmptyText("reason", 500),
    earningId: z.string().uuid().nullable().optional(),
  }),
});

routeValidations.set("POST /api/v1/tenant/disputes/:disputeId/resolve", {
  body: z.strictObject({
    resolution: nonEmptyText("resolution", 500),
  }),
});

routeValidations.set("POST /api/v1/tenant/sessions/:sessionId/adjustments", {
  body: z.strictObject({
    requestedDurationSeconds: z.number().int().min(1),
    reason: nullableText("reason", 500),
  }),
});

routeValidations.set(
  "POST /api/v1/tenant/sessions/:sessionId/adjustments/:adjustmentId/review",
  {
    body: z.strictObject({
      approve: z.boolean(),
      comment: nullableText("comment", 500),
    }),
  },
);

routeValidations.set("PATCH /api/v1/platform/tenants/:tenantId/finance-rules", {
  body: z.strictObject({
    platformFeeBp: z.number().int().min(0).max(10000),
  }),
});

routeValidations.set(
  "POST /api/v1/tenant/orders/:id/applications/:applicationId/shortlist",
  {
    body: z.strictObject({
      shortlisted: z.boolean(),
    }),
  },
);

routeValidations.set(
  "POST /api/v1/tenant/player/orders/:orderId/applications",
  {
    body: z.strictObject({
      note: nullableText("note", 500),
    }),
  },
);

routeValidations.set(
  "POST /api/v1/tenant/customer/orders/:orderId/assignment",
  {
    body: z.strictObject({
      applicationId: z.string().uuid(),
    }),
  },
);

const requirementSchema = z.strictObject({
  description: z.string().trim().min(2).max(1000),
  gameId: z.string().uuid().nullable().optional(),
  serviceProductId: z.string().uuid().nullable().optional(),
  gender: nullableText("gender", 20),
  desiredStartAt: z.string().datetime({ offset: true }).nullable().optional(),
  durationSeconds: z
    .number()
    .int()
    .min(1)
    .max(86_400 * 365)
    .nullable()
    .optional(),
  minBudgetFen: fenMoney("minBudgetFen").nullable().optional(),
  maxBudgetFen: fenMoney("maxBudgetFen").nullable().optional(),
  note: nullableText("note", 1000),
});

routeValidations.set("POST /api/v1/tenant/orders", {
  body: z.strictObject({
    customerProfileId: z.string().uuid(),
    orderNo: z.string().max(40).optional(),
    remark: nullableText("remark", 1000),
    idempotencyKey: z.string().min(8).max(100).optional(),
    requirement: requirementSchema.optional(),
  }),
});

routeValidations.set("POST /api/v1/tenant/customer/orders", {
  body: z.strictObject({
    requirement: requirementSchema.optional(),
  }),
});

routeValidations.set("POST /api/v1/tenant/ai/parse-requirement", {
  body: z.strictObject({
    description: z.string().min(1).max(1000).optional(),
    gameId: z.string().nullable().optional(),
    serviceProductId: z.string().nullable().optional(),
    durationSeconds: z.number().int().min(1).nullable().optional(),
    desiredStartAt: z.string().min(1).nullable().optional(),
    minBudgetFen: z.number().int().min(0).nullable().optional(),
    maxBudgetFen: z.number().int().min(0).nullable().optional(),
  }),
});

routeValidations.set(
  "POST /api/v1/tenant/catalog/products/:productId/pricing",
  {
    body: z.strictObject({
      durationSeconds: durationSeconds(),
      priceFen: positiveFenMoney("priceFen"),
      playerCostFen: fenMoney("playerCostFen").optional(),
      enabled: z.boolean().optional(),
    }),
  },
);

routeValidations.set("PATCH /api/v1/tenant/catalog/pricing/:id", {
  body: z
    .strictObject({
      durationSeconds: durationSeconds().optional(),
      priceFen: positiveFenMoney("priceFen").optional(),
      playerCostFen: fenMoney("playerCostFen").optional(),
      enabled: z.boolean().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, {
      message: "至少提供一个可更新字段",
    }),
});

routeValidations.set("POST /api/v1/tenant/finance-rules/split-preview", {
  body: z.strictObject({
    amountFen: positiveFenMoney("amountFen"),
  }),
});

routeValidations.set("POST /api/v1/tenant/orders/:id/cancel", {
  body: z
    .strictObject({
      reason: z.string().max(500).nullable().optional(),
    })
    .optional(),
});

routeValidations.set("POST /api/v1/tenant/orders/:id/assignment", {
  body: z.strictObject({
    applicationId: z.string().min(1).max(100),
  }),
});

routeValidations.set("POST /api/v1/tenant/players/:id/availability", {
  body: z.strictObject({
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    reason: nullableText("reason", 200),
  }),
});

const gameTemplateFieldBody = z.strictObject({
  fieldKey: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,39}$/, "字段标识需为小写字母开头字母数字下划线"),
  label: z.string().trim().min(1).max(40, "字段名称超长"),
  fieldType: z.enum([
    "text",
    "select",
    "multiline",
    "datetime",
    "duration",
    "note",
  ]),
  required: z.boolean().optional(),
  options: z.array(z.string().min(1).max(50)).max(100).optional(),
  placeholder: z.string().max(60).nullable().optional(),
  sectionId: z.string().min(1).max(64).nullable().optional(),
  colSpan: z.number().int().min(1).max(4).optional(),
  rowBreakBefore: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
});

const gameTemplateSectionBody = z.strictObject({
  name: z.string().trim().min(1).max(30, "分区名称超长"),
  columns: z.number().int().min(1).max(4).optional(),
  sortOrder: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
});

const gameTemplateBlockLabelsBody = z.strictObject({
  positions: z.string().trim().min(1).max(20).optional(),
  rankRules: z.string().trim().min(1).max(20).optional(),
  copyLines: z.string().trim().min(1).max(20).optional(),
  sections: z
    .record(
      z.string().min(1).max(30),
      z.strictObject({
        variant: z.enum(["card", "plain", "divider"]).optional(),
        density: z.enum(["comfortable", "compact"]).optional(),
        align: z.enum(["left", "center"]).optional(),
      }),
    )
    .optional(),
});

const gameTemplatePositionBody = z.strictObject({
  label: z.string().trim().min(1).max(40, "位置名称超长"),
  defaultCount: z.number().int().min(1).max(10).optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

const gameTemplateRankBody = z.strictObject({
  rankLabel: z.string().trim().min(1).max(40, "段位名称超长"),
  addPriceFen: fenMoney("addPriceFen"),
  sortOrder: z.number().int().min(0).optional(),
});

const gameTemplateCopyLineBody = z.strictObject({
  label: z.string().trim().min(1).max(200, "文案行超长"),
  valueKey: z.string().max(40).nullable().optional(),
});

const gameTemplateBody = z.strictObject({
  name: z.string().trim().min(1).max(60, "模板名称超长"),
  enabled: z.boolean().optional(),
  fields: z.array(gameTemplateFieldBody).max(100).optional(),
  sections: z.array(gameTemplateSectionBody).max(20).optional(),
  blockLabels: gameTemplateBlockLabelsBody.optional(),
  positions: z.array(gameTemplatePositionBody).max(50).optional(),
  rankRules: z.array(gameTemplateRankBody).max(50).optional(),
  copyLines: z.array(gameTemplateCopyLineBody).max(100).optional(),
});

routeValidations.set("POST /api/v1/tenant/game-templates", {
  body: gameTemplateBody,
});

routeValidations.set("PATCH /api/v1/tenant/game-templates/:id", {
  body: gameTemplateBody.partial().refine((v) => Object.keys(v).length > 0, {
    message: "至少提供一个可更新字段",
  }),
});

routeValidations.set("POST /api/v1/tenant/game-dispatch/orders", {
  body: z.strictObject({
    templateId: z.string().uuid(),
    customerProfileId: z.string().uuid(),
    formValues: z.record(z.string(), z.string().max(500)).optional(),
    desiredStartAt: z.string().datetime({ offset: true }).nullable().optional(),
    durationMinutes: z.number().int().min(1).max(1440),
    lines: z
      .array(
        z.strictObject({
          positionLabel: z.string().trim().min(1).max(40),
          requiredCount: z.number().int().min(1).max(10),
        }),
      )
      .min(1)
      .max(50),
  }),
});

routeValidations.set(
  "POST /api/v1/tenant/game-dispatch/orders/:orderId/assignment",
  {
    body: z.strictObject({
      applicationIds: z.array(z.string().uuid()).min(1).max(100),
    }),
  },
);

routeValidations.set(
  "POST /api/v1/tenant/game-dispatch/customer/orders/:orderId/assignment",
  {
    body: z.strictObject({
      applicationIds: z.array(z.string().uuid()).min(1).max(100),
    }),
  },
);

routeValidations.set("POST /api/v1/boss/wallet/recharge", {
  body: z.strictObject({
    amountFen: positiveFenMoney("amountFen"),
  }),
});

routeValidations.set("POST /api/v1/tenant/game-dispatch/customer/orders", {
  body: z.strictObject({
    templateId: z.string().uuid(),
    formValues: z.record(z.string(), z.string().max(500)).optional(),
    desiredStartAt: z.string().datetime({ offset: true }).nullable().optional(),
    durationMinutes: z.number().int().min(1).max(1440),
    lines: z
      .array(
        z.strictObject({
          positionLabel: z.string().trim().min(1).max(40),
          requiredCount: z.number().int().min(1).max(10),
        }),
      )
      .min(1)
      .max(50),
  }),
});

const genericTemplateSort = z.enum([
  "UPDATED_DESC",
  "UPDATED_ASC",
  "NAME_ASC",
  "LAST_USED_DESC",
]);
const genericTemplateStatus = z.enum([
  "DRAFT",
  "PUBLISHED",
  "UNPUBLISHED_CHANGES",
  "ARCHIVED",
]);
const queryLimit = (defaultValue: number) =>
  z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(100))
    .default(defaultValue);
const stableKey = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const genericTemplateMoney = z.string().regex(/^(?:0|[1-9][0-9]*)$/);
const genericTemplateSemanticRole = z.enum([
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
]);
const genericTemplateLayout = z.strictObject({
  colSpan: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  rowBreakBefore: z.boolean(),
});
/** 端口可见性（设计规格 v0.1，V-1 / V-2）：去重后至少一个端口，空数组即 400。 */
const genericTemplateAudiences = z
  .array(z.enum(["CS", "CUSTOMER"]))
  .refine((list) => new Set(list).size >= 1, {
    message: "端口可见性标记至少选择一个端口",
  });
const genericTemplateOption = z.strictObject({
  value: stableKey,
  label: z.string().min(1).max(GAME_TEMPLATE_V2_LIMITS.labelCharacters),
  priceDeltaFen: genericTemplateMoney.optional(),
});
const genericTemplateFieldComponent = z.strictObject({
  kind: z.literal("FIELD"),
  stableKey,
  sectionKey: stableKey,
  label: z.string().min(1).max(GAME_TEMPLATE_V2_LIMITS.labelCharacters),
  description: z
    .string()
    .max(GAME_TEMPLATE_V2_LIMITS.helpTextCharacters)
    .optional(),
  audiences: genericTemplateAudiences.optional(),
  enabled: z.boolean(),
  sortOrder: z.number().int().min(0),
  layout: genericTemplateLayout,
  fieldType: z.enum([
    "TEXT",
    "TEXTAREA",
    "NUMBER",
    "MONEY_FEN",
    "DATETIME",
    "SINGLE_SELECT",
    "MULTI_SELECT",
  ]),
  semanticRole: genericTemplateSemanticRole,
  required: z.boolean(),
  placeholder: z
    .string()
    .max(GAME_TEMPLATE_V2_LIMITS.helpTextCharacters)
    .optional(),
  options: z
    .array(genericTemplateOption)
    .max(GAME_TEMPLATE_V2_LIMITS.choiceOptions)
    .optional(),
  aggregationPolicy: z.enum(["SUM", "MAX"]).optional(),
});
const genericTemplateTableColumn = z.strictObject({
  stableKey,
  label: z.string().min(1).max(GAME_TEMPLATE_V2_LIMITS.labelCharacters),
  columnType: z.enum(["TEXT", "NUMBER", "SINGLE_SELECT"]),
  semanticRole: genericTemplateSemanticRole,
  required: z.boolean(),
  options: z
    .array(genericTemplateOption)
    .max(GAME_TEMPLATE_V2_LIMITS.choiceOptions)
    .optional(),
});
const genericTemplateTableComponent = z.strictObject({
  kind: z.literal("REPEATABLE_TABLE"),
  stableKey,
  sectionKey: stableKey,
  label: z.string().min(1).max(GAME_TEMPLATE_V2_LIMITS.labelCharacters),
  description: z
    .string()
    .max(GAME_TEMPLATE_V2_LIMITS.helpTextCharacters)
    .optional(),
  audiences: genericTemplateAudiences.optional(),
  enabled: z.boolean(),
  sortOrder: z.number().int().min(0),
  layout: genericTemplateLayout,
  columns: z
    .array(genericTemplateTableColumn)
    .max(GAME_TEMPLATE_V2_LIMITS.tableColumns),
  defaultRows: z
    .array(z.record(z.string(), z.unknown()))
    .max(GAME_TEMPLATE_V2_LIMITS.defaultRows),
});
const genericTemplateNoteComponent = z.strictObject({
  kind: z.literal("NOTE"),
  stableKey,
  sectionKey: stableKey,
  label: z.string().min(1).max(GAME_TEMPLATE_V2_LIMITS.labelCharacters),
  description: z
    .string()
    .max(GAME_TEMPLATE_V2_LIMITS.helpTextCharacters)
    .optional(),
  audiences: genericTemplateAudiences.optional(),
  enabled: z.boolean(),
  sortOrder: z.number().int().min(0),
  layout: genericTemplateLayout,
  text: z.string().max(GAME_TEMPLATE_V2_LIMITS.helpTextCharacters),
});
const genericTemplateStaffingSource = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("FIXED"), count: z.number().int().min(1) }),
  z.strictObject({ kind: z.literal("NUMBER_FIELD"), componentKey: stableKey }),
  z.strictObject({
    kind: z.literal("REPEATABLE_TABLE_SUM"),
    componentKey: stableKey,
    columnKey: stableKey,
  }),
]);
const genericTemplateDraftConfig = z
  .strictObject({
    schemaVersion: z.literal(2),
    sections: z
      .array(
        z.strictObject({
          stableKey,
          label: z.string().min(1).max(GAME_TEMPLATE_V2_LIMITS.labelCharacters),
          description: z
            .string()
            .max(GAME_TEMPLATE_V2_LIMITS.helpTextCharacters)
            .optional(),
          audiences: genericTemplateAudiences.optional(),
          enabled: z.boolean(),
          sortOrder: z.number().int().min(0),
          layout: z.strictObject({
            columns: z.union([
              z.literal(1),
              z.literal(2),
              z.literal(3),
              z.literal(4),
            ]),
            density: z.enum(["comfortable", "compact"]).optional(),
            align: z.enum(["left", "center"]).optional(),
          }),
        }),
      )
      .max(GAME_TEMPLATE_V2_LIMITS.sections),
    components: z
      .array(
        z.discriminatedUnion("kind", [
          genericTemplateFieldComponent,
          genericTemplateTableComponent,
          genericTemplateNoteComponent,
        ]),
      )
      .max(GAME_TEMPLATE_V2_LIMITS.components),
    staffingSource: genericTemplateStaffingSource,
    legacyCompatibility: z
      .strictObject({
        unboundPriceRules: z
          .array(
            z.strictObject({
              label: z
                .string()
                .min(1)
                .max(GAME_TEMPLATE_V2_LIMITS.labelCharacters),
              priceDeltaFen: genericTemplateMoney,
              sortOrder: z.number().int().min(0),
            }),
          )
          .max(GAME_TEMPLATE_V2_LIMITS.choiceOptions),
      })
      .optional(),
  })
  .refine(
    (config) =>
      new TextEncoder().encode(JSON.stringify(config)).byteLength <=
      GAME_TEMPLATE_V2_LIMITS.draftBytes,
    { message: "模板草稿体积超过 256 KiB" },
  );

const expectedRevisionBody = z.strictObject({
  expectedRevision: z.number().int().min(0),
});

routeValidations.set("GET /api/v1/tenant/game-dispatch-templates", {
  query: z
    .strictObject({
      gameId: z.string().uuid().optional(),
      gameScope: z.enum(["ALL", "UNCLASSIFIED"]).optional(),
      status: genericTemplateStatus.optional(),
      q: z.string().trim().min(1).max(100).optional(),
      sort: genericTemplateSort.default("UPDATED_DESC"),
      cursor: z.string().min(1).max(2000).optional(),
      limit: queryLimit(30),
    })
    // gameId 与 gameScope=UNCLASSIFIED 互斥：同时给出即 400。
    .refine(
      (value) =>
        !(value.gameId !== undefined && value.gameScope === "UNCLASSIFIED"),
      {
        message: "gameId 与 gameScope=UNCLASSIFIED 不能同时使用",
        path: ["gameScope"],
      },
    ),
});

routeValidations.set("GET /api/v1/tenant/game-dispatch-templates/published", {
  query: z.strictObject({ gameId: z.string().uuid() }),
});
routeValidations.set(
  "GET /api/v1/tenant/game-dispatch-templates/versions/:versionId/form",
  {},
);

// 客户侧只读入口（独立入口，C-1 / C-9）：查询参数与商家端同口径，缺 gameId 即 400。
routeValidations.set("GET /api/v1/tenant/game-dispatch/customer/games", {});
routeValidations.set("GET /api/v1/tenant/game-dispatch/customer/published", {
  query: z.strictObject({ gameId: z.string().uuid() }),
});
routeValidations.set(
  "GET /api/v1/tenant/game-dispatch/customer/versions/:versionId/form",
  {},
);

// 客户自助下单（C-9）：请求体**不含** customerProfileId——客户档案由登录身份推导。
routeValidations.set(
  "POST /api/v1/tenant/game-dispatch/customer/template-orders",
  {
    body: z.strictObject({
      gameId: z.string().uuid(),
      templateId: z.string().uuid(),
      templateVersionId: z.string().uuid(),
      values: z.record(z.string(), z.unknown()),
      desiredStartAt: z
        .string()
        .datetime({ offset: true })
        .nullable()
        .optional(),
      durationMinutes: z.number().int().min(15).max(1440).optional(),
    }),
  },
);

// S4 创建派单：幂等键在 Idempotency-Key 头（头校验由控制器执行，边界只校验 body）。 routeValidations.set("POST /api/v1/tenant/game-dispatch/template-orders", {   body: z.strictObject({     gameId: z.string().uuid(),     templateId: z.string().uuid(),     templateVersionId: z.string().uuid(),     customerProfileId: z.string().uuid(),     values: z.record(z.string(), z.unknown()),     desiredStartAt: z.string().datetime({ offset: true }).nullable().optional(),     durationMinutes: z.number().int().min(15).max(1440).optional(),   }), });

routeValidations.set("POST /api/v1/tenant/game-dispatch-templates", {
  body: z.strictObject({
    gameId: z.string().uuid(),
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(500).nullable().optional(),
  }),
});

routeValidations.set(
  "GET /api/v1/tenant/game-dispatch-templates/:id/draft",
  {},
);

routeValidations.set("PATCH /api/v1/tenant/game-dispatch-templates/:id/draft", {
  body: z.strictObject({
    expectedRevision: z.number().int().min(0),
    config: genericTemplateDraftConfig,
  }),
});

routeValidations.set(
  "POST /api/v1/tenant/game-dispatch-templates/:id/publish",
  {
    body: z.strictObject({
      expectedRevision: z.number().int().min(0),
      changeNote: z.string().trim().max(500).nullable().optional(),
      sourceVersionId: z.string().uuid().nullable().optional(),
    }),
  },
);

routeValidations.set(
  "GET /api/v1/tenant/game-dispatch-templates/:id/versions",
  {
    query: z.strictObject({
      cursor: z.string().min(1).max(2000).optional(),
      limit: queryLimit(20),
    }),
  },
);

routeValidations.set(
  "POST /api/v1/tenant/game-dispatch-templates/:id/restore",
  {
    body: z.strictObject({
      versionId: z.string().uuid(),
      expectedRevision: z.number().int().min(0),
    }),
  },
);

routeValidations.set("POST /api/v1/tenant/game-dispatch-templates/:id/copy", {
  body: z.strictObject({
    targetGameId: z.string().uuid(),
    newName: z.string().trim().min(1).max(60),
  }),
});

for (const action of ["default", "archive", "unarchive"] as const) {
  routeValidations.set(
    `POST /api/v1/tenant/game-dispatch-templates/:id/${action}`,
    { body: expectedRevisionBody },
  );
}

routeValidations.set("DELETE /api/v1/tenant/game-dispatch-templates/:id", {
  query: z.strictObject({
    expectedRevision: z
      .string()
      .regex(/^(?:0|[1-9][0-9]*)$/)
      .transform(Number)
      .pipe(z.number().int().min(0)),
  }),
});

// 算价模型（ADR-0003）：按游戏的加价规则库 + 陪玩×游戏底价。
// 命中键 = `<模板字段 stableKey>=<选项值>`（如 mode=ranked）；金额一律十进制字符串分。
const gamePricingDimensionKey = z
  .string()
  .max(130, "命中键超长")
  .regex(
    /^[a-z][a-z0-9_]{0,63}=[^=\s].*$/,
    "命中键需为「字段标识=选项值」，如 mode=ranked",
  );

const gamePricingRuleItemBody = z.strictObject({
  kind: z.enum(["SURCHARGE", "FIXED"]).optional(),
  dimensionKey: gamePricingDimensionKey,
  amountFen: fenMoney("amountFen"),
  sortOrder: z.number().int().min(0).optional(),
});

routeValidations.set("GET /api/v1/tenant/game-pricing/games/:gameId", {});

routeValidations.set("PUT /api/v1/tenant/game-pricing/games/:gameId", {
  body: z.strictObject({
    enabled: z.boolean().optional(),
    items: z.array(gamePricingRuleItemBody).max(200),
  }),
});

routeValidations.set(
  "GET /api/v1/tenant/game-pricing/players/:playerId/games/:gameId/base",
  {},
);

routeValidations.set(
  "PUT /api/v1/tenant/game-pricing/players/:playerId/games/:gameId/base",
  {
    body: z.strictObject({
      basePricePerHourFen: fenMoney("basePricePerHourFen"),
      status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
    }),
  },
);

// 算价模型 Task 3（设计规格 §3.3 / §9 第 4-6 条）：报单、客服审批与证据用途。
// 证据用途走查询参数：移动端 uploadBytes 只带文件名头，不额外加自定义头；
// 计时证据沿用 START/END，报单的开始/结束截图为 REPORT_START/REPORT_END。
const slotEvidenceQuery = z.strictObject({
  evidenceType: z
    .enum(["START", "END", "REPORT_START", "REPORT_END"])
    .optional(),
});
const slotDeclaredMinutes = z
  .number()
  .int()
  .min(15, "申报时长需为 15–1440 分钟")
  .max(1440, "申报时长需为 15–1440 分钟");

for (const action of ["evidence", "capture"] as const) {
  routeValidations.set(
    `POST /api/v1/tenant/game-dispatch/slots/:slotId/session/${action}`,
    { query: slotEvidenceQuery },
  );
}

routeValidations.set("POST /api/v1/tenant/game-dispatch/slots/:slotId/report", {
  body: z.strictObject({ declaredDurationMinutes: slotDeclaredMinutes }),
});

routeValidations.set(
  "POST /api/v1/tenant/game-dispatch/slots/:slotId/report/review",
  {
    body: z.strictObject({
      approve: z.boolean(),
      declaredDurationMinutes: slotDeclaredMinutes.optional(),
      reason: nullableText("reason", 500),
    }),
  },
);

// 算价模型 Task 4（设计规格 §3.5 / §6 / §9 第 3 条）：报名大厅、我的报名、释放名额与违约记录。
routeValidations.set("GET /api/v1/tenant/game-dispatch/player/hall", {});
routeValidations.set(
  "GET /api/v1/tenant/game-dispatch/player/applications",
  {},
);
routeValidations.set(
  "POST /api/v1/tenant/game-dispatch/slots/:slotId/release",
  {
    body: z.strictObject({
      reason: nullableText("reason", 500),
    }),
  },
);
routeValidations.set(
  "POST /api/v1/tenant/game-dispatch/orders/:orderId/player-breaches",
  {
    body: z.strictObject({
      playerId: z.string().uuid(),
      orderSlotId: z.string().uuid().nullable().optional(),
      reason: nonEmptyText("reason", 500),
    }),
  },
);

routeValidations.set("GET /api/v1/tenant/game-dispatch/player-breaches", {
  // P3 / D3：新增时间范围（from/to）与 offset 分页；逆序区间直接 400。
  query: z
    .strictObject({
      orderId: z.string().uuid().optional(),
      playerId: z.string().uuid().optional(),
      from: isoInstant.optional(),
      to: isoInstant.optional(),
      offset: z
        .string()
        .regex(/^[0-9]+$/, "offset 需为非负整数")
        .transform(Number)
        .pipe(z.number().int().min(0).max(100000))
        .optional(),
      limit: z
        .string()
        .regex(/^[1-9][0-9]*$/, "limit 需为正整数")
        .transform(Number)
        .pipe(z.number().int().min(1).max(100))
        .optional(),
    })
    .refine((value) => !value.from || !value.to || value.from <= value.to, {
      message: "from 不能晚于 to",
      path: ["from"],
    }),
});

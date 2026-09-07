import { z } from "zod";
import {
  durationSeconds,
  fenMoney,
  positiveFenMoney,
} from "./api-input.schemas.js";
import { routeValidations } from "./validation-registry.js";

const nonEmptyText = (label: string, max: number) =>
  z.string().trim().min(1).max(max, `${label} 超长`);

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
  }),
});

routeValidations.set("PATCH /api/v1/tenant/players/:id", {
  body: z.strictObject({
    name: nonEmptyText("name", 60).optional(),
    mobile: nullableText("mobile", 32),
    intro: nullableText("intro", 1000),
    status: statusEnum.optional(),
    acceptingOrders: z.boolean().optional(),
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
  body: z.strictObject({
    earningIds: z.array(z.string().uuid()).min(1),
  }),
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
  sortOrder: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
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

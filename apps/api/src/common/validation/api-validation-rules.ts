import { z } from "zod";
import {
  durationSeconds,
  fenMoney,
  positiveFenMoney,
} from "./api-input.schemas.js";
import { routeValidations } from "./validation-registry.js";

const nonEmptyText = (label: string, max: number) =>
  z.string().trim().min(1).max(max, `${label} 超长`);

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

routeValidations.set("POST /api/v1/tenant/players/:playerId/availability", {
  body: z.strictObject({
    startsAt: z.string().min(1),
    endsAt: z.string().min(1),
    reason: nonEmptyText("reason", 200).optional(),
  }),
});

import type { ZodType } from "zod";

export type RequestMethod = "POST" | "PATCH" | "PUT" | "GET" | "DELETE";

/** 路由键：`METHOD route.path`，route.path 使用 Nest/Express 参数占位符（如 :id）。 */
export type RouteValidationKey = `${RequestMethod} ${string}`;

/** 需要保留到 handler 的已校验数据。 */
export interface RouteValidatedData {
  body?: unknown;
  query?: unknown;
}

export const routeValidations = new Map<
  RouteValidationKey,
  { body?: ZodType; query?: ZodType }
>();

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import type { Request } from "express";
import { Observable } from "rxjs";
import { ApiValidationError } from "./validation-error.js";
import {
  routeValidations,
  type RouteValidationKey,
} from "./validation-registry.js";

function fieldErrorsFromIssues(
  issues: Array<{ path: PropertyKey[]; message: string }>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.length === 0 ? "$" : String(issue.path[0]);
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/** 按 method + route.path 查注册表执行 Zod 校验；通过后替换 req.body/req.query。 */
@Injectable()
export class ValidationInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context
      .switchToHttp()
      .getRequest<
        Request & { body?: unknown; query: Record<string, unknown> }
      >();
    const routePath = (req.route?.path ?? req.url).split("?")[0];
    const key =
      `${req.method.toUpperCase()} ${routePath}` as RouteValidationKey;
    const rule = routeValidations.get(key);
    if (!rule) return next.handle();

    if (rule.body && req.body !== undefined && req.body !== null) {
      const parsed = rule.body.safeParse(req.body);
      if (!parsed.success) {
        throw new ApiValidationError(
          fieldErrorsFromIssues(parsed.error.issues as never),
        );
      }
      req.body = parsed.data;
    }
    if (rule.query) {
      const parsed = rule.query.safeParse(req.query);
      if (!parsed.success) {
        throw new ApiValidationError(
          fieldErrorsFromIssues(parsed.error.issues as never),
        );
      }
      // Express 5 把 req.query 定义成请求原型上的只读 getter：
      // 直接赋值在严格模式下抛 TypeError，在非严格模式下静默失效。
      // 必须在本实例上重新定义为普通数据属性。
      Object.defineProperty(req, "query", {
        value: parsed.data as Request["query"],
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    return next.handle();
  }
}

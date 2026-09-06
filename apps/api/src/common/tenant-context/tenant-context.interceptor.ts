import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Observable } from "rxjs";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";

export interface RequestTenantContext {
  tenantId: string;
  source: "session";
  requestId: string;
}

const store = new AsyncLocalStorage<RequestTenantContext | null>();

export function currentTenantContext(): RequestTenantContext | null {
  return store.getStore() ?? null;
}

/**
 * A4-Part3：请求级租户上下文。
 * - 租户只来自服务端签发的 access token（principal.tenantId），不信任客户端提交的 tenantId；
 * - 若请求体携带与会话不一致的 tenantId 直接拒绝（防绕过与枚举）；
 * - 上下文通过 AsyncLocalStorage 供日志/审计/未来中间件读取。
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const principal = req.principal;
    if (!principal?.tenantId) return next.handle();

    const body: unknown = (req as { body?: unknown }).body;
    if (body !== null && typeof body === "object") {
      const record = body as Record<string, unknown>;
      if (
        record.tenantId !== undefined &&
        record.tenantId !== principal.tenantId
      ) {
        throw new BadRequestException(
          "client-supplied tenantId does not match session tenant",
        );
      }
    }

    const requestId =
      (req.headers["x-request-id"] as string | undefined) || randomUUID();
    return store.run(
      { tenantId: principal.tenantId, source: "session", requestId },
      () => next.handle(),
    );
  }
}

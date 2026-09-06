import {
  HttpException,
  HttpStatus,
  Injectable,
  NestMiddleware,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";

/**
 * 请求级上下文中间件（在 guards/interceptors 之前执行）：
 * - 生成/透传 requestId 并写入响应头；
 * - 响应结束时输出结构化 JSON 日志（不记录 body/query/凭据）。
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const authenticated = req as AuthenticatedRequest;
    const requestId =
      (req.headers["x-request-id"] as string | undefined) || randomUUID();
    authenticated.requestId = requestId;
    res.setHeader("x-request-id", requestId);
    const method = req.method.toUpperCase();
    const hasCookieSession = /pw_refresh=/.test(req.headers.cookie ?? "");
    if (
      hasCookieSession &&
      method !== "GET" &&
      method !== "HEAD" &&
      method !== "OPTIONS"
    ) {
      const fetchSite = req.headers["sec-fetch-site"];
      if (
        typeof fetchSite === "string" &&
        fetchSite !== "same-origin" &&
        fetchSite !== "same-site" &&
        fetchSite !== "none"
      ) {
        next(
          new HttpException(
            "cross-site cookie request rejected",
            HttpStatus.FORBIDDEN,
          ),
        );
        return;
      }
      const origin = req.headers.origin;
      if (typeof origin === "string" && origin.length > 0) {
        const hostOrigin = req.protocol + "://" + (req.headers.host ?? "");
        const allowed = new Set<string>([hostOrigin]);
        if (process.env.ADMIN_WEB_ORIGIN)
          allowed.add(process.env.ADMIN_WEB_ORIGIN);
        if (process.env.H5_ORIGIN) allowed.add(process.env.H5_ORIGIN);
        if (!allowed.has(origin)) {
          next(
            new HttpException(
              "cross-origin cookie request rejected",
              HttpStatus.FORBIDDEN,
            ),
          );
          return;
        }
      }
    }
    const startedAt = Date.now();

    res.on("finish", () => {
      const line = JSON.stringify({
        level: "info",
        time: new Date().toISOString(),
        requestId,
        tenantId: authenticated.principal?.tenantId ?? null,
        actorId: authenticated.principal?.sub ?? null,
        method: req.method,
        path: req.originalUrl ?? req.url,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      });
      process.stdout.write(`${line}\n`);
    });
    next();
  }
}

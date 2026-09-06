import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";

const TITLES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: "Bad Request",
  [HttpStatus.UNAUTHORIZED]: "Unauthorized",
  [HttpStatus.FORBIDDEN]: "Forbidden",
  [HttpStatus.NOT_FOUND]: "Not Found",
  [HttpStatus.CONFLICT]: "Conflict",
  [HttpStatus.TOO_MANY_REQUESTS]: "Too Many Requests",
  [HttpStatus.SERVICE_UNAVAILABLE]: "Service Unavailable",
  [HttpStatus.INTERNAL_SERVER_ERROR]: "Internal Server Error",
};

function extractMessage(body: string | Record<string, unknown>): string {
  if (typeof body === "string") return body;
  const message = body.message;
  if (typeof message === "string") return message;
  if (Array.isArray(message)) {
    return message
      .map((m) => (typeof m === "string" ? m : String(m)))
      .join("; ");
  }
  return typeof body.error === "string" ? body.error : "Request failed";
}

/** RFC9457 风格错误响应（兼容保留 message 字段）。 */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { requestId?: string }>();
    const res = ctx.getResponse<Response>();

    const requestId =
      req.requestId ??
      (req.headers["x-request-id"] as string | undefined) ??
      "";
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const rawBody =
      exception instanceof HttpException
        ? (exception.getResponse() as string | Record<string, unknown>)
        : undefined;
    const message = rawBody ? extractMessage(rawBody) : "Internal server error";

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${req.method} ${req.url} failed`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    res.status(status).json({
      type:
        status === HttpStatus.INTERNAL_SERVER_ERROR
          ? "about:blank"
          : "about:blank#http-error",
      title: TITLES[status] ?? "Error",
      status,
      code:
        exception instanceof HttpException && typeof exception.name === "string"
          ? exception.name
          : "INTERNAL_ERROR",
      message,
      requestId,
    });
  }
}

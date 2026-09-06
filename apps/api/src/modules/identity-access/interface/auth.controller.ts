import { Body, Controller, Get, HttpException, HttpStatus, Inject, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthService } from "../application/auth.service.js";
import { Public } from "../../../common/auth/decorators.js";
import { RateLimitService } from "../../../common/auth/rate-limit.service.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { AccountDisabledError, InvalidCredentialsError, InvalidRefreshTokenError } from "../domain/errors.js";
import type { Scope } from "../domain/principal.js";
import { REFRESH_TOKEN_TTL_SECONDS } from "../infrastructure/tokens.js";

const REFRESH_COOKIE = "pw_refresh";
const REFRESH_COOKIE_PATH = "/api/v1/auth";
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;

interface LoginBody {
  kind?: unknown;
  username?: unknown;
  password?: unknown;
  tenantCode?: unknown;
}

interface TokenBody {
  scope?: unknown;
  refreshToken?: unknown;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpException(field + " is required", HttpStatus.BAD_REQUEST);
  }
  return value;
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) return part.slice(idx + 1).trim();
  }
  return undefined;
}

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
}

function originAllowed(req: Request): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const hostOrigin = req.protocol + "://" + (req.headers.host ?? "");
  const allowed = new Set<string>();
  if (process.env.ADMIN_WEB_ORIGIN) allowed.add(process.env.ADMIN_WEB_ORIGIN);
  if (process.env.H5_ORIGIN) allowed.add(process.env.H5_ORIGIN);
  allowed.add(hostOrigin);
  return allowed.has(origin);
}

@Controller("api/v1/auth")
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(RateLimitService) private readonly rateLimit: RateLimitService
  ) {}

  @Public()
  @Post("login")
  async login(@Body() body: LoginBody, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    const kind = body.kind === "platform" ? "platform" : body.kind === "tenant" ? "tenant" : null;
    if (!kind) throw new HttpException("kind must be platform|tenant", HttpStatus.BAD_REQUEST);
    const username = requiredString(body.username, "username");
    const password = requiredString(body.password, "password");
    const rateKey = (req.ip ?? "unknown") + ":" + kind + ":" + username;
    if (this.rateLimit.isBlocked(rateKey, LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS)) {
      throw new HttpException("too many attempts", HttpStatus.TOO_MANY_REQUESTS);
    }
    try {
      const bundle =
        kind === "platform"
          ? await this.auth.loginPlatform(username, password)
          : await this.auth.loginTenant(requiredString(body.tenantCode, "tenantCode"), username, password);
      this.rateLimit.reset(rateKey);
      setRefreshCookie(res, bundle.refreshToken);
      return { data: bundle };
    } catch (error) {
      if (error instanceof InvalidCredentialsError || error instanceof AccountDisabledError) {
        this.rateLimit.recordFailure(rateKey, LOGIN_WINDOW_MS);
        throw new HttpException(error.message, HttpStatus.UNAUTHORIZED);
      }
      if (error instanceof InvalidRefreshTokenError) {
        throw new HttpException(error.message, HttpStatus.UNAUTHORIZED);
      }
      throw error;
    }
  }

  @Public()
  @Post("refresh")
  async refresh(@Body() body: TokenBody, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    const scope = body.scope === "tenant" ? ("tenant" as Scope) : body.scope === "platform" ? ("platform" as Scope) : null;
    if (!scope) throw new HttpException("scope must be platform|tenant", HttpStatus.BAD_REQUEST);
    const cookieToken = readCookie(req, REFRESH_COOKIE);
    if (cookieToken && !originAllowed(req)) {
      throw new HttpException("cross-site request rejected", HttpStatus.FORBIDDEN);
    }
    const refreshToken = cookieToken ?? requiredString(body.refreshToken, "refreshToken");
    try {
      const bundle = await this.auth.refresh(refreshToken, scope);
      setRefreshCookie(res, bundle.refreshToken);
      return { data: bundle };
    } catch (error) {
      if (error instanceof InvalidRefreshTokenError) {
        throw new HttpException(error.message, HttpStatus.UNAUTHORIZED);
      }
      throw error;
    }
  }

  @Public()
  @Post("logout")
  async logout(@Body() body: TokenBody, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    const cookieToken = readCookie(req, REFRESH_COOKIE);
    if (cookieToken && !originAllowed(req)) {
      throw new HttpException("cross-site request rejected", HttpStatus.FORBIDDEN);
    }
    const refreshToken = cookieToken ?? requiredString(body.refreshToken, "refreshToken");
    await this.auth.logout(refreshToken);
    clearRefreshCookie(res);
    return { data: { ok: true } };
  }

  @Get("me")
  me(@Req() req: AuthenticatedRequest) {
    return { data: req.principal };
  }
}

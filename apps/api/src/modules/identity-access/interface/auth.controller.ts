import { Body, Controller, Get, HttpException, HttpStatus, Post, Req } from "@nestjs/common";
import { AuthService } from "../application/auth.service.js";
import { Public } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { AccountDisabledError, InvalidCredentialsError, InvalidRefreshTokenError } from "../domain/errors.js";
import type { Scope } from "../domain/principal.js";

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
    throw new HttpException(`${field} is required`, HttpStatus.BAD_REQUEST);
  }
  return value;
}

@Controller("api/v1/auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("login")
  async login(@Body() body: LoginBody) {
    const kind = body.kind === "platform" ? "platform" : body.kind === "tenant" ? "tenant" : null;
    if (!kind) throw new HttpException("kind must be platform|tenant", HttpStatus.BAD_REQUEST);
    const username = requiredString(body.username, "username");
    const password = requiredString(body.password, "password");
    try {
      const bundle =
        kind === "platform"
          ? await this.auth.loginPlatform(username, password)
          : await this.auth.loginTenant(requiredString(body.tenantCode, "tenantCode"), username, password);
      return { data: bundle };
    } catch (error) {
      if (
        error instanceof InvalidCredentialsError ||
        error instanceof AccountDisabledError ||
        error instanceof InvalidRefreshTokenError
      ) {
        throw new HttpException(error.message, HttpStatus.UNAUTHORIZED);
      }
      throw error;
    }
  }

  @Public()
  @Post("refresh")
  async refresh(@Body() body: TokenBody) {
    const scope = body.scope === "tenant" ? ("tenant" as Scope) : body.scope === "platform" ? ("platform" as Scope) : null;
    if (!scope) throw new HttpException("scope must be platform|tenant", HttpStatus.BAD_REQUEST);
    try {
      const bundle = await this.auth.refresh(requiredString(body.refreshToken, "refreshToken"), scope);
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
  async logout(@Body() body: TokenBody) {
    await this.auth.logout(requiredString(body.refreshToken, "refreshToken"));
    return { data: { ok: true } };
  }

  @Get("me")
  me(@Req() req: AuthenticatedRequest) {
    return { data: req.principal };
  }
}

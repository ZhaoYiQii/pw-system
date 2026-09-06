import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { AccessPrincipal } from "../../modules/identity-access/domain/principal.js";
import { AuthService } from "../../modules/identity-access/application/auth.service.js";
import { AUD_PLATFORM, AUD_TENANT } from "../../modules/identity-access/infrastructure/tokens.js";
import { IS_PUBLIC_KEY, REQUIRED_SCOPE_KEY } from "./decorators.js";

export interface AuthenticatedRequest extends Request {
  principal?: AccessPrincipal;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector | undefined,
    private readonly auth: AuthService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const reflector = this.reflector ?? new Reflector();
    const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (isPublic) return true;

    const requiredScope = reflector.getAllAndOverride<"platform" | "tenant" | undefined>(
      REQUIRED_SCOPE_KEY,
      [context.getHandler(), context.getClass()]
    );

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearer(request);
    if (!token) throw new UnauthorizedException("missing bearer token");

    const allowedAudiences =
      requiredScope === "platform"
        ? [AUD_PLATFORM]
        : requiredScope === "tenant"
          ? [AUD_TENANT]
          : [AUD_PLATFORM, AUD_TENANT];

    const principal = await this.auth.verifyAccess(token, allowedAudiences);
    if (requiredScope === "tenant" && principal.tenantId === undefined) {
      throw new UnauthorizedException("tenant scope required");
    }
    request.principal = principal;
    return true;
  }

  private extractBearer(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) return undefined;
    return header.slice("Bearer ".length);
  }
}

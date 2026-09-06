import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { AccessPrincipal } from "../../modules/identity-access/domain/principal.js";
import { AuthService } from "../../modules/identity-access/application/auth.service.js";
import {
  AUD_PLATFORM,
  AUD_TENANT,
} from "../../modules/identity-access/infrastructure/tokens.js";
import { IS_PUBLIC_KEY, REQUIRED_SCOPE_KEY } from "./decorators.js";

export interface AuthenticatedRequest extends Request {
  principal?: AccessPrincipal;
  requestId?: string;
}

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly reflector = new Reflector();

  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const requiredScope = this.reflector.getAllAndOverride<
      "platform" | "tenant" | undefined
    >(REQUIRED_SCOPE_KEY, [context.getHandler(), context.getClass()]);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearer(request);
    if (!token) throw new UnauthorizedException("missing bearer token");

    const allowedAudiences =
      requiredScope === "platform"
        ? [AUD_PLATFORM]
        : requiredScope === "tenant"
          ? [AUD_TENANT]
          : [AUD_PLATFORM, AUD_TENANT];

    let principal;
    try {
      principal = await this.auth.verifyAccess(token, allowedAudiences);
    } catch {
      throw new UnauthorizedException("invalid or expired access token");
    }
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

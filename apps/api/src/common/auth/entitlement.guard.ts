import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { EntitlementsService } from "../../modules/entitlements/application/entitlements.service.js";
import { FeatureDisabledError } from "../../modules/entitlements/domain/errors.js";
import type { AuthenticatedRequest } from "./auth.guard.js";

export const REQUIRED_ADDON_KEY = "pw:requiredAddon";

/** 要求租户已开通某 addon；由全局 EntitlementGuard 执行。 */
export const RequireAddon = (featureKey: string) =>
  Reflect.metadata(REQUIRED_ADDON_KEY, featureKey);

@Injectable()
export class EntitlementGuard implements CanActivate {
  private readonly reflector = new Reflector();

  constructor(
    @Inject(EntitlementsService)
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<string>(
      REQUIRED_ADDON_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!feature) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const tenantId = request.principal?.tenantId;
    if (!tenantId) throw new ForbiddenException("需要门店会话");
    try {
      await this.entitlements.ensureAddonEnabled(tenantId, feature);
      return true;
    } catch (error) {
      if (error instanceof FeatureDisabledError)
        throw new ForbiddenException(error.message);
      throw error;
    }
  }
}

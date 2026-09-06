import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { EntitlementsService } from "../application/entitlements.service.js";
import { FeatureDisabledError, UnknownFeatureError } from "../domain/errors.js";
import {
  Permissions,
  PlatformScope,
  TenantScope,
} from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { AuditService } from "../../audit/audit.service.js";

function tenantIdOf(req: AuthenticatedRequest): string {
  const id = req.principal?.tenantId;
  if (!id)
    throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
  return id;
}

@Controller("api/v1")
export class EntitlementsController {
  constructor(
    @Inject(EntitlementsService)
    private readonly entitlements: EntitlementsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @TenantScope()
  @Get("tenant/features")
  async listTenantFeatures(@Req() req: AuthenticatedRequest) {
    return { data: await this.entitlements.listFeatures(tenantIdOf(req)) };
  }

  @TenantScope()
  @Get("tenant/addon/:featureKey")
  async addonCapability(
    @Req() req: AuthenticatedRequest,
    @Param("featureKey") featureKey: string,
  ) {
    try {
      await this.entitlements.ensureAddonEnabled(tenantIdOf(req), featureKey);
      return { data: { featureKey, enabled: true } };
    } catch (error) {
      if (error instanceof FeatureDisabledError)
        throw new ForbiddenException(error.message);
      if (error instanceof UnknownFeatureError)
        throw new NotFoundException(error.message);
      throw error;
    }
  }

  @PlatformScope()
  @Permissions("tenant.view")
  @Get("platform/tenants/:tenantId/entitlements")
  async listEntitlements(@Param("tenantId") tenantId: string) {
    return { data: await this.entitlements.listFeatures(tenantId) };
  }

  @PlatformScope()
  @Permissions("tenant.manage")
  @Post("platform/tenants/:tenantId/entitlements")
  async setEntitlement(
    @Req() req: AuthenticatedRequest,
    @Param("tenantId") tenantId: string,
    @Body() body: { featureKey?: unknown; enabled?: unknown },
  ) {
    const featureKey = body.featureKey;
    const enabled = body.enabled;
    if (typeof featureKey !== "string" || typeof enabled !== "boolean") {
      throw new HttpException(
        "featureKey(string)+enabled(boolean) required",
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      await this.entitlements.setFeature(tenantId, featureKey, enabled);
      await this.audit.record({
        tenantId,
        actorType: "platform_account",
        actorId: req.principal?.sub ?? "platform",
        action: "entitlement.set",
        resourceType: "tenant_entitlement",
        resourceId: tenantId,
        summary: `${enabled ? "开启" : "关闭"} ${featureKey}`,
      });
      return { data: await this.entitlements.listFeatures(tenantId) };
    } catch (error) {
      if (error instanceof UnknownFeatureError)
        throw new NotFoundException(error.message);
      throw error;
    }
  }
}

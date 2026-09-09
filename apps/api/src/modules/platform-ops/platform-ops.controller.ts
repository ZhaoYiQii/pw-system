import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Req,
} from "@nestjs/common";
import type { AuthenticatedRequest } from "../../common/auth/auth.guard.js";
import { PlatformScope, Permissions } from "../../common/auth/decorators.js";
import { PlatformGrantsService } from "../platform-accounts/platform-grants.service.js";
import {
  PlatformOpsService,
  type PlatformOverviewResult,
  type PlatformSubscriptionRow,
  type PlatformTenantDetail,
} from "./platform-ops.service.js";

@Controller("api/v1/platform")
export class PlatformOpsController {
  constructor(
    @Inject(PlatformOpsService) private readonly ops: PlatformOpsService,
    @Inject(PlatformGrantsService)
    private readonly grants: PlatformGrantsService,
  ) {}

  @PlatformScope()
  @Permissions("platform.manage")
  @Get("overview")
  async overview(): Promise<{ data: PlatformOverviewResult }> {
    return { data: await this.ops.overview() };
  }

  @PlatformScope()
  @Permissions("platform.manage")
  @Get("subscriptions")
  async subscriptions(): Promise<{ data: PlatformSubscriptionRow[] }> {
    return { data: await this.ops.subscriptions() };
  }

  @PlatformScope()
  @Permissions("tenant.view")
  @Get("tenants/:tenantId/detail")
  async tenantDetail(
    @Req() req: AuthenticatedRequest,
    @Param("tenantId") tenantId: string,
  ): Promise<{ data: PlatformTenantDetail }> {
    await this.grants.assertTenantReadAllowed(req.principal, tenantId);
    const detail = await this.ops.tenantDetail(tenantId);
    if (!detail) {
      throw new HttpException("tenant not found", HttpStatus.NOT_FOUND);
    }
    return { data: detail };
  }
}

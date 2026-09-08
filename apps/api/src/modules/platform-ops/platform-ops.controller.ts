import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
} from "@nestjs/common";
import { PlatformScope, Permissions } from "../../common/auth/decorators.js";
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
  ) {}

  @PlatformScope()
  @Permissions("tenant.view")
  @Get("overview")
  async overview(): Promise<{ data: PlatformOverviewResult }> {
    return { data: await this.ops.overview() };
  }

  @PlatformScope()
  @Permissions("tenant.view")
  @Get("subscriptions")
  async subscriptions(): Promise<{ data: PlatformSubscriptionRow[] }> {
    return { data: await this.ops.subscriptions() };
  }

  @PlatformScope()
  @Permissions("tenant.view")
  @Get("tenants/:tenantId/detail")
  async tenantDetail(
    @Param("tenantId") tenantId: string,
  ): Promise<{ data: PlatformTenantDetail }> {
    const detail = await this.ops.tenantDetail(tenantId);
    if (!detail) {
      throw new HttpException("tenant not found", HttpStatus.NOT_FOUND);
    }
    return { data: detail };
  }
}

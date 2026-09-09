import {
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Req,
} from "@nestjs/common";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { DashboardSummaryService } from "../application/dashboard-summary.service.js";
import {
  DASHBOARD_STAFF_ROLES,
  type DashboardStaffRole,
} from "../domain/dashboard-summary.js";

function tenantIdOf(req: AuthenticatedRequest): string {
  const id = req.principal?.tenantId;
  if (!id)
    throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
  return id;
}

@Controller("api/v1/tenant/dashboard")
export class DashboardSummaryController {
  constructor(
    @Inject(DashboardSummaryService)
    private readonly service: DashboardSummaryService,
  ) {}

  @TenantScope()
  @Permissions("tenant.view")
  @Get("summary")
  async summary(@Req() req: AuthenticatedRequest) {
    const role = req.principal?.role;
    if (!DASHBOARD_STAFF_ROLES.includes(role as DashboardStaffRole)) {
      throw new ForbiddenException("仅门店员工角色可查看经营工作台");
    }
    return {
      data: await this.service.get(tenantIdOf(req), role as DashboardStaffRole),
    };
  }
}

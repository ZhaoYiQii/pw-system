import { Controller, Get, HttpException, HttpStatus, Inject, Query, Req } from "@nestjs/common";
import { AuditService } from "./audit.service.js";
import { TenantScope } from "../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../common/auth/auth.guard.js";

@Controller("api/v1/tenant/audit")
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @TenantScope()
  @Get()
  async list(@Req() req: AuthenticatedRequest, @Query("limit") limit?: unknown) {
    const tenantId = req.principal?.tenantId;
    if (!tenantId) throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
    return { data: await this.audit.list(tenantId, typeof limit === "string" ? Number(limit) : 50) };
  }
}
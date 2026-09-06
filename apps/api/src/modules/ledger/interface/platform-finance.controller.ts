import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Req,
} from "@nestjs/common";
import { LedgerRulesService } from "../application/ledger-rules.service.js";
import { PlatformScope, Permissions } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { AuditService } from "../../audit/audit.service.js";

@Controller("api/v1/platform/tenants/:tenantId/finance-rules")
export class PlatformFinanceController {
  constructor(
    @Inject(LedgerRulesService) private readonly rules: LedgerRulesService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @PlatformScope()
  @Permissions("platform.manage")
  @Get()
  async get(@Param("tenantId") tenantId: string) {
    return { data: await this.rules.effective(tenantId) };
  }

  @PlatformScope()
  @Permissions("platform.manage")
  @Patch()
  async set(
    @Req() req: AuthenticatedRequest,
    @Param("tenantId") tenantId: string,
    @Body() body: { platformFeeBp?: unknown },
  ) {
    try {
      const updated = await this.rules.setPlatformFee(
        tenantId,
        body.platformFeeBp,
      );
      await this.audit.record({
        tenantId,
        actorType: req.principal?.role,
        actorId: req.principal?.sub ?? "platform",
        action: "finance-rules.platform-fee",
        resourceType: "finance_rate_rule",
        resourceId: tenantId,
        summary: `平台调整平台费率至 ${updated.platformFeeBp}bp`,
      });
      return { data: updated };
    } catch (error) {
      throw new HttpException(
        error instanceof Error ? error.message : String(error),
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}

import { Body, Controller, Get, HttpException, HttpStatus, Inject, Param, Patch } from "@nestjs/common";
import { LedgerRulesService } from "../application/ledger-rules.service.js";
import { PlatformScope, Permissions } from "../../../common/auth/decorators.js";

@Controller("api/v1/platform/tenants/:tenantId/finance-rules")
export class PlatformFinanceController {
  constructor(@Inject(LedgerRulesService) private readonly rules: LedgerRulesService) {}

  @PlatformScope()
  @Permissions("platform.manage")
  @Get()
  async get(@Param("tenantId") tenantId: string) {
    return { data: await this.rules.effective(tenantId) };
  }

  @PlatformScope()
  @Permissions("platform.manage")
  @Patch()
  async set(@Param("tenantId") tenantId: string, @Body() body: { platformFeeBp?: unknown }) {
    try {
      return { data: await this.rules.setPlatformFee(tenantId, body.platformFeeBp) };
    } catch (error) {
      throw new HttpException(error instanceof Error ? error.message : String(error), HttpStatus.BAD_REQUEST);
    }
  }
}
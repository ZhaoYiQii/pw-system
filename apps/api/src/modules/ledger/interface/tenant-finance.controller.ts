import { Body, Controller, Get, HttpException, HttpStatus, Inject, Post, Req } from "@nestjs/common";
import { LedgerRulesService } from "../application/ledger-rules.service.js";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";

function tenantIdOf(req: AuthenticatedRequest): string {
  const id = req.principal?.tenantId;
  if (!id) throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
  return id;
}

@Controller("api/v1/tenant/finance-rules")
export class TenantFinanceController {
  constructor(@Inject(LedgerRulesService) private readonly rules: LedgerRulesService) {}

  private bad(error: unknown): never {
    throw new HttpException(error instanceof Error ? error.message : String(error), HttpStatus.BAD_REQUEST);
  }

  @TenantScope()
  @Get()
  async get(@Req() req: AuthenticatedRequest) {
    return { data: await this.rules.effective(tenantIdOf(req)) };
  }

  @TenantScope()
  @Permissions("finance.manage")
  @Post("store-cut")
  async setStoreCut(@Req() req: AuthenticatedRequest, @Body() body: { storeCutBp?: unknown }) {
    try {
      return { data: await this.rules.setStoreCut(tenantIdOf(req), body.storeCutBp) };
    } catch (error) {
      this.bad(error);
    }
  }

  @TenantScope()
  @Post("split-preview")
  async preview(@Req() req: AuthenticatedRequest, @Body() body: { amountFen?: unknown }) {
    try {
      return { data: await this.rules.preview(tenantIdOf(req), body.amountFen) };
    } catch (error) {
      this.bad(error);
    }
  }
}
import { Body, Controller, Get, HttpException, HttpStatus, Inject, Post, Req } from "@nestjs/common";
import { LedgerRulesService } from "../application/ledger-rules.service.js";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { AuditService } from "../../audit/audit.service.js";
import { ApiBody, ApiOkResponse } from "@nestjs/swagger";
import { dataSchema, financeRulesSchema, splitPreviewBodySchema, splitPreviewSchema } from "../../../openapi/schemas.js";

function tenantIdOf(req: AuthenticatedRequest): string {
  const id = req.principal?.tenantId;
  if (!id) throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
  return id;
}

@Controller("api/v1/tenant/finance-rules")
export class TenantFinanceController {
  constructor(
    @Inject(LedgerRulesService) private readonly rules: LedgerRulesService,
    @Inject(AuditService) private readonly audit: AuditService
  ) {}

  private bad(error: unknown): never {
    throw new HttpException(error instanceof Error ? error.message : String(error), HttpStatus.BAD_REQUEST);
  }

  @TenantScope()
  @Get()
  @ApiOkResponse({ schema: dataSchema(financeRulesSchema) as never })
  async get(@Req() req: AuthenticatedRequest) {
    return { data: await this.rules.effective(tenantIdOf(req)) };
  }

  @TenantScope()
  @Permissions("finance.manage")
  @Post("store-cut")
  async setStoreCut(@Req() req: AuthenticatedRequest, @Body() body: { storeCutBp?: unknown }) {
    try {
      const updated = await this.rules.setStoreCut(tenantIdOf(req), body.storeCutBp);
      await this.audit.record({
        tenantId: tenantIdOf(req),
        actorType: req.principal?.role,
        actorId: req.principal?.sub ?? "system",
        action: "finance-rules.store-cut",
        resourceType: "finance_rate_rule",
        resourceId: tenantIdOf(req),
        summary: `调整门店抽成至 ${updated.storeCutBp}bp`
      });
      return { data: updated };
    } catch (error) {
      this.bad(error);
    }
  }

  @TenantScope()
  @Post("split-preview")
  @ApiBody({ schema: splitPreviewBodySchema as never })
  @ApiOkResponse({ schema: dataSchema(splitPreviewSchema) as never })
  async preview(@Req() req: AuthenticatedRequest, @Body() body: { amountFen?: unknown }) {
    try {
      return { data: await this.rules.preview(tenantIdOf(req), body.amountFen) };
    } catch (error) {
      this.bad(error);
    }
  }
}

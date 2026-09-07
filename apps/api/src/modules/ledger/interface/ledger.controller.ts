import {
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { LedgerService } from "../application/ledger.service.js";
import { PlayersService } from "../../players/application/players.service.js";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { AuditService } from "../../audit/audit.service.js";
import { ApiCreatedResponse, ApiOkResponse } from "@nestjs/swagger";
import {
  accountingResultSchema,
  dataSchema,
  playerFinanceSchema,
} from "../../../openapi/schemas.js";

function tenantIdOf(req: AuthenticatedRequest): string {
  const id = req.principal?.tenantId;
  if (!id)
    throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
  return id;
}

@Controller("api/v1/tenant")
export class AccountingController {
  constructor(
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @TenantScope()
  @Permissions("finance.manage")
  @Post("orders/:orderId/accounting")
  @ApiCreatedResponse({ schema: dataSchema(accountingResultSchema) as never })
  async accounting(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
  ) {
    const role = req.principal?.role;
    if (role !== "TENANT_OWNER" && role !== "FINANCE")
      throw new ForbiddenException("仅店主/财务可核算");
    try {
      const result = await this.ledger.completeAccounting(
        tenantIdOf(req),
        orderId,
        req.principal?.sub ?? "system",
      );
      await this.audit.record({
        tenantId: tenantIdOf(req),
        actorType: req.principal?.role,
        actorId: req.principal?.sub ?? "system",
        action: "ledger.accounting",
        resourceType: "earning",
        resourceId: result.earningId,
        summary: `订单核算 ${orderId}`,
      });
      return { data: result };
    } catch (error) {
      throw new HttpException(
        error instanceof Error ? error.message : String(error),
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}

@Controller("api/v1/tenant/player")
export class PlayerFinanceController {
  constructor(
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(PlayersService) private readonly players: PlayersService,
  ) {}

  @TenantScope()
  @Get("finance")
  @ApiOkResponse({ schema: dataSchema(playerFinanceSchema) as never })
  async finance(@Req() req: AuthenticatedRequest) {
    const p = req.principal;
    if (!p?.tenantId || p.role !== "PLAYER")
      throw new ForbiddenException("需要陪玩身份");
    const profile = await this.players
      .getByAccount(p.tenantId, p.sub)
      .catch(() => {
        throw new ForbiddenException("尚未绑定陪玩档案");
      });
    return { data: await this.ledger.playerFinance(p.tenantId, profile.id) };
  }

  @TenantScope()
  @Get("income")
  async income(@Req() req: AuthenticatedRequest) {
    const p = req.principal;
    if (!p?.tenantId || p.role !== "PLAYER")
      throw new ForbiddenException("需要陪玩身份");
    const profile = await this.players
      .getByAccount(p.tenantId, p.sub)
      .catch(() => {
        throw new ForbiddenException("尚未绑定陪玩档案");
      });
    return { data: await this.ledger.playerIncome(p.tenantId, profile.id) };
  }
}

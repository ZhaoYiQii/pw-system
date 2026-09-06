import {
  Body,
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
import { DispatchService } from "../application/dispatch.service.js";
import {
  ApplicationConflictError,
  DispatchNotFoundError,
  OrderStateConflictError,
  PlayerNotAcceptingError,
  PlayerSkillMissingError,
  PlayerTimeConflictError,
} from "../domain/errors.js";
import { PlayersService } from "../../players/application/players.service.js";
import { TenantScope } from "../../../common/auth/decorators.js";
import { RequireAddon } from "../../../common/auth/entitlement.guard.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { AuditService } from "../../audit/audit.service.js";
import { ApiOkResponse } from "@nestjs/swagger";
import { dataArraySchema, hallOrderSchema } from "../../../openapi/schemas.js";

@RequireAddon("addon.player_order_hall")
@Controller("api/v1/tenant/player")
export class DispatchPlayerController {
  constructor(
    @Inject(DispatchService) private readonly dispatch: DispatchService,
    @Inject(PlayersService) private readonly players: PlayersService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private ctx(req: AuthenticatedRequest): {
    tenantId: string;
    accountId: string;
  } {
    const p = req.principal;
    if (!p?.tenantId || p.role !== "PLAYER")
      throw new ForbiddenException("需要陪玩身份");
    return { tenantId: p.tenantId, accountId: p.sub };
  }

  private mapError(error: unknown): never {
    if (error instanceof DispatchNotFoundError)
      throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    if (
      error instanceof OrderStateConflictError ||
      error instanceof ApplicationConflictError
    )
      throw new HttpException(error.message, HttpStatus.CONFLICT);
    if (
      error instanceof PlayerNotAcceptingError ||
      error instanceof PlayerSkillMissingError ||
      error instanceof PlayerTimeConflictError
    ) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
    throw error;
  }

  @TenantScope()
  @Get("order-hall")
  @ApiOkResponse({ schema: dataArraySchema(hallOrderSchema) as never })
  async hall(@Req() req: AuthenticatedRequest) {
    return { data: await this.dispatch.hallOrders(this.ctx(req).tenantId) };
  }

  @TenantScope()
  @Get("applications")
  async mine(@Req() req: AuthenticatedRequest) {
    const ctx = this.ctx(req);
    try {
      const player = await this.players.getByAccount(
        ctx.tenantId,
        ctx.accountId,
      );
      return {
        data: await this.dispatch.myApplications(ctx.tenantId, player.id),
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error ? error.message : String(error),
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @TenantScope()
  @Post("orders/:orderId/applications")
  async apply(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
    @Body() body: { note?: unknown },
  ) {
    const ctx = this.ctx(req);
    try {
      const player = await this.players.getByAccount(
        ctx.tenantId,
        ctx.accountId,
      );
      await this.dispatch.apply(
        ctx.tenantId,
        orderId,
        player.id,
        ctx.accountId,
        body && typeof body.note === "string" ? body.note : null,
      );
      await this.audit.record({
        tenantId: ctx.tenantId,
        actorType: "PLAYER",
        actorId: ctx.accountId,
        action: "dispatch.apply",
        resourceType: "order",
        resourceId: orderId,
        summary: "报名接单",
      });
      return { data: { ok: true } };
    } catch (error) {
      this.mapError(error);
    }
  }
}

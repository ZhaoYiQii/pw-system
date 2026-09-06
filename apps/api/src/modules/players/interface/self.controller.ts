import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import { PlayersService } from "../application/players.service.js";
import {
  AvailabilityNotFoundError,
  InvalidPlayerInputError,
  OverlappingAvailabilityError,
  PlayerNotFoundError,
} from "../domain/errors.js";
import { TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";

/** 陪玩自助端（绑定本人档案后使用；仅 PLAYER 角色账号）。 */
@Controller("api/v1/tenant/player")
export class PlayerSelfController {
  constructor(
    @Inject(PlayersService) private readonly players: PlayersService,
  ) {}

  private requirePlayer(req: AuthenticatedRequest): {
    tenantId: string;
    accountId: string;
  } {
    const p = req.principal;
    if (!p?.tenantId || p.role !== "PLAYER") {
      throw new ForbiddenException("需要陪玩身份");
    }
    return { tenantId: p.tenantId, accountId: p.sub };
  }

  private mapError(error: unknown): never {
    if (
      error instanceof PlayerNotFoundError ||
      error instanceof AvailabilityNotFoundError
    ) {
      throw new HttpException(
        "尚未绑定陪玩档案或记录不存在",
        HttpStatus.NOT_FOUND,
      );
    }
    if (error instanceof OverlappingAvailabilityError)
      throw new HttpException(error.message, HttpStatus.CONFLICT);
    if (error instanceof InvalidPlayerInputError)
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    throw error;
  }

  private parseTime(value: unknown): Date {
    if (typeof value !== "string")
      throw new HttpException("需 ISO 时间字符串", HttpStatus.BAD_REQUEST);
    return new Date(value);
  }

  @TenantScope()
  @Get("me")
  async me(@Req() req: AuthenticatedRequest) {
    const ctx = this.requirePlayer(req);
    try {
      return {
        data: await this.players.getByAccount(ctx.tenantId, ctx.accountId),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Patch("me")
  async updateMe(
    @Req() req: AuthenticatedRequest,
    @Body() body: { acceptingOrders?: unknown },
  ) {
    const ctx = this.requirePlayer(req);
    if (typeof body.acceptingOrders !== "boolean") {
      throw new HttpException(
        "acceptingOrders 需为布尔",
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      return {
        data: await this.players.setAcceptingByAccount(
          ctx.tenantId,
          ctx.accountId,
          body.acceptingOrders,
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Post("availability")
  async addAvailability(
    @Req() req: AuthenticatedRequest,
    @Body() body: { startsAt?: unknown; endsAt?: unknown; reason?: unknown },
  ) {
    const ctx = this.requirePlayer(req);
    try {
      const input: { startsAt: Date; endsAt: Date; reason?: string | null } = {
        startsAt: this.parseTime(body.startsAt),
        endsAt: this.parseTime(body.endsAt),
      };
      if (body.reason !== undefined)
        input.reason = body.reason as string | null;
      await this.players.addAvailabilityByAccount(
        ctx.tenantId,
        ctx.accountId,
        input,
      );
      return {
        data: await this.players.getByAccount(ctx.tenantId, ctx.accountId),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Delete("availability/:availabilityId")
  async removeAvailability(
    @Req() req: AuthenticatedRequest,
    @Param("availabilityId") availabilityId: string,
  ) {
    const ctx = this.requirePlayer(req);
    try {
      await this.players.removeAvailabilityByAccount(
        ctx.tenantId,
        ctx.accountId,
        availabilityId,
      );
      return { data: { ok: true } };
    } catch (error) {
      this.mapError(error);
    }
  }
}

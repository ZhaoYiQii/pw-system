import { Body, Controller, Delete, Get, HttpException, HttpStatus, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { PlayersService } from "../application/players.service.js";
import {
  AccountNotPlayerError,
  AvailabilityNotFoundError,
  DuplicatePlayerError,
  GameNotInTenantError,
  InvalidPlayerInputError,
  OverlappingAvailabilityError,
  PlayerAccountBoundError,
  PlayerNotFoundError,
  RegionNotInTenantError,
  SkillAlreadyExistsError,
  SkillNotFoundError
} from "../domain/errors.js";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";

function tenantIdOf(req: AuthenticatedRequest): string {
  const id = req.principal?.tenantId;
  if (!id) throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
  return id;
}

@Controller("api/v1/tenant/players")
export class PlayersController {
  constructor(@Inject(PlayersService) private readonly players: PlayersService) {}

  private mapError(error: unknown): never {
    if (error instanceof PlayerNotFoundError || error instanceof SkillNotFoundError || error instanceof AvailabilityNotFoundError) {
      throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    }
    if (error instanceof AccountNotPlayerError) throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    if (error instanceof PlayerAccountBoundError) throw new HttpException(error.message, HttpStatus.CONFLICT);
    if (error instanceof DuplicatePlayerError || error instanceof SkillAlreadyExistsError || error instanceof OverlappingAvailabilityError) {
      throw new HttpException(error.message, HttpStatus.CONFLICT);
    }
    if (error instanceof InvalidPlayerInputError || error instanceof GameNotInTenantError || error instanceof RegionNotInTenantError) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
    throw error;
  }

  private parseTime(value: unknown): Date {
    if (typeof value !== "string") throw new HttpException("需 ISO 时间字符串", HttpStatus.BAD_REQUEST);
    return new Date(value);
  }

  @TenantScope()
  @Permissions("player.manage")
  @Get()
  async list(@Req() req: AuthenticatedRequest, @Query("q") q?: unknown, @Query("status") status?: unknown) {
    const s = status === "ACTIVE" || status === "INACTIVE" ? status : undefined;
    const opts: { q?: string; status?: "ACTIVE" | "INACTIVE" } = {};
    if (typeof q === "string" && q.trim()) opts.q = q;
    if (s) opts.status = s;
    return { data: await this.players.list(tenantIdOf(req), opts) };
  }

  @TenantScope()
  @Permissions("player.manage")
  @Post()
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: { name?: unknown; mobile?: unknown; intro?: unknown; acceptingOrders?: unknown }
  ) {
    try {
      const input: { name: string; mobile?: string | null; intro?: string | null; acceptingOrders?: boolean } = {
        name: body.name as string
      };
      if (body.mobile !== undefined) input.mobile = body.mobile as string | null;
      if (body.intro !== undefined) input.intro = body.intro as string | null;
      if (typeof body.acceptingOrders === "boolean") input.acceptingOrders = body.acceptingOrders;
      return { data: await this.players.create(tenantIdOf(req), input) };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("player.manage")
  @Get(":id")
  async get(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    try {
      return { data: await this.players.get(tenantIdOf(req), id) };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("player.manage")
  @Patch(":id")
  async update(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: { name?: unknown; mobile?: unknown; intro?: unknown; status?: unknown; acceptingOrders?: unknown }
  ) {
    try {
      const input: { name?: string; mobile?: string | null; intro?: string | null; status?: "ACTIVE" | "INACTIVE"; acceptingOrders?: boolean } = {};
      if (body.name !== undefined) input.name = body.name as string;
      if (body.mobile !== undefined) input.mobile = body.mobile as string | null;
      if (body.intro !== undefined) input.intro = body.intro as string | null;
      if (body.status === "ACTIVE" || body.status === "INACTIVE") input.status = body.status;
      if (typeof body.acceptingOrders === "boolean") input.acceptingOrders = body.acceptingOrders;
      return { data: await this.players.update(tenantIdOf(req), id, input) };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("player.manage")
  @Delete(":id")
  async remove(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    try {
      await this.players.remove(tenantIdOf(req), id);
      return { data: { ok: true } };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("player.manage")
  @Post(":id/skills")
  async addSkill(
    @Req() req: AuthenticatedRequest,
    @Param("id") playerId: string,
    @Body() body: { gameId?: unknown; gameRegionId?: unknown; title?: unknown; note?: unknown }
  ) {
    try {
      const input: { gameId: string; gameRegionId?: string | null; title?: string | null; note?: string | null } = {
        gameId: body.gameId as string
      };
      if (body.gameRegionId !== undefined) input.gameRegionId = body.gameRegionId as string | null;
      if (body.title !== undefined) input.title = body.title as string | null;
      if (body.note !== undefined) input.note = body.note as string | null;
      return { data: await this.players.addSkill(tenantIdOf(req), playerId, input) };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("player.manage")
  @Delete(":id/skills/:skillId")
  async removeSkill(@Req() req: AuthenticatedRequest, @Param("id") playerId: string, @Param("skillId") skillId: string) {
    try {
      await this.players.removeSkill(tenantIdOf(req), playerId, skillId);
      return { data: { ok: true } };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("player.manage")
  @Post(":id/availability")
  async addAvailability(
    @Req() req: AuthenticatedRequest,
    @Param("id") playerId: string,
    @Body() body: { startsAt?: unknown; endsAt?: unknown; reason?: unknown }
  ) {
    try {
      const input: { startsAt: Date; endsAt: Date; reason?: string | null } = {
        startsAt: this.parseTime(body.startsAt),
        endsAt: this.parseTime(body.endsAt)
      };
      if (body.reason !== undefined) input.reason = body.reason as string | null;
      await this.players.addAvailability(tenantIdOf(req), playerId, input);
      return { data: await this.players.get(tenantIdOf(req), playerId) };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("player.manage")
  @Post(":id/account")
  async bind(@Req() req: AuthenticatedRequest, @Param("id") playerId: string, @Body() body: { accountId?: unknown }) {
    try {
      return {
        data: await this.players.bind(tenantIdOf(req), playerId, body.accountId as string)
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("player.manage")
  @Delete(":id/availability/:availabilityId")
  async removeAvailability(@Req() req: AuthenticatedRequest, @Param("id") playerId: string, @Param("availabilityId") availabilityId: string) {
    try {
      await this.players.removeAvailability(tenantIdOf(req), playerId, availabilityId);
      return { data: { ok: true } };
    } catch (error) {
      this.mapError(error);
    }
  }
}
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
import { Permissions, TenantScope } from "../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../common/auth/auth.guard.js";
import {
  PlayerApplicationAlreadyPlayerError,
  PlayerApplicationDuplicatePendingError,
  PlayerApplicationNotCustomerError,
  PlayerApplicationNotFoundError,
  PlayerApplicationNotPendingError,
  PlayerApplicationReviewReasonRequiredError,
} from "./player-applications.errors.js";
import { PlayerApplicationsService } from "./player-applications.service.js";

function tenantIdOf(req: AuthenticatedRequest): string {
  const id = req.principal?.tenantId;
  if (!id)
    throw new HttpException("tenant missing", HttpStatus.UNAUTHORIZED);
  return id;
}

@Controller("api/v1/tenant/player-applications")
export class PlayerApplicationsController {
  constructor(
    @Inject(PlayerApplicationsService)
    private readonly service: PlayerApplicationsService,
  ) {}

  @TenantScope()
  @Permissions("tenant.view")
  @Post()
  async apply(@Req() req: AuthenticatedRequest, @Body() body: { intro?: unknown }) {
    if (req.principal?.role !== "CUSTOMER") {
      throw new ForbiddenException("仅老板端账号可申请成为陪玩");
    }
    const intro = typeof body.intro === "string" ? body.intro : "";
    try {
      return {
        data: await this.service.apply(
          tenantIdOf(req),
          req.principal.sub,
          intro,
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("player.manage")
  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    return { data: await this.service.list(tenantIdOf(req)) };
  }

  @TenantScope()
  @Permissions("player.manage")
  @Post(":id/approve")
  async approve(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    try {
      return {
        data: await this.service.approve(
          tenantIdOf(req),
          req.principal?.sub ?? "system",
          id,
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("player.manage")
  @Post(":id/reject")
  async reject(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: { reason?: unknown },
  ) {
    const reason = typeof body.reason === "string" ? body.reason : "";
    try {
      return {
        data: await this.service.reject(
          tenantIdOf(req),
          req.principal?.sub ?? "system",
          id,
          reason,
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  private mapError(error: unknown): never {
    if (
      error instanceof PlayerApplicationReviewReasonRequiredError ||
      error instanceof PlayerApplicationNotCustomerError
    ) {
      throw new HttpException(
        error instanceof Error ? error.message : "申请不合法",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (
      error instanceof PlayerApplicationDuplicatePendingError ||
      error instanceof PlayerApplicationAlreadyPlayerError
    ) {
      throw new HttpException(
        error instanceof Error ? error.message : "状态冲突",
        HttpStatus.CONFLICT,
      );
    }
    if (
      error instanceof PlayerApplicationNotFoundError ||
      error instanceof PlayerApplicationNotPendingError
    ) {
      throw new HttpException(
        error instanceof Error ? error.message : "申请不存在",
        HttpStatus.NOT_FOUND,
      );
    }
    throw error;
  }
}

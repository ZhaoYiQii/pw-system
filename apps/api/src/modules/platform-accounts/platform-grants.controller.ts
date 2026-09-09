import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { Permissions, PlatformScope } from "../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../common/auth/auth.guard.js";
import {
  PlatformGrantsService,
  type PlatformGrantView,
} from "./platform-grants.service.js";

@Controller("api/v1/platform/grants")
export class PlatformGrantsController {
  constructor(
    @Inject(PlatformGrantsService)
    private readonly grants: PlatformGrantsService,
  ) {}

  @PlatformScope()
  @Permissions("platform.manage")
  @Get()
  async list(): Promise<{ data: PlatformGrantView[] }> {
    return { data: await this.grants.list() };
  }

  @PlatformScope()
  @Permissions("platform.manage")
  @Post()
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ): Promise<{ data: PlatformGrantView }> {
    try {
      return {
        data: await this.grants.create(req.principal?.sub ?? "", {
          granteeAccountId: body.granteeAccountId,
          tenantId: body.tenantId,
          reason: body.reason,
          durationMinutes: body.durationMinutes,
        }),
      };
    } catch (error) {
      throw new HttpException(
        error instanceof Error ? error.message : String(error),
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @PlatformScope()
  @Permissions("platform.manage")
  @Post(":id/revoke")
  @HttpCode(200)
  async revoke(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ): Promise<{ data: PlatformGrantView }> {
    try {
      return {
        data: await this.grants.revoke(req.principal?.sub ?? "", id),
      };
    } catch (error) {
      throw new HttpException(
        error instanceof Error ? error.message : String(error),
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}

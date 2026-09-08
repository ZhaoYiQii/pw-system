import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import type { AuthenticatedRequest } from "../../common/auth/auth.guard.js";
import { PlatformScope, Permissions } from "../../common/auth/decorators.js";
import {
  NotFoundError,
  PlatformAccountsService,
  type PlatformAccountView,
} from "./platform-accounts.service.js";

function handle(error: unknown): never {
  if (error instanceof NotFoundError) {
    throw new HttpException(error.message, HttpStatus.NOT_FOUND);
  }
  throw new HttpException(
    error instanceof Error ? error.message : String(error),
    HttpStatus.BAD_REQUEST,
  );
}

@Controller("api/v1/platform/accounts")
export class PlatformAccountsController {
  constructor(
    @Inject(PlatformAccountsService)
    private readonly accounts: PlatformAccountsService,
  ) {}

  @PlatformScope()
  @Permissions("platform.manage")
  @Get()
  async list(): Promise<{ data: PlatformAccountView[] }> {
    return { data: await this.accounts.list() };
  }

  @PlatformScope()
  @Permissions("platform.manage")
  @Post()
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ): Promise<{ data: PlatformAccountView }> {
    try {
      return {
        data: await this.accounts.create(req.principal?.sub ?? "", {
          username: body.username,
          password: body.password,
          role: body.role,
        }),
      };
    } catch (error) {
      handle(error);
    }
  }

  @PlatformScope()
  @Permissions("platform.manage")
  @Patch(":id/status")
  async setStatus(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: { status?: unknown },
  ): Promise<{ data: PlatformAccountView }> {
    try {
      return {
        data: await this.accounts.setStatus(
          req.principal?.sub ?? "",
          id,
          body.status,
        ),
      };
    } catch (error) {
      handle(error);
    }
  }

  @PlatformScope()
  @Permissions("platform.manage")
  @Patch(":id/role")
  async setRole(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: { role?: unknown },
  ): Promise<{ data: PlatformAccountView }> {
    try {
      return {
        data: await this.accounts.setRole(
          req.principal?.sub ?? "",
          id,
          body.role,
        ),
      };
    } catch (error) {
      handle(error);
    }
  }
}

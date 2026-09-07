import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { GameTemplateService } from "../application/game-template.service.js";
import {
  DuplicateGameTemplateError,
  InvalidGameTemplateError,
} from "../domain/errors.js";
import type {
  CreateGameTemplateInput,
  TemplateCopyLineInput,
  TemplateFieldInput,
  TemplatePositionInput,
  TemplateRankRuleInput,
  UpdateGameTemplateInput,
} from "../domain/game-template.js";

function tenantIdOf(req: AuthenticatedRequest): string {
  const id = req.principal?.tenantId;
  if (!id) {
    throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
  }
  return id;
}

@Controller("api/v1/tenant/game-templates")
export class GameTemplateController {
  constructor(
    @Inject(GameTemplateService)
    private readonly templates: GameTemplateService,
  ) {}

  private mapError(error: unknown): never {
    if (
      error instanceof DuplicateGameTemplateError ||
      error instanceof InvalidGameTemplateError
    ) {
      throw new HttpException(
        error.message,
        error instanceof DuplicateGameTemplateError
          ? HttpStatus.CONFLICT
          : HttpStatus.BAD_REQUEST,
      );
    }
    throw error;
  }

  @TenantScope()
  @Permissions("gameDispatch.manage")
  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    return { data: await this.templates.list(tenantIdOf(req)) };
  }

  @TenantScope()
  @Permissions("gameDispatch.manage")
  @Get(":id")
  async get(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    try {
      return { data: await this.templates.get(tenantIdOf(req), id) };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("gameDispatch.manage")
  @Post()
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      const input: CreateGameTemplateInput = { name: body.name as string };
      if (body.enabled !== undefined) input.enabled = body.enabled === true;
      if (body.fields !== undefined)
        input.fields = body.fields as TemplateFieldInput[];
      if (body.positions !== undefined)
        input.positions = body.positions as TemplatePositionInput[];
      if (body.rankRules !== undefined)
        input.rankRules = body.rankRules as TemplateRankRuleInput[];
      if (body.copyLines !== undefined)
        input.copyLines = body.copyLines as TemplateCopyLineInput[];
      return { data: await this.templates.create(tenantIdOf(req), input) };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("gameDispatch.manage")
  @Patch(":id")
  async update(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      const input: UpdateGameTemplateInput = {};
      if (body.name !== undefined) input.name = body.name as string;
      if (body.enabled !== undefined) input.enabled = body.enabled === true;
      if (body.fields !== undefined)
        input.fields = body.fields as TemplateFieldInput[];
      if (body.positions !== undefined)
        input.positions = body.positions as TemplatePositionInput[];
      if (body.rankRules !== undefined)
        input.rankRules = body.rankRules as TemplateRankRuleInput[];
      if (body.copyLines !== undefined)
        input.copyLines = body.copyLines as TemplateCopyLineInput[];
      return { data: await this.templates.update(tenantIdOf(req), id, input) };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("gameDispatch.manage")
  @Delete(":id")
  async remove(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    try {
      await this.templates.remove(tenantIdOf(req), id);
      return { data: { ok: true } };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("gameDispatch.manage")
  @Post(":id/copy")
  async copy(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    try {
      return { data: await this.templates.copy(tenantIdOf(req), id) };
    } catch (error) {
      this.mapError(error);
    }
  }
}

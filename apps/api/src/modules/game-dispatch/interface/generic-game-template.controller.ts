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
  Query,
  Req,
  Delete,
} from "@nestjs/common";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from "@nestjs/swagger";
import { GenericGameTemplateService } from "../application/generic-game-template.service.js";
import { GenericTemplateError } from "../domain/errors.js";
import {
  dataSchema,
  genericTemplateCopyBodySchema,
  genericTemplateCreateBodySchema,
  genericTemplateCursorQuerySchema,
  genericTemplateDeleteResultSchema,
  genericTemplateDeleteRestrictedErrorSchema,
  genericTemplateDraftViewSchema,
  genericTemplateErrorSchema,
  genericTemplateExpectedRevisionBodySchema,
  genericTemplateExpectedRevisionQuerySchema,
  genericTemplateGameIdQuerySchema,
  genericTemplateGameScopeQuerySchema,
  genericTemplateLimitQuerySchema,
  genericTemplateListPageSchema,
  genericTemplatePublishBodySchema,
  genericTemplatePublishedListSchema,
  genericTemplateRestoreBodySchema,
  genericTemplateRestoreResultSchema,
  genericTemplateRevisionConflictErrorSchema,
  genericTemplateSaveDraftBodySchema,
  genericTemplateSaveDraftResultSchema,
  genericTemplateSearchQuerySchema,
  genericTemplateSortQuerySchema,
  genericTemplateStatusQuerySchema,
  genericTemplateValidationErrorSchema,
  genericTemplateVersionFormSchema,
  genericTemplateVersionsPageSchema,
} from "../../../openapi/schemas.js";
import {
  GENERIC_TEMPLATE_GAME_SCOPES,
  GENERIC_TEMPLATE_SORTS,
  GENERIC_TEMPLATE_STATUSES,
  type CopyGenericTemplateInput,
  type CreateGenericTemplateInput,
  type ExpectedRevisionInput,
  type GenericTemplateListQuery,
  type GenericTemplateGameScope,
  type GenericTemplateSort,
  type GenericTemplateStatus,
  type PublishGenericTemplateInput,
  type RestoreGenericTemplateInput,
  type SaveGenericTemplateDraftInput,
} from "../domain/game-template-management.js";

interface RequestPrincipal {
  tenantId: string;
  actorId: string;
}

/** tenantId/actorId 只来自服务端认证主体，客户端提交的同名字段在 API 边界已被拒绝。 */
function principalOf(req: AuthenticatedRequest): RequestPrincipal {
  const tenantId = req.principal?.tenantId;
  const actorId = req.principal?.sub;
  if (!tenantId || !actorId) {
    throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
  }
  return { tenantId, actorId };
}

function parseSort(value: unknown): GenericTemplateSort {
  return typeof value === "string" &&
    (GENERIC_TEMPLATE_SORTS as readonly string[]).includes(value)
    ? (value as GenericTemplateSort)
    : "UPDATED_DESC";
}

/** 游戏范围：非法值忽略（保持默认 ALL），互斥关系已由 API 边界校验。 */
function parseGameScope(value: unknown): GenericTemplateGameScope | undefined {
  return typeof value === "string" &&
    (GENERIC_TEMPLATE_GAME_SCOPES as readonly string[]).includes(value) &&
    value !== "ALL"
    ? (value as GenericTemplateGameScope)
    : undefined;
}

function parseStatus(value: unknown): GenericTemplateStatus | undefined {
  return typeof value === "string" &&
    (GENERIC_TEMPLATE_STATUSES as readonly string[]).includes(value)
    ? (value as GenericTemplateStatus)
    : undefined;
}

function parseLimit(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/** expectedRevision 在 DELETE 上来自 query，POST 上来自 body。 */
function parseExpectedRevision(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)) {
    return Number(value);
  }
  throw new HttpException(
    {
      code: "TEMPLATE_REVISION_CONFLICT",
      message: "expectedRevision 必须是十进制非负整数",
      details: { expectedRevision: value ?? null },
    },
    HttpStatus.CONFLICT,
  );
}

@ApiTags("通用派单模板（S2）")
@ApiTags("通用派单模板（S2）")
@Controller("api/v1/tenant/game-dispatch-templates")
export class GenericGameTemplateController {
  constructor(
    @Inject(GenericGameTemplateService)
    private readonly templates: GenericGameTemplateService,
  ) {}

  /** 受控业务错误统一映射为 { code, message, details }；其余异常继续抛出。 */
  private fail(error: unknown): never {
    if (error instanceof GenericTemplateError) {
      throw new HttpException(error.toResponse(), error.status);
    }
    throw error;
  }

  @TenantScope()
  @Permissions("gameTemplate.view")
  @Get()
  @ApiOperation({ summary: "模板摘要列表（游标分页，不含 config）" })
  @ApiQuery({
    name: "gameId",
    required: false,
    schema: genericTemplateGameIdQuerySchema as never,
  })
  @ApiQuery({
    name: "gameScope",
    required: false,
    schema: genericTemplateGameScopeQuerySchema as never,
  })
  @ApiQuery({
    name: "status",
    required: false,
    schema: genericTemplateStatusQuerySchema as never,
  })
  @ApiQuery({
    name: "q",
    required: false,
    schema: genericTemplateSearchQuerySchema as never,
  })
  @ApiQuery({
    name: "sort",
    required: false,
    schema: genericTemplateSortQuerySchema as never,
  })
  @ApiQuery({
    name: "cursor",
    required: false,
    schema: genericTemplateCursorQuerySchema as never,
  })
  @ApiQuery({
    name: "limit",
    required: false,
    schema: genericTemplateLimitQuerySchema as never,
  })
  @ApiOkResponse({ schema: genericTemplateListPageSchema as never })
  @ApiBadRequestResponse({ schema: genericTemplateErrorSchema as never })
  @ApiForbiddenResponse({ schema: genericTemplateErrorSchema as never })
  async list(
    @Req() req: AuthenticatedRequest,
    @Query() query: Record<string, unknown>,
  ) {
    const { tenantId } = principalOf(req);
    const parsed: GenericTemplateListQuery = {
      sort: parseSort(query.sort),
      limit: parseLimit(query.limit, 30),
      ...(typeof query.gameId === "string" ? { gameId: query.gameId } : {}),
      ...(parseGameScope(query.gameScope) === undefined
        ? {}
        : {
            gameScope: parseGameScope(
              query.gameScope,
            ) as GenericTemplateGameScope,
          }),
      ...(typeof query.q === "string" ? { q: query.q } : {}),
      ...(typeof query.cursor === "string" ? { cursor: query.cursor } : {}),
      ...(parseStatus(query.status) === undefined
        ? {}
        : { status: parseStatus(query.status) as GenericTemplateStatus }),
    };
    try {
      return await this.templates.list(tenantId, parsed);
    } catch (error) {
      this.fail(error);
    }
  }

  @TenantScope()
  @Permissions("gameDispatch.manage")
  @Get("published")
  @ApiOperation({
    summary: "该游戏可派单的模板（未归档且有生效版本，默认优先）",
  })
  @ApiQuery({
    name: "gameId",
    required: true,
    schema: genericTemplateGameIdQuerySchema as never,
  })
  @ApiOkResponse({ schema: genericTemplatePublishedListSchema as never })
  @ApiBadRequestResponse({ schema: genericTemplateErrorSchema as never })
  @ApiForbiddenResponse({ schema: genericTemplateErrorSchema as never })
  async listPublished(
    @Req() req: AuthenticatedRequest,
    @Query() query: Record<string, unknown>,
  ) {
    const { tenantId } = principalOf(req);
    try {
      return {
        data: await this.templates.listPublished(
          tenantId,
          String(query.gameId ?? ""),
        ),
      };
    } catch (error) {
      this.fail(error);
    }
  }
  @TenantScope()
  @Permissions("gameDispatch.manage")
  @Get("versions/:versionId/form")
  @ApiOperation({ summary: "锁定发布版本的派单表单配置" })
  @ApiOkResponse({ schema: genericTemplateVersionFormSchema as never })
  @ApiForbiddenResponse({ schema: genericTemplateErrorSchema as never })
  @ApiNotFoundResponse({ schema: genericTemplateErrorSchema as never })
  @ApiUnprocessableEntityResponse({
    schema: genericTemplateErrorSchema as never,
  })
  async getVersionForm(
    @Req() req: AuthenticatedRequest,
    @Param("versionId") versionId: string,
  ) {
    const { tenantId } = principalOf(req);
    try {
      return { data: await this.templates.getVersionForm(tenantId, versionId) };
    } catch (error) {
      this.fail(error);
    }
  }

  @TenantScope()
  @Permissions("gameTemplate.edit")
  @Post()
  @ApiOperation({ summary: "创建模板（生成最小有效 v2 草稿）" })
  @ApiBody({ schema: genericTemplateCreateBodySchema as never })
  @ApiCreatedResponse({
    schema: dataSchema(genericTemplateDraftViewSchema) as never,
  })
  @ApiBadRequestResponse({ schema: genericTemplateErrorSchema as never })
  @ApiForbiddenResponse({ schema: genericTemplateErrorSchema as never })
  @ApiConflictResponse({ schema: genericTemplateErrorSchema as never })
  @ApiUnprocessableEntityResponse({
    schema: genericTemplateErrorSchema as never,
  })
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    const { tenantId, actorId } = principalOf(req);
    const input: CreateGenericTemplateInput = {
      gameId: body.gameId as string,
      name: body.name as string,
      description: (body.description ?? null) as string | null,
    };
    try {
      return {
        data: await this.templates.createDraft(tenantId, actorId, input),
      };
    } catch (error) {
      this.fail(error);
    }
  }

  @TenantScope()
  @Permissions("gameTemplate.view")
  @Get(":id/draft")
  @ApiOperation({ summary: "读取草稿与生效版本摘要" })
  @ApiOkResponse({
    schema: dataSchema(genericTemplateDraftViewSchema) as never,
  })
  @ApiNotFoundResponse({ schema: genericTemplateErrorSchema as never })
  @ApiUnprocessableEntityResponse({
    schema: genericTemplateErrorSchema as never,
  })
  async getDraft(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    const { tenantId } = principalOf(req);
    try {
      return { data: await this.templates.getDraft(tenantId, id) };
    } catch (error) {
      this.fail(error);
    }
  }

  @TenantScope()
  @Permissions("gameTemplate.edit")
  @Patch(":id/draft")
  @ApiOperation({ summary: "整份保存草稿（expectedRevision 乐观锁）" })
  @ApiBody({ schema: genericTemplateSaveDraftBodySchema as never })
  @ApiOkResponse({
    schema: dataSchema(genericTemplateSaveDraftResultSchema) as never,
  })
  @ApiBadRequestResponse({ schema: genericTemplateErrorSchema as never })
  @ApiForbiddenResponse({ schema: genericTemplateErrorSchema as never })
  @ApiNotFoundResponse({ schema: genericTemplateErrorSchema as never })
  @ApiConflictResponse({
    schema: genericTemplateRevisionConflictErrorSchema as never,
  })
  @ApiUnprocessableEntityResponse({
    schema: genericTemplateValidationErrorSchema as never,
  })
  async saveDraft(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const { tenantId, actorId } = principalOf(req);
    const input = {
      expectedRevision: body.expectedRevision,
      config: body.config,
    } as unknown as SaveGenericTemplateDraftInput;
    try {
      return {
        data: await this.templates.saveDraft(tenantId, actorId, id, input),
      };
    } catch (error) {
      this.fail(error);
    }
  }

  @TenantScope()
  @Permissions("gameTemplate.publish")
  @Post(":id/publish")
  @ApiOperation({ summary: "发布当前草稿为不可变版本" })
  @ApiBody({ schema: genericTemplatePublishBodySchema as never })
  @ApiCreatedResponse({
    schema: dataSchema(genericTemplateDraftViewSchema) as never,
  })
  @ApiBadRequestResponse({ schema: genericTemplateErrorSchema as never })
  @ApiForbiddenResponse({ schema: genericTemplateErrorSchema as never })
  @ApiNotFoundResponse({ schema: genericTemplateErrorSchema as never })
  @ApiConflictResponse({
    schema: genericTemplateRevisionConflictErrorSchema as never,
  })
  @ApiUnprocessableEntityResponse({
    schema: genericTemplateValidationErrorSchema as never,
  })
  async publish(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const { tenantId, actorId } = principalOf(req);
    // 只接受 expectedRevision 与溯源/备注；发布配置永远取服务端当前草稿。
    const input = {
      expectedRevision: body.expectedRevision,
      changeNote: (body.changeNote ?? null) as string | null,
      sourceVersionId: (body.sourceVersionId ?? null) as string | null,
    } as unknown as PublishGenericTemplateInput;
    try {
      return {
        data: await this.templates.publish(tenantId, actorId, id, input),
      };
    } catch (error) {
      this.fail(error);
    }
  }

  @TenantScope()
  @Permissions("gameTemplate.view")
  @Get(":id/versions")
  @ApiOperation({ summary: "版本历史（游标分页，只返回摘要）" })
  @ApiQuery({
    name: "cursor",
    required: false,
    schema: genericTemplateCursorQuerySchema as never,
  })
  @ApiQuery({
    name: "limit",
    required: false,
    schema: genericTemplateLimitQuerySchema as never,
  })
  @ApiOkResponse({ schema: genericTemplateVersionsPageSchema as never })
  @ApiBadRequestResponse({ schema: genericTemplateErrorSchema as never })
  @ApiForbiddenResponse({ schema: genericTemplateErrorSchema as never })
  @ApiNotFoundResponse({ schema: genericTemplateErrorSchema as never })
  async listVersions(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Query() query: Record<string, unknown>,
  ) {
    const { tenantId } = principalOf(req);
    const limit = parseLimit(query.limit, 20);
    try {
      return await this.templates.listVersions(tenantId, id, {
        limit,
        ...(typeof query.cursor === "string" ? { cursor: query.cursor } : {}),
      });
    } catch (error) {
      this.fail(error);
    }
  }

  @TenantScope()
  @Permissions("gameTemplate.publish")
  @Post(":id/restore")
  @ApiOperation({ summary: "把历史 v2 版本还原为草稿（不直接上线）" })
  @ApiBody({ schema: genericTemplateRestoreBodySchema as never })
  @ApiCreatedResponse({
    schema: dataSchema(genericTemplateRestoreResultSchema) as never,
  })
  @ApiBadRequestResponse({ schema: genericTemplateErrorSchema as never })
  @ApiForbiddenResponse({ schema: genericTemplateErrorSchema as never })
  @ApiNotFoundResponse({ schema: genericTemplateErrorSchema as never })
  @ApiConflictResponse({
    schema: genericTemplateRevisionConflictErrorSchema as never,
  })
  @ApiUnprocessableEntityResponse({
    schema: genericTemplateErrorSchema as never,
  })
  async restore(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const { tenantId, actorId } = principalOf(req);
    const input = {
      versionId: body.versionId,
      expectedRevision: body.expectedRevision,
    } as unknown as RestoreGenericTemplateInput;
    try {
      return {
        data: await this.templates.restoreVersion(tenantId, actorId, id, input),
      };
    } catch (error) {
      this.fail(error);
    }
  }

  @TenantScope()
  @Permissions("gameTemplate.edit")
  @Post(":id/copy")
  @ApiOperation({ summary: "复制当前草稿到同租户目标游戏（独立 DRAFT）" })
  @ApiBody({ schema: genericTemplateCopyBodySchema as never })
  @ApiCreatedResponse({
    schema: dataSchema(genericTemplateDraftViewSchema) as never,
  })
  @ApiBadRequestResponse({ schema: genericTemplateErrorSchema as never })
  @ApiForbiddenResponse({ schema: genericTemplateErrorSchema as never })
  @ApiNotFoundResponse({ schema: genericTemplateErrorSchema as never })
  @ApiConflictResponse({ schema: genericTemplateErrorSchema as never })
  @ApiUnprocessableEntityResponse({
    schema: genericTemplateErrorSchema as never,
  })
  async copy(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const { tenantId, actorId } = principalOf(req);
    const input = {
      targetGameId: body.targetGameId,
      newName: body.newName,
    } as unknown as CopyGenericTemplateInput;
    try {
      return {
        data: await this.templates.copyTemplate(tenantId, actorId, id, input),
      };
    } catch (error) {
      this.fail(error);
    }
  }

  @TenantScope()
  @Permissions("gameTemplate.edit")
  @Post(":id/default")
  @ApiOperation({ summary: "设为该游戏默认模板（同游戏唯一）" })
  @ApiBody({ schema: genericTemplateExpectedRevisionBodySchema as never })
  @ApiCreatedResponse({
    schema: dataSchema(genericTemplateDraftViewSchema) as never,
  })
  @ApiForbiddenResponse({ schema: genericTemplateErrorSchema as never })
  @ApiNotFoundResponse({ schema: genericTemplateErrorSchema as never })
  @ApiConflictResponse({
    schema: genericTemplateRevisionConflictErrorSchema as never,
  })
  @ApiUnprocessableEntityResponse({
    schema: genericTemplateErrorSchema as never,
  })
  async setDefault(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const { tenantId, actorId } = principalOf(req);
    const input: ExpectedRevisionInput = {
      expectedRevision: parseExpectedRevision(body.expectedRevision),
    };
    try {
      return {
        data: await this.templates.setDefault(tenantId, actorId, id, input),
      };
    } catch (error) {
      this.fail(error);
    }
  }

  @TenantScope()
  @Permissions("gameTemplate.archive")
  @Post(":id/archive")
  @ApiOperation({ summary: "归档模板（保留草稿/版本/历史）" })
  @ApiBody({ schema: genericTemplateExpectedRevisionBodySchema as never })
  @ApiCreatedResponse({
    schema: dataSchema(genericTemplateDraftViewSchema) as never,
  })
  @ApiForbiddenResponse({ schema: genericTemplateErrorSchema as never })
  @ApiNotFoundResponse({ schema: genericTemplateErrorSchema as never })
  @ApiConflictResponse({
    schema: genericTemplateRevisionConflictErrorSchema as never,
  })
  async archive(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const { tenantId, actorId } = principalOf(req);
    const input: ExpectedRevisionInput = {
      expectedRevision: parseExpectedRevision(body.expectedRevision),
    };
    try {
      return {
        data: await this.templates.archiveTemplate(
          tenantId,
          actorId,
          id,
          input,
        ),
      };
    } catch (error) {
      this.fail(error);
    }
  }

  @TenantScope()
  @Permissions("gameTemplate.archive")
  @Post(":id/unarchive")
  @ApiOperation({ summary: "取消归档（按 activeVersionId 恢复状态）" })
  @ApiBody({ schema: genericTemplateExpectedRevisionBodySchema as never })
  @ApiCreatedResponse({
    schema: dataSchema(genericTemplateDraftViewSchema) as never,
  })
  @ApiForbiddenResponse({ schema: genericTemplateErrorSchema as never })
  @ApiNotFoundResponse({ schema: genericTemplateErrorSchema as never })
  @ApiConflictResponse({
    schema: genericTemplateRevisionConflictErrorSchema as never,
  })
  async unarchive(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const { tenantId, actorId } = principalOf(req);
    const input: ExpectedRevisionInput = {
      expectedRevision: parseExpectedRevision(body.expectedRevision),
    };
    try {
      return {
        data: await this.templates.unarchiveTemplate(
          tenantId,
          actorId,
          id,
          input,
        ),
      };
    } catch (error) {
      this.fail(error);
    }
  }

  @TenantScope()
  @Permissions("gameTemplate.archive")
  @Delete(":id")
  @ApiOperation({ summary: "删除未发布且无引用的模板（否则应归档）" })
  @ApiQuery({
    name: "expectedRevision",
    required: true,
    schema: genericTemplateExpectedRevisionQuerySchema as never,
  })
  @ApiOkResponse({
    schema: dataSchema(genericTemplateDeleteResultSchema) as never,
  })
  @ApiForbiddenResponse({ schema: genericTemplateErrorSchema as never })
  @ApiNotFoundResponse({ schema: genericTemplateErrorSchema as never })
  @ApiConflictResponse({
    schema: genericTemplateDeleteRestrictedErrorSchema as never,
  })
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Query() query: Record<string, unknown>,
  ) {
    const { tenantId, actorId } = principalOf(req);
    try {
      await this.templates.deleteTemplate(tenantId, actorId, id, {
        expectedRevision: parseExpectedRevision(query.expectedRevision),
      });
      return { data: { ok: true } };
    } catch (error) {
      this.fail(error);
    }
  }
}

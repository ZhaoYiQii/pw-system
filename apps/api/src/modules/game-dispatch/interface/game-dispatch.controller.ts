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
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiBody,
  ApiQuery,
  ApiConflictResponse,
} from "@nestjs/swagger";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import {
  dataArraySchema,
  gameDispatchOrderViewSchema,
  gameDispatchListPageSchema,
  genericTemplateErrorSchema,
  playerApplicationViewSchema,
  assignmentBodySchema,
  playerBreachItemSchema,
  playerBreachBodySchema,
  playerBreachViewSchema,
  playerHallOrderViewSchema,
  slotReleaseBodySchema,
  slotReleaseViewSchema,
} from "../../../openapi/schemas.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { GameDispatchService } from "../application/game-dispatch.service.js";
import { PlayerBreachService } from "../application/player-breach.service.js";
import { mapGameDispatchError } from "./game-dispatch-error.mapper.js";

function tenantIdOf(req: AuthenticatedRequest): string {
  const id = req.principal?.tenantId;
  if (!id)
    throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
  return id;
}

@Controller("api/v1/tenant/game-dispatch")
export class GameDispatchController {
  constructor(
    @Inject(GameDispatchService)
    private readonly dispatch: GameDispatchService,
    @Inject(PlayerBreachService)
    private readonly breaches: PlayerBreachService,
  ) {}

  private mapError(error: unknown): never {
    mapGameDispatchError(error);
  }

  @TenantScope()
  @Permissions("gameDispatch.manage")
  @Get()
  @ApiQuery({
    name: "status",
    required: false,
    type: String,
    description: "按订单状态过滤",
  })
  @ApiQuery({
    name: "limit",
    required: false,
    type: Number,
    description: "每页条数 1–100，默认 20",
  })
  @ApiQuery({
    name: "offset",
    required: false,
    type: Number,
    description: "分页偏移，默认 0",
  })
  @ApiQuery({
    name: "from",
    required: false,
    type: String,
    description: "创建时间起（ISO 8601，含边界）",
  })
  @ApiQuery({
    name: "to",
    required: false,
    type: String,
    description: "创建时间止（ISO 8601，含边界）",
  })
  @ApiQuery({
    name: "sort",
    required: false,
    type: String,
    description: "created_desc（默认）| created_asc | status",
  })
  @ApiQuery({
    name: "gameId",
    required: false,
    type: String,
    description: "按游戏过滤（v1 派单按模板快照的游戏归属兜底）",
  })
  @ApiQuery({
    name: "playerId",
    required: false,
    type: String,
    description: "按已选中陪玩过滤（OrderSlot.playerId）",
  })
  @ApiQuery({
    name: "customerProfileId",
    required: false,
    type: String,
    description: "按老板档案过滤（Order.customerProfileId）",
  })
  @ApiQuery({
    name: "minAmountFen",
    required: false,
    type: String,
    description: "金额区间下界（整数分，含边界），作用于预估金额",
  })
  @ApiQuery({
    name: "maxAmountFen",
    required: false,
    type: String,
    description: "金额区间上界（整数分，含边界），作用于预估金额",
  })
  @ApiOkResponse({
    schema: gameDispatchListPageSchema as never,
    description: "派单列表页（data 为当前页，total 为筛选后的总条数）",
  })
  async list(
    @Req() req: AuthenticatedRequest,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("sort") sort?: string,
    @Query("gameId") gameId?: string,
    @Query("playerId") playerId?: string,
    @Query("customerProfileId") customerProfileId?: string,
    @Query("minAmountFen") minAmountFen?: string,
    @Query("maxAmountFen") maxAmountFen?: string,
  ) {
    const parsedLimit = limit === undefined ? undefined : Number(limit);
    const parsedOffset = offset === undefined ? undefined : Number(offset);
    // 保留 `{ data: [...] }` 形状（既有前端与 E2E 依赖），额外返回分页元信息。
    const page = await this.dispatch.list(tenantIdOf(req), {
      ...(status ? { status } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(sort ? { sort } : {}),
      ...(gameId ? { gameId } : {}),
      ...(playerId ? { playerId } : {}),
      ...(customerProfileId ? { customerProfileId } : {}),
      ...(minAmountFen ? { minAmountFen } : {}),
      ...(maxAmountFen ? { maxAmountFen } : {}),
      ...(parsedLimit === undefined ? {} : { limit: parsedLimit }),
      ...(parsedOffset === undefined ? {} : { offset: parsedOffset }),
    });
    return { data: page.items, total: page.total };
  }

  @TenantScope()
  @Permissions("gameDispatch.manage")
  @Post("orders")
  async createDraft(
    @Req() req: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      const input: {
        templateId: string;
        customerProfileId: string;
        formValues: Record<string, string>;
        desiredStartAt?: string | null;
        durationMinutes: number;
        lines: { positionLabel: string; requiredCount: number }[];
      } = {
        templateId: body.templateId as string,
        customerProfileId: body.customerProfileId as string,
        formValues: (body.formValues ?? {}) as Record<string, string>,
        durationMinutes: body.durationMinutes as number,
        lines: body.lines as {
          positionLabel: string;
          requiredCount: number;
        }[],
      };
      if (body.desiredStartAt !== undefined)
        input.desiredStartAt = body.desiredStartAt as string | null;
      return {
        data: await this.dispatch.createDraft(
          tenantIdOf(req),
          req.principal?.sub ?? "system",
          input,
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("order.manage")
  @Post("customer/orders")
  async customerCreateDraft(
    @Req() req: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    if (req.principal?.role !== "CUSTOMER") {
      throw new HttpException("需要老板身份", HttpStatus.FORBIDDEN);
    }
    try {
      const input: {
        templateId: string;
        formValues: Record<string, string>;
        desiredStartAt?: string | null;
        durationMinutes: number;
        lines: { positionLabel: string; requiredCount: number }[];
      } = {
        templateId: body.templateId as string,
        formValues: (body.formValues ?? {}) as Record<string, string>,
        durationMinutes: body.durationMinutes as number,
        lines: body.lines as {
          positionLabel: string;
          requiredCount: number;
        }[],
      };
      if (body.desiredStartAt !== undefined)
        input.desiredStartAt = body.desiredStartAt as string | null;
      return {
        data: await this.dispatch.customerCreateDraft(
          tenantIdOf(req),
          req.principal.sub,
          input,
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("order.manage")
  @Get("customer/templates")
  async customerTemplates(@Req() req: AuthenticatedRequest) {
    if (req.principal?.role !== "CUSTOMER") {
      throw new HttpException("需要老板身份", HttpStatus.FORBIDDEN);
    }
    return {
      data: await this.dispatch.customerTemplates(tenantIdOf(req)),
    };
  }

  @TenantScope()
  @Permissions("order.manage")
  @Get("customer/templates/:id")
  async customerTemplate(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    if (req.principal?.role !== "CUSTOMER") {
      throw new HttpException("需要老板身份", HttpStatus.FORBIDDEN);
    }
    try {
      return {
        data: await this.dispatch.customerTemplate(tenantIdOf(req), id),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("gameDispatch.manage")
  @Get("orders/:orderId")
  @ApiOkResponse({ schema: gameDispatchOrderViewSchema as never })
  @ApiNotFoundResponse({ schema: genericTemplateErrorSchema as never })
  async view(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
  ) {
    try {
      // 商家端订单详情：按 CS 端口过滤（客户自查走 customer/orders/:orderId/select）。
      return { data: await this.dispatch.view(tenantIdOf(req), orderId, "CS") };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("gameDispatch.manage")
  @Get("orders/:orderId/applications")
  async applications(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
  ) {
    try {
      return {
        data: await this.dispatch.applications(tenantIdOf(req), orderId),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("dispatch.manage")
  @Get("player/orders/:orderId/signup")
  async playerSignup(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
  ) {
    if (req.principal?.role !== "PLAYER") {
      throw new HttpException("需要陪玩身份", HttpStatus.FORBIDDEN);
    }
    try {
      return {
        data: await this.dispatch.playerSignup(
          tenantIdOf(req),
          req.principal.sub,
          orderId,
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("order.manage")
  @Get("customer/orders/:orderId/select")
  async customerSelect(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
  ) {
    if (req.principal?.role !== "CUSTOMER") {
      throw new HttpException("需要老板身份", HttpStatus.FORBIDDEN);
    }
    try {
      return {
        data: await this.dispatch.customerView(
          tenantIdOf(req),
          req.principal.sub,
          orderId,
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("order.manage")
  @Post("customer/orders/:orderId/assignment")
  async customerAssign(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
    @Body() body: { applicationIds?: unknown },
  ) {
    if (req.principal?.role !== "CUSTOMER") {
      throw new HttpException("需要老板身份", HttpStatus.FORBIDDEN);
    }
    try {
      const ids = Array.isArray(body.applicationIds)
        ? body.applicationIds.filter((v): v is string => typeof v === "string")
        : [];
      return {
        data: await this.dispatch.customerAssign(
          tenantIdOf(req),
          req.principal.sub,
          orderId,
          ids,
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("gameDispatch.manage")
  @Get("orders/:orderId/copy-text")
  async copy(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
  ) {
    try {
      return { data: await this.dispatch.copy(tenantIdOf(req), orderId) };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("gameDispatch.manage")
  @Post("orders/:orderId/publish")
  async publish(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
  ) {
    try {
      return {
        data: await this.dispatch.publish(
          tenantIdOf(req),
          req.principal?.sub ?? "system",
          orderId,
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("gameDispatch.manage")
  @Post("orders/:orderId/confirm-settlement")
  async confirmSettlement(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
  ) {
    try {
      return {
        data: await this.dispatch.confirmSettlement(
          tenantIdOf(req),
          req.principal?.sub ?? "system",
          orderId,
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("dispatch.manage")
  @Post("orders/:orderId/lines/:lineId/applications")
  async apply(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
    @Param("lineId") lineId: string,
  ) {
    try {
      const app = await this.dispatch.apply(
        tenantIdOf(req),
        req.principal?.sub ?? "",
        orderId,
        lineId,
      );
      return { data: app };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("dispatch.manage")
  @Post("applications/:id/withdraw")
  async withdraw(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    try {
      await this.dispatch.withdraw(
        tenantIdOf(req),
        req.principal?.sub ?? "",
        id,
      );
      return { data: { ok: true } };
    } catch (error) {
      this.mapError(error);
    }
  }

  /** 陪玩端报名大厅（Task 4 / 设计规格 §3.5）：只列仍可报名的派单与位置行。 */
  @TenantScope()
  @Permissions("dispatch.manage")
  @Get("player/hall")
  @ApiOperation({
    summary: "陪玩端报名大厅（含每个位置行的报名情况与我的报名）",
  })
  @ApiOkResponse({
    schema: dataArraySchema(playerHallOrderViewSchema) as never,
  })
  @ApiForbiddenResponse({ schema: genericTemplateErrorSchema as never })
  @ApiNotFoundResponse({ schema: genericTemplateErrorSchema as never })
  async playerHall(@Req() req: AuthenticatedRequest) {
    if (req.principal?.role !== "PLAYER")
      throw new ForbiddenException("需要陪玩身份");
    try {
      return {
        data: await this.dispatch.playerHall(
          tenantIdOf(req),
          req.principal.sub,
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  /** 陪玩端「我的接单」（Task 4）：报名状态 + 选中后的档位 id（服务与报单入口）。 */
  @TenantScope()
  @Permissions("dispatch.manage")
  @Get("player/applications")
  @ApiOperation({ summary: "陪玩端我的报名与选中档位（含是否可自助取消）" })
  @ApiOkResponse({
    schema: dataArraySchema(playerApplicationViewSchema) as never,
  })
  @ApiForbiddenResponse({ schema: genericTemplateErrorSchema as never })
  @ApiNotFoundResponse({ schema: genericTemplateErrorSchema as never })
  async playerApplications(@Req() req: AuthenticatedRequest) {
    if (req.principal?.role !== "PLAYER")
      throw new ForbiddenException("需要陪玩身份");
    try {
      return {
        data: await this.dispatch.playerApplications(
          tenantIdOf(req),
          req.principal.sub,
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  /** 商家释放名额（Task 4 / 设计规格 §3.5）：选中锁定后唯一的重开报名入口。 */
  @TenantScope()
  @Permissions("gameDispatch.manage")
  @Post("slots/:slotId/release")
  @ApiOperation({
    summary: "商家释放名额（档位置 RELEASED、订单回到报名阶段并重开一轮）",
  })
  @ApiBody({ schema: slotReleaseBodySchema as never })
  @ApiCreatedResponse({ schema: slotReleaseViewSchema as never })
  @ApiBadRequestResponse({ schema: genericTemplateErrorSchema as never })
  @ApiConflictResponse({ schema: genericTemplateErrorSchema as never })
  @ApiNotFoundResponse({ schema: genericTemplateErrorSchema as never })
  async releaseSlot(
    @Req() req: AuthenticatedRequest,
    @Param("slotId") slotId: string,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      return {
        data: await this.dispatch.releaseSlot(
          tenantIdOf(req),
          req.principal?.sub ?? "system",
          slotId,
          typeof body.reason === "string" && body.reason.length > 0
            ? { reason: body.reason }
            : {},
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  /** 记录违约（Task 4 / 设计规格 §3.5）：人工认定后写库 + 审计 + 通知老板。 */
  @TenantScope()
  @Permissions("gameDispatch.manage")
  @Post("orders/:orderId/player-breaches")
  @ApiOperation({ summary: "记录陪玩违约（写库 + 审计 + 通知老板）" })
  @ApiBody({ schema: playerBreachBodySchema as never })
  @ApiCreatedResponse({ schema: playerBreachViewSchema as never })
  @ApiBadRequestResponse({ schema: genericTemplateErrorSchema as never })
  @ApiNotFoundResponse({ schema: genericTemplateErrorSchema as never })
  async recordBreach(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      return {
        data: await this.breaches.record(
          tenantIdOf(req),
          req.principal?.sub ?? "system",
          {
            orderId,
            playerId: String(body.playerId ?? ""),
            ...(body.orderSlotId === undefined || body.orderSlotId === null
              ? {}
              : { orderSlotId: String(body.orderSlotId) }),
            reason: String(body.reason ?? ""),
          },
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  /** 违约记录台账（Task 5a）：按订单或陪玩过滤，供商家端「违约记录」入口读取。 */
  @TenantScope()
  @Permissions("gameDispatch.manage")
  @Get("player-breaches")
  @ApiOperation({
    summary:
      "违约记录台账（可按 orderId / playerId / 时间范围过滤，默认最近 20 条）",
  })
  @ApiQuery({ name: "orderId", required: false, type: String })
  @ApiQuery({ name: "playerId", required: false, type: String })
  @ApiQuery({
    name: "from",
    required: false,
    type: String,
    description: "起始时间（ISO 8601 带时区，含边界）",
  })
  @ApiQuery({
    name: "to",
    required: false,
    type: String,
    description: "结束时间（ISO 8601 带时区，含边界）",
  })
  @ApiQuery({
    name: "offset",
    required: false,
    type: Number,
    description: "分页偏移，默认 0",
  })
  @ApiQuery({
    name: "limit",
    required: false,
    type: Number,
    description: "每页条数 1–100，默认 20",
  })
  @ApiOkResponse({ schema: dataArraySchema(playerBreachItemSchema) as never })
  @ApiNotFoundResponse({ schema: genericTemplateErrorSchema as never })
  async listBreaches(
    @Req() req: AuthenticatedRequest,
    @Query("orderId") orderId?: string,
    @Query("playerId") playerId?: string,
    @Query("from") from?: Date,
    @Query("to") to?: Date,
    @Query("offset") offset?: number,
    @Query("limit") limit?: string,
  ) {
    try {
      return {
        data: await this.breaches.list(tenantIdOf(req), {
          ...(orderId ? { orderId } : {}),
          ...(playerId ? { playerId } : {}),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
          ...(offset !== undefined ? { offset: Number(offset) } : {}),
          ...(limit !== undefined ? { limit: Number(limit) } : {}),
        }),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("gameDispatch.manage")
  @Delete("applications/:id")
  async staffRemove(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    try {
      await this.dispatch.staffRemove(
        tenantIdOf(req),
        req.principal?.sub ?? "system",
        id,
      );
      return { data: { ok: true } };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("gameDispatch.manage")
  @Post("orders/:orderId/assignment")
  @ApiBody({ schema: assignmentBodySchema as never })
  async assign(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
    @Body()
    body: {
      applicationIds?: unknown;
      fixedPrices?: unknown;
    },
  ) {
    try {
      const ids = Array.isArray(body.applicationIds)
        ? body.applicationIds.filter((v): v is string => typeof v === "string")
        : [];
      // P3 / D1：固定价为可选入参；形状已由校验层保证（整数分 1..1000000）。
      const fixedPrices = Array.isArray(body.fixedPrices)
        ? body.fixedPrices
            .filter(
              (item): item is { applicationId: string; unitPriceFen: string } =>
                typeof item === "object" &&
                item !== null &&
                typeof (item as { applicationId?: unknown }).applicationId ===
                  "string" &&
                typeof (item as { unitPriceFen?: unknown }).unitPriceFen ===
                  "string",
            )
            .map((item) => ({
              applicationId: item.applicationId,
              unitPriceFen: item.unitPriceFen,
            }))
        : [];
      return {
        data: await this.dispatch.assign(
          tenantIdOf(req),
          req.principal?.sub ?? "system",
          orderId,
          ids,
          fixedPrices,
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }
}

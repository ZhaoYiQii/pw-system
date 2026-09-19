/**
 * 客户侧 v2 只读入口（设计规格 C-1 / C-9）。
 *
 * 与商家端是两个**独立入口**：端口由入口决定，请求体里没有任何端口声明；
 * 权限沿用客户侧既有口径（`order.manage` + 角色 CUSTOMER），不复用 `gameDispatch.manage` 端点。
 */
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Headers,
} from "@nestjs/common";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import { RequireAddon } from "../../../common/auth/entitlement.guard.js";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiUnprocessableEntityResponse,
} from "@nestjs/swagger";
import {
  genericTemplateErrorSchema,
  genericTemplateGameIdQuerySchema,
  genericTemplateCustomerOrderCreateBodySchema,
  genericTemplateOrderResultSchema,
  genericTemplatePublishedGameListSchema,
  genericTemplatePublishedListSchema,
  genericTemplateVersionFormSchema,
} from "../../../openapi/schemas.js";
import { GAME_DISPATCH_TEMPLATE_V2_FEATURE } from "../domain/features.js";
import { GenericTemplateError } from "../domain/errors.js";
import { GenericGameTemplateService } from "../application/generic-game-template.service.js";
import {
  GameDispatchTemplateOrderService,
  type CreateTemplateOrderInput,
} from "../application/game-dispatch-template-order.service.js";
import { DispatchInputError } from "../domain/dispatch-errors.js";

/** 与商家端同口径：短键容易被复用成"同一个意图"。 */
const MIN_IDEMPOTENCY_KEY_LENGTH = 8;
const MAX_IDEMPOTENCY_KEY_LENGTH = 100;

function requireIdempotencyKey(value: string | undefined): string {
  const key = typeof value === "string" ? value.trim() : "";
  if (
    key.length < MIN_IDEMPOTENCY_KEY_LENGTH ||
    key.length > MAX_IDEMPOTENCY_KEY_LENGTH
  ) {
    throw new HttpException(
      {
        code: "TEMPLATE_IDEMPOTENCY_REQUIRED",
        message: `Idempotency-Key 请求头必填，长度 ${MIN_IDEMPOTENCY_KEY_LENGTH}-${MAX_IDEMPOTENCY_KEY_LENGTH}`,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
  return key;
}

/** 客户自助下单：**不含** customerProfileId（由登录身份推导，C-9）。 */
function parseCustomerOrderInput(
  body: Record<string, unknown>,
): CreateTemplateOrderInput {
  return {
    gameId: body.gameId as string,
    templateId: body.templateId as string,
    templateVersionId: body.templateVersionId as string,
    values: (body.values ?? {}) as Record<string, unknown>,
    ...(body.desiredStartAt === undefined
      ? {}
      : { desiredStartAt: body.desiredStartAt as string | null }),
    ...(body.durationMinutes === undefined
      ? {}
      : { durationMinutes: body.durationMinutes as number }),
  };
}

/** 只允许老板身份；其余角色（含客服）一律 403——客户入口不对外开门。 */
function requireCustomer(req: AuthenticatedRequest): string {
  const tenantId = req.principal?.tenantId;
  if (!tenantId) {
    throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
  }
  if (req.principal?.role !== "CUSTOMER") {
    throw new HttpException("需要老板身份", HttpStatus.FORBIDDEN);
  }
  return tenantId;
}

@RequireAddon(GAME_DISPATCH_TEMPLATE_V2_FEATURE)
@Controller("api/v1/tenant/game-dispatch")
export class CustomerGameTemplateController {
  constructor(
    @Inject(GenericGameTemplateService)
    private readonly templates: GenericGameTemplateService,
    @Inject(GameDispatchTemplateOrderService)
    private readonly orders: GameDispatchTemplateOrderService,
  ) {}

  private fail(error: unknown): never {
    if (error instanceof GenericTemplateError) {
      throw new HttpException(error.toResponse(), error.status);
    }
    if (error instanceof DispatchInputError) {
      throw new HttpException(
        { code: "DISPATCH_INPUT_INVALID", message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
    throw error;
  }

  @TenantScope()
  @Permissions("order.manage")
  @Get("customer/games")
  @ApiOperation({
    summary: "客户入口：该店可下单的游戏（至少一个已发布模板）",
  })
  @ApiOkResponse({ schema: genericTemplatePublishedGameListSchema as never })
  @ApiForbiddenResponse({ schema: genericTemplateErrorSchema as never })
  async listGames(@Req() req: AuthenticatedRequest) {
    const tenantId = requireCustomer(req);
    return { data: await this.templates.listPublishedGames(tenantId) };
  }

  @TenantScope()
  @Permissions("order.manage")
  @Get("customer/published")
  @ApiOperation({
    summary: "客户入口：该游戏可下单的模板（未归档且有生效版本）",
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
    const tenantId = requireCustomer(req);
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
  @Permissions("order.manage")
  @Get("customer/versions/:versionId/form")
  @ApiOperation({ summary: "客户入口：按 CUSTOMER 端口过滤后的发布表单" })
  @ApiOkResponse({ schema: genericTemplateVersionFormSchema as never })
  @ApiForbiddenResponse({ schema: genericTemplateErrorSchema as never })
  @ApiUnprocessableEntityResponse({
    schema: genericTemplateErrorSchema as never,
  })
  async getVersionForm(
    @Req() req: AuthenticatedRequest,
    @Param("versionId") versionId: string,
  ) {
    const tenantId = requireCustomer(req);
    try {
      return {
        data: await this.templates.getVersionForm(
          tenantId,
          versionId,
          "CUSTOMER",
        ),
      };
    } catch (error) {
      this.fail(error);
    }
  }

  @TenantScope()
  @Permissions("order.manage")
  @Post("customer/template-orders")
  @ApiOperation({
    summary: "客户入口：客户自助下单（人数与价格由服务端按快照计算）",
    description:
      "请求体不含 customerProfileId——客户档案由登录身份推导；同一 Idempotency-Key 重试会回放首次结果。",
  })
  @ApiBody({ schema: genericTemplateCustomerOrderCreateBodySchema as never })
  @ApiCreatedResponse({ schema: genericTemplateOrderResultSchema as never })
  @ApiBadRequestResponse({ schema: genericTemplateErrorSchema as never })
  @ApiForbiddenResponse({ schema: genericTemplateErrorSchema as never })
  @ApiUnprocessableEntityResponse({
    schema: genericTemplateErrorSchema as never,
  })
  async createOrder(
    @Req() req: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const tenantId = requireCustomer(req);
    const actorId = req.principal?.sub ?? "";
    const key = requireIdempotencyKey(idempotencyKey);
    try {
      const created = await this.orders.create(
        tenantId,
        actorId,
        key,
        parseCustomerOrderInput(body),
        "CUSTOMER",
      );
      return { data: created.result };
    } catch (error) {
      this.fail(error);
    }
  }
}

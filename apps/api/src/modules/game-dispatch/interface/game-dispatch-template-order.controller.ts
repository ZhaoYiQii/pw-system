/** S4 创建派单：锁定发布版本创建派单，幂等键来自 Idempotency-Key 请求头。 */
import {
  Body,
  Controller,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import { RequireAddon } from "../../../common/auth/entitlement.guard.js";
import { GAME_DISPATCH_TEMPLATE_V2_FEATURE } from "../domain/features.js";
import {
  genericTemplateErrorSchema,
  genericTemplateOrderCreateBodySchema,
  genericTemplateOrderResultSchema,
} from "../../../openapi/schemas.js";
import {
  GameDispatchTemplateOrderService,
  type CreateTemplateOrderInput,
} from "../application/game-dispatch-template-order.service.js";
import { DispatchInputError } from "../domain/dispatch-errors.js";
import { GenericTemplateError } from "../domain/errors.js";

/** 幂等键长度下限：短键容易在客户端被复用成「同一个意图」。 */
const MIN_IDEMPOTENCY_KEY_LENGTH = 8;
const MAX_IDEMPOTENCY_KEY_LENGTH = 100;

/** 头校验在控制器完成：边界拦截器只校验 body 与 query（见 validation.interceptor.ts）。 */
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

function parseInput(body: Record<string, unknown>): CreateTemplateOrderInput {
  return {
    gameId: body.gameId as string,
    templateId: body.templateId as string,
    templateVersionId: body.templateVersionId as string,
    customerProfileId: body.customerProfileId as string,
    values: (body.values ?? {}) as Record<string, unknown>,
    ...(body.desiredStartAt === undefined
      ? {}
      : { desiredStartAt: body.desiredStartAt as string | null }),
    ...(body.durationMinutes === undefined
      ? {}
      : { durationMinutes: body.durationMinutes as number }),
  };
}

@ApiTags("通用派单模板（S2）")
@RequireAddon(GAME_DISPATCH_TEMPLATE_V2_FEATURE)
@Controller("api/v1/tenant/game-dispatch")
export class GameDispatchTemplateOrderController {
  constructor(
    @Inject(GameDispatchTemplateOrderService)
    private readonly orders: GameDispatchTemplateOrderService,
  ) {}

  private fail(error: unknown): never {
    if (error instanceof GenericTemplateError) {
      throw new HttpException(error.toResponse(), error.status);
    }
    if (error instanceof DispatchInputError) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
    throw error;
  }

  @TenantScope()
  @Permissions("gameDispatch.manage")
  @Post("template-orders")
  @ApiOperation({
    summary: "按锁定的发布版本创建派单（人数与价格由服务端计算）",
    description:
      "同一 Idempotency-Key 重试会回放首次结果；同键不同请求体返回 422；" +
      "模板归档后返回 409 TEMPLATE_ARCHIVED。",
  })
  @ApiBody({ schema: genericTemplateOrderCreateBodySchema as never })
  @ApiCreatedResponse({ schema: genericTemplateOrderResultSchema as never })
  @ApiBadRequestResponse({ schema: genericTemplateErrorSchema as never })
  @ApiForbiddenResponse({ schema: genericTemplateErrorSchema as never })
  @ApiNotFoundResponse({ schema: genericTemplateErrorSchema as never })
  @ApiConflictResponse({ schema: genericTemplateErrorSchema as never })
  @ApiUnprocessableEntityResponse({
    schema: genericTemplateErrorSchema as never,
  })
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const tenantId = req.principal?.tenantId;
    const actorId = req.principal?.sub;
    if (!tenantId || !actorId) {
      throw new HttpException(
        "tenant context missing",
        HttpStatus.UNAUTHORIZED,
      );
    }
    const key = requireIdempotencyKey(idempotencyKey);
    try {
      const created = await this.orders.create(
        tenantId,
        actorId,
        key,
        parseInput(body),
      );
      return { data: created.result };
    } catch (error) {
      this.fail(error);
    }
  }
}

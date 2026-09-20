/**
 * 算价模型（ADR-0003）规则库接口：按游戏的加价规则 + 陪玩×游戏底价。
 *
 * 权限：`gamePricing.manage`（店主 / 管理员）。陪玩的报价结果不出现在这里——
 * 陪玩端与老板端只在下单/选人链路上看到命中后的单价（设计规格 §3.4、§7）。
 */
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Put,
  Req,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import {
  gamePricingRuleSaveBodySchema,
  gamePricingRuleViewSchema,
  genericTemplateErrorSchema,
  playerGamePriceSaveBodySchema,
  playerGamePriceViewSchema,
} from "../../../openapi/schemas.js";
import { PricingRulesService } from "../application/pricing-rules.service.js";
import {
  DispatchInputError,
  DispatchNotFoundError,
} from "../domain/dispatch-errors.js";

function tenantIdOf(req: AuthenticatedRequest): string {
  const id = req.principal?.tenantId;
  if (!id) {
    throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
  }
  return id;
}

@ApiTags("算价模型（S6）")
@Controller("api/v1/tenant/game-pricing")
export class PricingRulesController {
  constructor(
    @Inject(PricingRulesService)
    private readonly pricing: PricingRulesService,
  ) {}

  private mapError(error: unknown): never {
    if (error instanceof DispatchNotFoundError) {
      throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    }
    if (error instanceof DispatchInputError) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
    throw error;
  }

  @TenantScope()
  @Permissions("gamePricing.manage")
  @Get("games/:gameId")
  @ApiOperation({ summary: "读取某游戏的加价规则库" })
  @ApiOkResponse({ schema: gamePricingRuleViewSchema as never })
  @ApiNotFoundResponse({ schema: genericTemplateErrorSchema as never })
  async getGameRule(
    @Req() req: AuthenticatedRequest,
    @Param("gameId") gameId: string,
  ) {
    try {
      return { data: await this.pricing.getGameRule(tenantIdOf(req), gameId) };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("gamePricing.manage")
  @Put("games/:gameId")
  @ApiOperation({
    summary: "整表替换某游戏的加价规则（PUT 语义，金额为分字符串）",
    // 描述保持单行：超过 YAML 折行宽度会让生成物与 prettier 的 YAML 打印结果不一致。
    description:
      "命中键为「字段标识=选项值」，如 mode=ranked；本版只接受 SURCHARGE。",
  })
  @ApiBody({ schema: gamePricingRuleSaveBodySchema as never })
  @ApiOkResponse({ schema: gamePricingRuleViewSchema as never })
  @ApiBadRequestResponse({ schema: genericTemplateErrorSchema as never })
  @ApiNotFoundResponse({ schema: genericTemplateErrorSchema as never })
  async putGameRule(
    @Req() req: AuthenticatedRequest,
    @Param("gameId") gameId: string,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      const items = (body.items ?? []) as {
        kind?: string;
        dimensionKey: string;
        amountFen: string;
        sortOrder?: number;
      }[];
      return {
        data: await this.pricing.saveGameRule(
          tenantIdOf(req),
          req.principal?.sub ?? "system",
          gameId,
          {
            ...(body.enabled === undefined
              ? {}
              : { enabled: body.enabled === true }),
            items,
          },
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("gamePricing.manage")
  @Get("players/:playerId/games/:gameId/base")
  @ApiOperation({
    summary: "读取陪玩在某游戏的底价（含陪玩级兜底，便于显示未设置时用哪个价）",
  })
  @ApiOkResponse({ schema: playerGamePriceViewSchema as never })
  @ApiNotFoundResponse({ schema: genericTemplateErrorSchema as never })
  async getPlayerGamePrice(
    @Req() req: AuthenticatedRequest,
    @Param("playerId") playerId: string,
    @Param("gameId") gameId: string,
  ) {
    try {
      return {
        data: await this.pricing.getPlayerGamePrice(
          tenantIdOf(req),
          playerId,
          gameId,
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("gamePricing.manage")
  @Put("players/:playerId/games/:gameId/base")
  @ApiOperation({ summary: "设置陪玩在某游戏的底价（分/小时）" })
  @ApiBody({ schema: playerGamePriceSaveBodySchema as never })
  @ApiOkResponse({ schema: playerGamePriceViewSchema as never })
  @ApiBadRequestResponse({ schema: genericTemplateErrorSchema as never })
  @ApiNotFoundResponse({ schema: genericTemplateErrorSchema as never })
  async putPlayerGamePrice(
    @Req() req: AuthenticatedRequest,
    @Param("playerId") playerId: string,
    @Param("gameId") gameId: string,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      return {
        data: await this.pricing.savePlayerGamePrice(
          tenantIdOf(req),
          req.principal?.sub ?? "system",
          playerId,
          gameId,
          {
            basePricePerHourFen: body.basePricePerHourFen as string,
            ...(body.status === undefined
              ? {}
              : { status: body.status as string }),
          },
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }
}

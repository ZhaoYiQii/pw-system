/**
 * 算价模型 Task 3（设计规格 §3.3 / §9 第 4-6 条）：陪玩报单 + 客服审批。
 *
 * 报单：陪玩结束服务后申报总时长（15–1440 分钟），开始/结束截图先走既有证据通道
 * （`POST .../slots/:slotId/session/evidence?evidenceType=REPORT_START|REPORT_END`）。
 * 审批：客服对照截图人工核查，可修正时长；金额在通过审批时按核定分钟数落 SlotEarning。
 * 留痕统一写入既有 `audit_logs`（action = `game_dispatch.slot_report.*`），不新建事件表。
 */
import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Inject,
  Param,
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
} from "@nestjs/swagger";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import {
  genericTemplateErrorSchema,
  slotReportReviewBodySchema,
  slotReportSubmitBodySchema,
  slotReportViewSchema,
} from "../../../openapi/schemas.js";
import { GameDispatchService } from "../application/game-dispatch.service.js";
import { mapGameDispatchError } from "./game-dispatch-error.mapper.js";

function tenantIdOf(req: AuthenticatedRequest): string {
  const id = req.principal?.tenantId;
  if (!id) {
    throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
  }
  return id;
}

@ApiTags("算价模型（S6）")
@Controller("api/v1/tenant/game-dispatch")
export class SlotReportController {
  constructor(
    @Inject(GameDispatchService)
    private readonly dispatch: GameDispatchService,
  ) {}

  private mapError(error: unknown): never {
    mapGameDispatchError(error);
  }

  @TenantScope()
  @Permissions("dispatch.manage")
  @Post("slots/:slotId/report")
  @ApiOperation({
    summary: "陪玩结束服务后报单（申报总时长，截图走证据通道）",
    // 描述保持单行：超过 YAML 折行宽度会让生成物与 prettier 的 YAML 打印结果不一致。
    description:
      "申报时长 15–1440 分钟；须先上传 REPORT_START/REPORT_END 两张截图；报单不产生金额。",
  })
  @ApiBody({ schema: slotReportSubmitBodySchema as never })
  @ApiCreatedResponse({ schema: slotReportViewSchema as never })
  @ApiForbiddenResponse({ schema: genericTemplateErrorSchema as never })
  @ApiBadRequestResponse({ schema: genericTemplateErrorSchema as never })
  @ApiConflictResponse({ schema: genericTemplateErrorSchema as never })
  @ApiNotFoundResponse({ schema: genericTemplateErrorSchema as never })
  async report(
    @Req() req: AuthenticatedRequest,
    @Param("slotId") slotId: string,
    @Body() body: Record<string, unknown>,
  ) {
    if (req.principal?.role !== "PLAYER")
      throw new HttpException("需要陪玩身份", HttpStatus.FORBIDDEN);
    try {
      return {
        data: await this.dispatch.reportSlot(
          tenantIdOf(req),
          req.principal.sub,
          slotId,
          { declaredDurationMinutes: Number(body.declaredDurationMinutes) },
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("gameDispatch.manage")
  @Post("slots/:slotId/report/review")
  @ApiOperation({
    summary: "客服审批报单（可人工修正时长，写审计留痕）",
    description:
      "approve=false 为驳回（不产生金额，可重新报单）；approve=true 时按核定分钟数落金额。",
  })
  @ApiBody({ schema: slotReportReviewBodySchema as never })
  @ApiCreatedResponse({ schema: slotReportViewSchema as never })
  @ApiBadRequestResponse({ schema: genericTemplateErrorSchema as never })
  @ApiConflictResponse({ schema: genericTemplateErrorSchema as never })
  @ApiNotFoundResponse({ schema: genericTemplateErrorSchema as never })
  async review(
    @Req() req: AuthenticatedRequest,
    @Param("slotId") slotId: string,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      return {
        data: await this.dispatch.reviewSlotReport(
          tenantIdOf(req),
          req.principal?.sub ?? "system",
          slotId,
          {
            approve: body.approve === true,
            ...(body.declaredDurationMinutes === undefined
              ? {}
              : {
                  declaredDurationMinutes: Number(body.declaredDurationMinutes),
                }),
            ...(typeof body.reason === "string" && body.reason.length > 0
              ? { reason: body.reason }
              : {}),
          },
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }
}

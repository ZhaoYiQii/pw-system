/**
 * DS-007 / DS-008：统一资金台账查询与 CSV 导出接口（**只读**）。
 *
 * 控制器只做三件事：取服务端登录态里的租户、套用权限、把已知错误映射成 400 / 422。
 * 不写审计、不改任何单据；未知错误原样上抛，绝不吞掉、也不伪装成已知错误。
 * 导出的文件名与 Content-Type 都是固定字面量，绝不从用户输入拼接响应头。
 */

import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiUnprocessableEntityResponse,
} from "@nestjs/swagger";
import type { Response } from "express";
import {
  FundLedgerExportLimitError,
  FundLedgerInputError,
} from "../application/fund-ledger-ports.js";
import { FundLedgerService } from "../application/fund-ledger.service.js";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import {
  fundLedgerEventTypeQuerySchema,
  fundLedgerFundAccountIdQuerySchema,
  fundLedgerMaxAmountFenQuerySchema,
  fundLedgerMinAmountFenQuerySchema,
  fundLedgerOccurredFromQuerySchema,
  fundLedgerOccurredToQuerySchema,
  fundLedgerPageQuerySchema,
  fundLedgerPageSizeQuerySchema,
  fundLedgerResponseSchema,
  fundLedgerSearchQuerySchema,
  fundLedgerSortByQuerySchema,
  fundLedgerSortDirQuerySchema,
  fundLedgerSourceTypeQuerySchema,
  fundLedgerStatusQuerySchema,
  httpErrorSchema,
} from "../../../openapi/schemas.js";

/** 租户只来自服务端登录态；缺少登录态是 401，绝不接受请求参数里的租户 ID。 */
function tenantIdOf(req: AuthenticatedRequest): string {
  const id = req.principal?.tenantId;
  if (!id)
    throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
  return id;
}

@Controller("api/v1/tenant/funds/ledger")
export class TenantFundLedgerController {
  constructor(
    @Inject(FundLedgerService) private readonly ledger: FundLedgerService,
  ) {}

  /**
   * 列表：服务端分页 + 排序 + 筛选，返回 `{ data: FundLedgerView }`。
   *
   * 参数按 `string | undefined` 显式声明并逐个透传：未提供的参数保持「未提供」，
   * 不用空串或默认值顶替；重复查询参数在运行时会变成数组，服务层按非字符串拒绝。
   */
  @TenantScope()
  @Permissions("finance.manage")
  @Get()
  @ApiOperation({ summary: "统一资金台账列表（服务端分页 / 排序 / 筛选）" })
  @ApiQuery({
    name: "eventType",
    required: false,
    schema: fundLedgerEventTypeQuerySchema as never,
  })
  @ApiQuery({
    name: "status",
    required: false,
    schema: fundLedgerStatusQuerySchema as never,
  })
  @ApiQuery({
    name: "fundAccountId",
    required: false,
    schema: fundLedgerFundAccountIdQuerySchema as never,
  })
  @ApiQuery({
    name: "sourceType",
    required: false,
    schema: fundLedgerSourceTypeQuerySchema as never,
  })
  @ApiQuery({
    name: "q",
    required: false,
    schema: fundLedgerSearchQuerySchema as never,
  })
  @ApiQuery({
    name: "occurredFrom",
    required: false,
    schema: fundLedgerOccurredFromQuerySchema as never,
  })
  @ApiQuery({
    name: "occurredTo",
    required: false,
    schema: fundLedgerOccurredToQuerySchema as never,
  })
  @ApiQuery({
    name: "minAmountFen",
    required: false,
    schema: fundLedgerMinAmountFenQuerySchema as never,
  })
  @ApiQuery({
    name: "maxAmountFen",
    required: false,
    schema: fundLedgerMaxAmountFenQuerySchema as never,
  })
  @ApiQuery({
    name: "sortBy",
    required: false,
    schema: fundLedgerSortByQuerySchema as never,
  })
  @ApiQuery({
    name: "sortDir",
    required: false,
    schema: fundLedgerSortDirQuerySchema as never,
  })
  @ApiQuery({
    name: "page",
    required: false,
    schema: fundLedgerPageQuerySchema as never,
  })
  @ApiQuery({
    name: "pageSize",
    required: false,
    schema: fundLedgerPageSizeQuerySchema as never,
  })
  @ApiOkResponse({ schema: fundLedgerResponseSchema as never })
  @ApiBadRequestResponse({ schema: httpErrorSchema as never })
  async list(
    @Req() req: AuthenticatedRequest,
    @Query("eventType") eventType?: string,
    @Query("status") status?: string,
    @Query("fundAccountId") fundAccountId?: string,
    @Query("sourceType") sourceType?: string,
    @Query("q") q?: string,
    @Query("occurredFrom") occurredFrom?: string,
    @Query("occurredTo") occurredTo?: string,
    @Query("minAmountFen") minAmountFen?: string,
    @Query("maxAmountFen") maxAmountFen?: string,
    @Query("sortBy") sortBy?: string,
    @Query("sortDir") sortDir?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    try {
      const view = await this.ledger.list({
        tenantId: tenantIdOf(req),
        ...(eventType === undefined ? {} : { eventType }),
        ...(status === undefined ? {} : { status }),
        ...(fundAccountId === undefined ? {} : { fundAccountId }),
        ...(sourceType === undefined ? {} : { sourceType }),
        ...(q === undefined ? {} : { q }),
        ...(occurredFrom === undefined ? {} : { occurredFrom }),
        ...(occurredTo === undefined ? {} : { occurredTo }),
        ...(minAmountFen === undefined ? {} : { minAmountFen }),
        ...(maxAmountFen === undefined ? {} : { maxAmountFen }),
        ...(sortBy === undefined ? {} : { sortBy }),
        ...(sortDir === undefined ? {} : { sortDir }),
        ...(page === undefined ? {} : { page }),
        ...(pageSize === undefined ? {} : { pageSize }),
      });
      return { data: view };
    } catch (error) {
      this.rethrow(error);
    }
  }

  /**
   * 导出当前筛选与排序下的**全部**匹配交易（UTF-8 BOM + CRLF，Excel 可直接打开）。
   *
   * 与列表的筛选/排序参数完全同源，但**不接受** `page`/`pageSize`：导出的是整份结果，
   * 不是列表当前页。匹配行数超过上限时整体失败（422），绝不返回被静默截断的 CSV。
   */
  @TenantScope()
  @Permissions("finance.manage")
  @Get("export.csv")
  @ApiOperation({
    summary: "统一资金台账 CSV 导出（当前筛选与排序下的全部匹配交易）",
  })
  @ApiProduces("text/csv")
  @ApiQuery({
    name: "eventType",
    required: false,
    schema: fundLedgerEventTypeQuerySchema as never,
  })
  @ApiQuery({
    name: "status",
    required: false,
    schema: fundLedgerStatusQuerySchema as never,
  })
  @ApiQuery({
    name: "fundAccountId",
    required: false,
    schema: fundLedgerFundAccountIdQuerySchema as never,
  })
  @ApiQuery({
    name: "sourceType",
    required: false,
    schema: fundLedgerSourceTypeQuerySchema as never,
  })
  @ApiQuery({
    name: "q",
    required: false,
    schema: fundLedgerSearchQuerySchema as never,
  })
  @ApiQuery({
    name: "occurredFrom",
    required: false,
    schema: fundLedgerOccurredFromQuerySchema as never,
  })
  @ApiQuery({
    name: "occurredTo",
    required: false,
    schema: fundLedgerOccurredToQuerySchema as never,
  })
  @ApiQuery({
    name: "minAmountFen",
    required: false,
    schema: fundLedgerMinAmountFenQuerySchema as never,
  })
  @ApiQuery({
    name: "maxAmountFen",
    required: false,
    schema: fundLedgerMaxAmountFenQuerySchema as never,
  })
  @ApiQuery({
    name: "sortBy",
    required: false,
    schema: fundLedgerSortByQuerySchema as never,
  })
  @ApiQuery({
    name: "sortDir",
    required: false,
    schema: fundLedgerSortDirQuerySchema as never,
  })
  @ApiOkResponse({
    description:
      "当前筛选与排序下的全部匹配交易（UTF-8 BOM + CRLF 的 CSV 文本）",
    content: {
      "text/csv": {
        schema: { type: "string" },
      },
    },
  })
  @ApiBadRequestResponse({
    description: "查询参数不合法（错误体为通用 HTTP 错误结构）",
    content: {
      "application/json": {
        schema: httpErrorSchema as never,
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description:
      "匹配行数超过导出上限，需缩小筛选范围（错误体为通用 HTTP 错误结构）",
    content: {
      "application/json": {
        schema: httpErrorSchema as never,
      },
    },
  })
  async exportCsv(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
    @Query("eventType") eventType?: string,
    @Query("status") status?: string,
    @Query("fundAccountId") fundAccountId?: string,
    @Query("sourceType") sourceType?: string,
    @Query("q") q?: string,
    @Query("occurredFrom") occurredFrom?: string,
    @Query("occurredTo") occurredTo?: string,
    @Query("minAmountFen") minAmountFen?: string,
    @Query("maxAmountFen") maxAmountFen?: string,
    @Query("sortBy") sortBy?: string,
    @Query("sortDir") sortDir?: string,
  ): Promise<string> {
    try {
      const csv = await this.ledger.exportCsv({
        tenantId: tenantIdOf(req),
        ...(eventType === undefined ? {} : { eventType }),
        ...(status === undefined ? {} : { status }),
        ...(fundAccountId === undefined ? {} : { fundAccountId }),
        ...(sourceType === undefined ? {} : { sourceType }),
        ...(q === undefined ? {} : { q }),
        ...(occurredFrom === undefined ? {} : { occurredFrom }),
        ...(occurredTo === undefined ? {} : { occurredTo }),
        ...(minAmountFen === undefined ? {} : { minAmountFen }),
        ...(maxAmountFen === undefined ? {} : { maxAmountFen }),
        ...(sortBy === undefined ? {} : { sortBy }),
        ...(sortDir === undefined ? {} : { sortDir }),
      });
      // 只有真正拿到 CSV 之后才写响应头：服务抛错时不能预先写 CSV 头，
      // 否则全局异常过滤器写出的 JSON 错误体会带着 text/csv 的内容类型。
      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.setHeader(
        "content-disposition",
        'attachment; filename="fund-ledger.csv"',
      );
      return csv;
    } catch (error) {
      this.rethrow(error);
    }
  }

  /**
   * 已知错误 → 400 / 422，错误体固定带 `{ code, message }`（`code` 为异常类名，供调用方按码分支）；
   * 其余错误原样上抛，交给全局异常过滤器（`http-error.filter.ts` 会把 body 里的 `code` 透传到响应）。
   * 422 与 400 分开：参数本身合法、只是命中的行太多，不能退回 400 让调用方去改参数。
   */
  private rethrow(error: unknown): never {
    if (error instanceof FundLedgerInputError) {
      throw new HttpException(
        { code: error.name, message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (error instanceof FundLedgerExportLimitError) {
      throw new HttpException(
        { code: error.name, message: error.message },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    throw error;
  }
}

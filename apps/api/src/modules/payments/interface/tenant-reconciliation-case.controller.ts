/**
 * DS-012/DS-013/DS-014：门店对账处理单端点（列表只读 + 五个显式命令）。
 *
 * 控制器只做三件事：取服务端登录态里的租户与操作人、套用权限、把已知错误映射成 HTTP。
 * 不写审计、不改任何单据（那是仓储在同一个事务里的事）；未知错误原样上抛，
 * 绝不吞掉、也不伪装成已知错误。
 *
 * 身份只来自 `AuthenticatedRequest.principal`：租户取 `tenantId`、操作人取 `sub`（账号 id）。
 * 路径或请求体里的 tenantId / ownerId / reviewerId / status 一律不认——它们根本不在命令契约里。
 */

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
  Query,
  Req,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import {
  httpErrorSchema,
  reconciliationCaseIdParamSchema,
  reconciliationCaseIgnoreCommandSchema,
  reconciliationCasePageQuerySchema,
  reconciliationCasePageSizeQuerySchema,
  reconciliationCaseResponseSchema,
  reconciliationCaseRowResponseSchema,
  reconciliationCaseStatusQuerySchema,
  reconciliationCaseSubmitReviewCommandSchema,
  reconciliationCaseTransitionCommandSchema,
} from "../../../openapi/schemas.js";
import {
  ReconciliationCaseConflictError,
  ReconciliationCaseInputError,
  ReconciliationCaseNotFoundError,
} from "../application/reconciliation-case-ports.js";
import type {
  ReconciliationCaseCommandInput,
  ReconciliationCaseView,
} from "../application/reconciliation-case-ports.js";
import { ReconciliationCaseService } from "../application/reconciliation-case.service.js";
import { ReconciliationCaseTransitionError } from "../domain/reconciliation-case-state.js";

@Controller("api/v1/tenant/reconciliation/cases")
export class TenantReconciliationCaseController {
  constructor(
    @Inject(ReconciliationCaseService)
    private readonly cases: ReconciliationCaseService,
  ) {}

  /** 列表：固定按 `createdAt DESC, id DESC` 排序，服务端分页；本切片没有状态过滤以外的筛选。 */
  @TenantScope()
  @Permissions("finance.manage")
  @Get()
  @ApiOperation({ summary: "对账处理单列表（服务端分页，只读）" })
  @ApiQuery({
    name: "status",
    required: false,
    schema: reconciliationCaseStatusQuerySchema as never,
  })
  @ApiQuery({
    name: "page",
    required: false,
    schema: reconciliationCasePageQuerySchema as never,
  })
  @ApiQuery({
    name: "pageSize",
    required: false,
    schema: reconciliationCasePageSizeQuerySchema as never,
  })
  @ApiOkResponse({ schema: reconciliationCaseResponseSchema as never })
  @ApiBadRequestResponse({ schema: httpErrorSchema as never })
  async list(
    @Req() req: AuthenticatedRequest,
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    const tenantId = req.principal?.tenantId;
    if (!tenantId) {
      // 缺少登录态是 401：绝不接受请求参数里的租户 ID 顶替。
      throw new HttpException(
        "tenant context missing",
        HttpStatus.UNAUTHORIZED,
      );
    }
    try {
      const view = await this.cases.list({
        tenantId,
        ...(status === undefined ? {} : { status }),
        ...(page === undefined ? {} : { page }),
        ...(pageSize === undefined ? {} : { pageSize }),
      });
      return { data: view };
    } catch (error) {
      if (error instanceof ReconciliationCaseInputError) {
        // 错误体固定带 `{ code, message }`（`code` 为异常类名），供全局异常过滤器原样透传。
        throw new HttpException(
          { code: error.name, message: error.message },
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  /**
   * DS-013 认领：`OPEN -> CLAIMED`，处理人即调用者（服务端绑定，不接受客户端指定）。
   *
   * 服务端只认「登录态 + 路径里的单号 + 请求体里的 expectedVersion」三样输入；
   * 目标状态由这条路径本身决定，没有任何字段能让调用方把它改成别的状态。
   */
  @TenantScope()
  @Permissions("finance.manage")
  @Post(":caseId/claim")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "认领对账处理单（OPEN -> CLAIMED）" })
  @ApiParam({
    name: "caseId",
    required: true,
    schema: reconciliationCaseIdParamSchema as never,
  })
  @ApiBody({ schema: reconciliationCaseTransitionCommandSchema as never })
  @ApiOkResponse({ schema: reconciliationCaseRowResponseSchema as never })
  @ApiBadRequestResponse({ schema: httpErrorSchema as never })
  @ApiUnauthorizedResponse({ schema: httpErrorSchema as never })
  @ApiForbiddenResponse({ schema: httpErrorSchema as never })
  @ApiNotFoundResponse({ schema: httpErrorSchema as never })
  @ApiConflictResponse({ schema: httpErrorSchema as never })
  async claim(
    @Req() req: AuthenticatedRequest,
    @Param("caseId") caseId: unknown,
    @Body() body: unknown,
  ) {
    // `caseId` / `body` 故意标成 `unknown`：畸形输入（数组、带空白的伪 UUID、字符串版本号）
    // 必须在服务层被**运行期**校验拒绝；类型标注在运行时不存在，挡不住任何人。
    return {
      data: await this.runCommand(
        (input) => this.cases.claim(input),
        req,
        caseId,
        body,
      ),
    };
  }

  /**
   * DS-013 开始处理：`CLAIMED -> PROCESSING`，只有该单**当前**处理人能推进。
   * 别人的单、已推进过的单、拿旧版本号的请求，一律 409——本切片没有改派、抢占或自动推进。
   */
  @TenantScope()
  @Permissions("finance.manage")
  @Post(":caseId/start-processing")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "开始处理对账处理单（CLAIMED -> PROCESSING）" })
  @ApiParam({
    name: "caseId",
    required: true,
    schema: reconciliationCaseIdParamSchema as never,
  })
  @ApiBody({ schema: reconciliationCaseTransitionCommandSchema as never })
  @ApiOkResponse({ schema: reconciliationCaseRowResponseSchema as never })
  @ApiBadRequestResponse({ schema: httpErrorSchema as never })
  @ApiUnauthorizedResponse({ schema: httpErrorSchema as never })
  @ApiForbiddenResponse({ schema: httpErrorSchema as never })
  @ApiNotFoundResponse({ schema: httpErrorSchema as never })
  @ApiConflictResponse({ schema: httpErrorSchema as never })
  async startProcessing(
    @Req() req: AuthenticatedRequest,
    @Param("caseId") caseId: unknown,
    @Body() body: unknown,
  ) {
    return {
      data: await this.runCommand(
        (input) => this.cases.startProcessing(input),
        req,
        caseId,
        body,
      ),
    };
  }

  /**
   * DS-014 提交复核：`PROCESSING -> PENDING_REVIEW`，只有该单**当前**处理人能提交。
   *
   * 处理结果（类型 / 说明 / 关联交易）由本命令写入；复核关闭是另一条命令、另一个账号的事，
   * 本命令既不写复核人也不解析差异——那两件事在 `close` 里。
   */
  @TenantScope()
  @Permissions("finance.manage")
  @Post(":caseId/submit-review")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "提交对账处理单复核（PROCESSING -> PENDING_REVIEW）",
  })
  @ApiParam({
    name: "caseId",
    required: true,
    schema: reconciliationCaseIdParamSchema as never,
  })
  @ApiBody({
    schema: reconciliationCaseSubmitReviewCommandSchema as never,
  })
  @ApiOkResponse({ schema: reconciliationCaseRowResponseSchema as never })
  @ApiBadRequestResponse({ schema: httpErrorSchema as never })
  @ApiUnauthorizedResponse({ schema: httpErrorSchema as never })
  @ApiForbiddenResponse({ schema: httpErrorSchema as never })
  @ApiNotFoundResponse({ schema: httpErrorSchema as never })
  @ApiConflictResponse({ schema: httpErrorSchema as never })
  async submitReview(
    @Req() req: AuthenticatedRequest,
    @Param("caseId") caseId: unknown,
    @Body() body: unknown,
  ) {
    return {
      data: await this.runCommand(
        (input) => this.cases.submitReview(input),
        req,
        caseId,
        body,
      ),
    };
  }

  /**
   * DS-014 复核关闭：`PENDING_REVIEW -> CLOSED`，复核人**必须不是**处理人。
   *
   * 请求体与 DS-013 同形（只有 `expectedVersion`）：处理结果从库里读，复核人从登录态取，
   * 客户端在这一步唯一能决定的是「我看到的版本对不对」。
   */
  @TenantScope()
  @Permissions("finance.manage")
  @Post(":caseId/close")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "复核关闭对账处理单（PENDING_REVIEW -> CLOSED）" })
  @ApiParam({
    name: "caseId",
    required: true,
    schema: reconciliationCaseIdParamSchema as never,
  })
  @ApiBody({ schema: reconciliationCaseTransitionCommandSchema as never })
  @ApiOkResponse({ schema: reconciliationCaseRowResponseSchema as never })
  @ApiBadRequestResponse({ schema: httpErrorSchema as never })
  @ApiUnauthorizedResponse({ schema: httpErrorSchema as never })
  @ApiForbiddenResponse({ schema: httpErrorSchema as never })
  @ApiNotFoundResponse({ schema: httpErrorSchema as never })
  @ApiConflictResponse({ schema: httpErrorSchema as never })
  async close(
    @Req() req: AuthenticatedRequest,
    @Param("caseId") caseId: unknown,
    @Body() body: unknown,
  ) {
    return {
      data: await this.runCommand(
        (input) => this.cases.close(input),
        req,
        caseId,
        body,
      ),
    };
  }

  /**
   * DS-014 忽略：`OPEN -> IGNORED` 任意 `finance.manage` 可做，`CLAIMED -> IGNORED` 仅当前处理人。
   *
   * 理由（`reason`）是唯一的说明来源；落库时写进 `resolutionNote`，
   * `reviewedBy`/`reviewedAt` 保持为空——忽略不是复核通过。
   */
  @TenantScope()
  @Permissions("finance.manage")
  @Post(":caseId/ignore")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "忽略对账处理单（OPEN/CLAIMED -> IGNORED）" })
  @ApiParam({
    name: "caseId",
    required: true,
    schema: reconciliationCaseIdParamSchema as never,
  })
  @ApiBody({ schema: reconciliationCaseIgnoreCommandSchema as never })
  @ApiOkResponse({ schema: reconciliationCaseRowResponseSchema as never })
  @ApiBadRequestResponse({ schema: httpErrorSchema as never })
  @ApiUnauthorizedResponse({ schema: httpErrorSchema as never })
  @ApiForbiddenResponse({ schema: httpErrorSchema as never })
  @ApiNotFoundResponse({ schema: httpErrorSchema as never })
  @ApiConflictResponse({ schema: httpErrorSchema as never })
  async ignore(
    @Req() req: AuthenticatedRequest,
    @Param("caseId") caseId: unknown,
    @Body() body: unknown,
  ) {
    return {
      data: await this.runCommand(
        (input) => this.cases.ignore(input),
        req,
        caseId,
        body,
      ),
    };
  }

  /**
   * 五个命令共用的执行外壳：登录态取身份 → 执行**一次**命令 → 已知错误映射成 HTTP。
   *
   * 映射只写一处，两个命令就不可能给出不一致的状态码：
   * 入参畸形 400 / 本租户内查无此单 404 / 冲突（版本过期、状态不允许、非本人单）409。
   * 其余错误原样上抛（500），包括「更新后查不到行」这类不变量失败——
   * 如实报错，绝不降级成 404 或假成功。
   */
  private async runCommand(
    execute: (
      input: ReconciliationCaseCommandInput,
    ) => Promise<ReconciliationCaseView>,
    req: AuthenticatedRequest,
    caseId: unknown,
    body: unknown,
  ): Promise<ReconciliationCaseView> {
    const tenantId = req.principal?.tenantId;
    // 操作人取账号 id（`sub`）：审计里的 actorId 必须是账号，不是显示名或用户名。
    const operatorAccountId = req.principal?.sub;
    if (!tenantId || !operatorAccountId) {
      // 缺少登录态是 401：绝不接受请求体里的 tenantId / ownerId 顶替。
      throw new HttpException(
        "tenant context missing",
        HttpStatus.UNAUTHORIZED,
      );
    }
    try {
      return await execute({ tenantId, operatorAccountId, caseId, body });
    } catch (error) {
      if (error instanceof ReconciliationCaseInputError) {
        // 400：命令字段畸形（单号形状、expectedVersion 类型/取值、多余字段）。
        throw new HttpException(
          { code: error.name, message: error.message },
          HttpStatus.BAD_REQUEST,
        );
      }
      if (error instanceof ReconciliationCaseNotFoundError) {
        // 404：本租户内查无此单。跨租户的单同样落到这里——对外不区分，
        // 否则「存在但不可见」和「不存在」的差异就成了跨租户探测器。
        throw new HttpException(
          { code: error.name, message: error.message },
          HttpStatus.NOT_FOUND,
        );
      }
      if (
        error instanceof ReconciliationCaseConflictError ||
        error instanceof ReconciliationCaseTransitionError
      ) {
        // 409：版本过期 / 来源状态不允许 / 非本人认领的单 / 条件更新竞争失败。
        // 领域状态机（DS-010）的拒绝与仓储的条件更新冲突在这里汇成同一个状态码。
        throw new HttpException(
          { code: error.name, message: error.message },
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }
}

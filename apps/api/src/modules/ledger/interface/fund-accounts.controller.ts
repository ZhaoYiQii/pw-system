import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
} from "@nestjs/common";
import { FundAccountsService } from "../application/fund-accounts.service.js";
import {
  FundAccountDuplicateCodeError,
  FundAccountInputError,
} from "../domain/fund-account.js";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { AuditService } from "../../audit/audit.service.js";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
} from "@nestjs/swagger";
import {
  createFundAccountBodySchema,
  dataSchema,
  fundAccountListSchema,
  fundAccountViewSchema,
  genericTemplateErrorSchema,
} from "../../../openapi/schemas.js";

function tenantIdOf(req: AuthenticatedRequest): string {
  const id = req.principal?.tenantId;
  if (!id)
    throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
  return id;
}

@Controller("api/v1/tenant/funds/accounts")
export class FundAccountsController {
  constructor(
    @Inject(FundAccountsService) private readonly accounts: FundAccountsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** 领域错误映射 HTTP：输入错误 400、code 重复 409，其他错误保持原有语义。 */
  private throwHttp(error: unknown): never {
    if (error instanceof FundAccountDuplicateCodeError) {
      throw new HttpException(error.message, HttpStatus.CONFLICT);
    }
    if (error instanceof FundAccountInputError) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
    throw error;
  }

  @TenantScope()
  @Permissions("finance.manage")
  @Get()
  @ApiOkResponse({ schema: fundAccountListSchema as never })
  async list(@Req() req: AuthenticatedRequest) {
    return { data: { items: await this.accounts.list(tenantIdOf(req)) } };
  }

  @TenantScope()
  @Permissions("finance.manage")
  @Post()
  @ApiBody({ schema: createFundAccountBodySchema as never })
  @ApiCreatedResponse({ schema: dataSchema(fundAccountViewSchema) as never })
  @ApiBadRequestResponse({ schema: genericTemplateErrorSchema as never })
  @ApiConflictResponse({ schema: genericTemplateErrorSchema as never })
  async create(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      code?: unknown;
      name?: unknown;
      kind?: unknown;
      externalRef?: unknown;
    },
  ) {
    try {
      const account = await this.accounts.create(tenantIdOf(req), body);
      await this.audit.record({
        tenantId: tenantIdOf(req),
        actorType: req.principal?.role,
        actorId: req.principal?.sub ?? "system",
        action: "fund-account.create",
        resourceType: "fund-account",
        resourceId: account.id,
        summary: `创建资金账户 ${account.code}`,
      });
      return { data: account };
    } catch (error) {
      this.throwHttp(error);
    }
  }
}

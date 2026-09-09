import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Query,
  Req,
} from "@nestjs/common";
import { AuditService, type AuditListOptions } from "./audit.service.js";
import {
  Permissions,
  PlatformScope,
  TenantScope,
} from "../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../common/auth/auth.guard.js";
import { PlatformGrantsService } from "../platform-accounts/platform-grants.service.js";

@Controller("api/v1/tenant/audit")
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @TenantScope()
  @Permissions("audit.view")
  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
    @Query("limit") limit?: unknown,
    @Query("offset") offset?: unknown,
    @Query("action") action?: unknown,
    @Query("actorType") actorType?: unknown,
    @Query("q") keyword?: unknown,
    @Query("from") from?: unknown,
    @Query("to") to?: unknown,
  ) {
    const tenantId = req.principal?.tenantId;
    if (!tenantId)
      throw new HttpException(
        "tenant context missing",
        HttpStatus.UNAUTHORIZED,
      );
    const options: AuditListOptions = {};
    if (typeof limit === "string" && limit) options.limit = Number(limit);
    if (typeof offset === "string" && offset) options.offset = Number(offset);
    if (typeof action === "string" && action) options.action = action;
    if (typeof actorType === "string" && actorType)
      options.actorType = actorType;
    if (typeof keyword === "string" && keyword) options.keyword = keyword;
    if (typeof from === "string" && from) options.from = from;
    if (typeof to === "string" && to) options.to = to;
    return {
      data: await this.audit.list(tenantId, options),
    };
  }

  @TenantScope()
  @Permissions("audit.view")
  @Get("export")
  async export(
    @Req() req: AuthenticatedRequest,
    @Query("action") action?: unknown,
    @Query("actorType") actorType?: unknown,
    @Query("q") keyword?: unknown,
    @Query("from") from?: unknown,
    @Query("to") to?: unknown,
  ) {
    const tenantId = req.principal?.tenantId;
    if (!tenantId)
      throw new HttpException(
        "tenant context missing",
        HttpStatus.UNAUTHORIZED,
      );
    const options: AuditListOptions = {};
    if (typeof action === "string" && action) options.action = action;
    if (typeof actorType === "string" && actorType)
      options.actorType = actorType;
    if (typeof keyword === "string" && keyword) options.keyword = keyword;
    if (typeof from === "string" && from) options.from = from;
    if (typeof to === "string" && to) options.to = to;
    const csv = await this.audit.exportCsv(tenantId, options);
    return {
      data: { csv, filename: `tenant-audit-${tenantId.slice(0, 8)}.csv` },
    };
  }
}

/** 平台跨租户只读审计：必须带 reason，读取本身写入同租户审计。 */
@Controller("api/v1/platform/tenants/:tenantId")
export class PlatformAuditController {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PlatformGrantsService)
    private readonly grants: PlatformGrantsService,
  ) {}

  @PlatformScope()
  @Permissions("tenant.view")
  @Get("audit")
  async platformList(
    @Req() req: AuthenticatedRequest,
    @Param("tenantId") tenantId: string,
    @Query("reason") reason?: unknown,
    @Query("limit") limit?: unknown,
  ) {
    await this.grants.assertTenantReadAllowed(req.principal, tenantId);
    if (typeof reason !== "string" || reason.trim().length < 4) {
      throw new HttpException(
        "平台只读审计必须提供 reason（≥4 字符）",
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.audit.record({
      tenantId,
      actorType: "platform_account",
      actorId: req.principal?.sub,
      action: "platform.audit.read",
      summary: `平台只读审计：${reason.trim().slice(0, 200)}`,
    });
    return {
      data: await this.audit.list(
        tenantId,
        typeof limit === "string" ? Number(limit) : 50,
      ),
    };
  }
}

/** 平台级审计汇总：仅超管可见；运营账号授权后仍走单店审计。 */
@Controller("api/v1/platform/audit")
export class PlatformAuditAggregateController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @PlatformScope()
  @Permissions("platform.manage")
  @Get()
  async aggregate(@Query("limit") limit?: unknown) {
    return {
      data: await this.audit.aggregatePlatform(
        typeof limit === "string" ? Number(limit) : 100,
      ),
    };
  }
}

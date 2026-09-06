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
import { AuditService } from "./audit.service.js";
import {
  Permissions,
  PlatformScope,
  TenantScope,
} from "../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../common/auth/auth.guard.js";

@Controller("api/v1/tenant/audit")
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @TenantScope()
  @Permissions("audit.view")
  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
    @Query("limit") limit?: unknown,
  ) {
    const tenantId = req.principal?.tenantId;
    if (!tenantId)
      throw new HttpException(
        "tenant context missing",
        HttpStatus.UNAUTHORIZED,
      );
    return {
      data: await this.audit.list(
        tenantId,
        typeof limit === "string" ? Number(limit) : 50,
      ),
    };
  }
}

/** 平台跨租户只读审计：必须带 reason，读取本身写入同租户审计。 */
@Controller("api/v1/platform/tenants/:tenantId")
export class PlatformAuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @PlatformScope()
  @Permissions("tenant.view")
  @Get("audit")
  async platformList(
    @Req() req: AuthenticatedRequest,
    @Param("tenantId") tenantId: string,
    @Query("reason") reason?: unknown,
    @Query("limit") limit?: unknown,
  ) {
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

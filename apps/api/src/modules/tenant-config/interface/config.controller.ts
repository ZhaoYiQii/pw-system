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
import { TenantConfigService } from "../application/config.service.js";
import {
  InvalidTenantConfigError,
  NoVersionToRollbackError,
} from "../domain/errors.js";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { AuditService } from "../../audit/audit.service.js";

function tenantIdOf(req: AuthenticatedRequest): string {
  const id = req.principal?.tenantId;
  if (!id)
    throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
  return id;
}

@Controller("api/v1/tenant/config")
export class TenantConfigController {
  constructor(
    @Inject(TenantConfigService) private readonly config: TenantConfigService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @TenantScope()
  @Permissions("tenant.view")
  @Get()
  async get(@Req() req: AuthenticatedRequest) {
    return { data: await this.config.getEffective(tenantIdOf(req)) };
  }

  @TenantScope()
  @Permissions("tenant.manage")
  @Post()
  async save(
    @Req() req: AuthenticatedRequest,
    @Body() body: { config?: unknown },
  ) {
    try {
      const saved = await this.config.save(
        tenantIdOf(req),
        body.config,
        req.principal?.sub,
      );
      await this.audit.record({
        tenantId: tenantIdOf(req),
        actorType: req.principal?.role,
        actorId: req.principal?.sub ?? "system",
        action: "tenant-config.save",
        resourceType: "tenant_config_version",
        resourceId: String(saved.version),
        summary: `保存门店配置 v${saved.version}`,
      });
      return { data: saved };
    } catch (error) {
      if (error instanceof InvalidTenantConfigError) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw error;
    }
  }

  @TenantScope()
  @Permissions("tenant.manage")
  @Post("rollback")
  async rollback(@Req() req: AuthenticatedRequest) {
    try {
      const version = await this.config.rollback(tenantIdOf(req));
      await this.audit.record({
        tenantId: tenantIdOf(req),
        actorType: req.principal?.role,
        actorId: req.principal?.sub ?? "system",
        action: "tenant-config.rollback",
        resourceType: "tenant_config_version",
        resourceId: String(version),
        summary: `回滚门店配置至 v${version}`,
      });
      return { data: version };
    } catch (error) {
      if (error instanceof NoVersionToRollbackError) {
        throw new HttpException(error.message, HttpStatus.CONFLICT);
      }
      throw error;
    }
  }

  @TenantScope()
  @Permissions("tenant.view")
  @Get("versions")
  async versions(@Req() req: AuthenticatedRequest) {
    return { data: await this.config.listVersions(tenantIdOf(req)) };
  }
}

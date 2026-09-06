import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { Public } from "../../../common/auth/decorators.js";
import { TenancyService } from "../../tenancy/application/tenancy.service.js";
import { TenantNotFoundError } from "../../tenancy/domain/errors.js";
import { TenantConfigService } from "../application/config.service.js";

interface StorefrontTenant {
  id: string;
  code: string;
  name: string;
}

function tenantView(tenant: {
  id: string;
  code: string;
  name: string;
}): StorefrontTenant {
  return { id: tenant.id, code: tenant.code, name: tenant.name };
}

/**
 * 公开门店前台配置（主规格 8.1/13：H5 依据已验证域名加载门店品牌，不信任客户端自报 tenantId）。
 * 仅返回受限 design token（brand）+ 前台开关；配置无效时门店进入 CONFIG_ERROR，不猜测默认值。
 */
@Controller("api/v1/public/storefront")
export class StorefrontConfigController {
  constructor(
    @Inject(TenancyService) private readonly tenancy: TenancyService,
    @Inject(TenantConfigService)
    private readonly configService: TenantConfigService,
  ) {}

  @Public()
  @Get("config")
  async getConfig(@Req() req: Request, @Query("host") hostQuery?: unknown) {
    const host =
      typeof hostQuery === "string" && hostQuery.length > 0
        ? hostQuery
        : (req.headers.host ?? "");
    let tenant;
    try {
      tenant = await this.tenancy.resolveByHost(host);
    } catch (error) {
      if (error instanceof TenantNotFoundError) {
        throw new HttpException("tenant not found", HttpStatus.NOT_FOUND);
      }
      throw error;
    }
    if (tenant.status === "INACTIVE") {
      return {
        data: {
          state: "inactive",
          tenant: tenantView(tenant),
          version: 0,
          config: null,
        },
      };
    }
    const effective = await this.configService.getEffective(tenant.id);
    if (effective.status === "CONFIG_ERROR") {
      return {
        data: {
          state: "config_error",
          tenant: tenantView(tenant),
          version: effective.version,
          config: null,
        },
      };
    }
    return {
      data: {
        state: "active",
        tenant: tenantView(tenant),
        version: effective.version,
        config: effective.config,
      },
    };
  }
}

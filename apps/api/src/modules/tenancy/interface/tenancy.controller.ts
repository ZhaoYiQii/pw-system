import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { TenancyService } from "../application/tenancy.service.js";
import { DuplicateTenantCodeError, InvalidTenantCodeError, TenantNotFoundError } from "../domain/errors.js";
import { PlatformScope, Permissions, Public } from "../../../common/auth/decorators.js";

interface CreateTenantBody {
  code?: unknown;
  name?: unknown;
  timezone?: unknown;
  primaryHost?: unknown;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpException(`${field} must be a non-empty string`, HttpStatus.BAD_REQUEST);
  }
  return value;
}

// 平台运营接口；权限由全局 PermissionsGuard（@Permissions）统一强制。
@Controller("api/v1")
export class TenancyController {
  constructor(@Inject(TenancyService) private readonly tenancy: TenancyService) {}

  @Permissions("tenant.manage")
  @PlatformScope()
  @Post("platform/tenants")
  async createTenant(@Body() body: CreateTenantBody) {
    this.tenancy.assertNoClientTenantId(body);
    try {
      const timezone = body.timezone === undefined ? undefined : asString(body.timezone, "timezone");
      const primaryHost = body.primaryHost === undefined ? undefined : asString(body.primaryHost, "primaryHost");
      const tenant = await this.tenancy.createTenant({
        code: asString(body.code, "code"),
        name: asString(body.name, "name"),
        ...(timezone !== undefined ? { timezone } : {}),
        ...(primaryHost !== undefined ? { primaryHost } : {})
      });
      return { data: tenant };
    } catch (error) {
      if (error instanceof InvalidTenantCodeError || error instanceof DuplicateTenantCodeError) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw error;
    }
  }

  @PlatformScope()
  @Permissions("tenant.view")
  @Get("platform/tenants")
  async listTenants() {
    return { data: await this.tenancy.listTenants() };
  }

  @Permissions("tenant.manage")
  @PlatformScope()
  @Post("platform/tenants/:id/deactivate")
  @HttpCode(200)
  async deactivateTenant(@Param("id") id: string) {
    try {
      return { data: await this.tenancy.deactivateTenant(id) };
    } catch (error) {
      if (error instanceof TenantNotFoundError) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      throw error;
    }
  }

  // 公开解析（预认证）：H5 依据已验证域名/短码加载门店（主规格 8.1）。
  @Public()
  @Get("public/tenant-resolve")
  async resolveTenant(@Req() req: Request, @Query("host") hostQuery?: unknown) {
    const host =
      typeof hostQuery === "string" && hostQuery.length > 0
        ? hostQuery
        : (req.headers.host ?? "");
    try {
      return { data: await this.tenancy.resolveByHost(host) };
    } catch (error) {
      if (error instanceof TenantNotFoundError) {
        throw new HttpException("tenant not found", HttpStatus.NOT_FOUND);
      }
      throw error;
    }
  }
}



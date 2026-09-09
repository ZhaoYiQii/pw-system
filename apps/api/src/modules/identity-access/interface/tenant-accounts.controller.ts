import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { AuditService } from "../../audit/audit.service.js";
import { Permissions } from "../../../common/auth/decorators.js";
import {
  TenantAccountConflictError,
  TenantAccountNotFoundError,
  TenantAccountsService,
  TenantAccountValidationError,
} from "../application/tenant-accounts.service.js";

function tenantIdOf(req: AuthenticatedRequest): string {
  const id = req.principal?.tenantId;
  if (!id)
    throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
  return id;
}

function mapError(error: unknown): never {
  if (error instanceof TenantAccountValidationError) {
    throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
  }
  if (error instanceof TenantAccountNotFoundError) {
    throw new HttpException(error.message, HttpStatus.NOT_FOUND);
  }
  if (error instanceof TenantAccountConflictError) {
    throw new HttpException(error.message, HttpStatus.CONFLICT);
  }
  throw error;
}

@Controller("api/v1/tenant/accounts")
export class TenantAccountsController {
  constructor(
    @Inject(TenantAccountsService)
    private readonly accounts: TenantAccountsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @TenantScope()
  @Permissions("tenant.manage")
  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
    @Query("q") q?: unknown,
  ) {
    const tenantId = tenantIdOf(req);
    const keyword = typeof q === "string" && q.trim() ? q.trim() : undefined;
    return { data: await this.accounts.list(tenantId, keyword) };
  }

  @TenantScope()
  @Permissions("tenant.manage")
  @Post()
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      const tenantId = tenantIdOf(req);
      const input: {
        username: string;
        password?: string;
        roles: string[];
      } = {
        username: typeof body.username === "string" ? body.username : "",
        roles: Array.isArray(body.roles)
          ? (body.roles as unknown[]).map((role) => String(role))
          : [],
      };
      if (typeof body.password === "string") input.password = body.password;
      const created = await this.accounts.create(tenantId, input);
      await this.audit.record({
        tenantId,
        actorType: req.principal?.role,
        actorId: req.principal?.sub ?? "system",
        action: "tenant-account.create",
        resourceType: "tenant_account",
        resourceId: created.id,
        summary: `创建门店账号 ${created.username}`,
      });
      return { data: created };
    } catch (error) {
      mapError(error);
    }
  }

  @TenantScope()
  @Permissions("tenant.manage")
  @Patch(":id/status")
  async setStatus(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: { status?: unknown },
  ) {
    try {
      const tenantId = tenantIdOf(req);
      const status =
        body.status === "ACTIVE" || body.status === "DISABLED"
          ? body.status
          : null;
      if (!status) {
        throw new HttpException(
          "status 需为 ACTIVE|DISABLED",
          HttpStatus.BAD_REQUEST,
        );
      }
      const updated = await this.accounts.setStatus(
        tenantId,
        id,
        status,
        req.principal?.sub ?? "",
      );
      await this.audit.record({
        tenantId,
        actorType: req.principal?.role,
        actorId: req.principal?.sub ?? "system",
        action: "tenant-account.status",
        resourceType: "tenant_account",
        resourceId: id,
        summary: `${updated.username} 状态变更为 ${status}`,
      });
      return { data: updated };
    } catch (error) {
      mapError(error);
    }
  }

  @TenantScope()
  @Permissions("tenant.manage")
  @Patch(":id/roles")
  async setRoles(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: { roles?: unknown },
  ) {
    try {
      const tenantId = tenantIdOf(req);
      const roles = Array.isArray(body.roles) ? body.roles : [];
      const updated = await this.accounts.setRoles(
        tenantId,
        id,
        roles,
        req.principal?.sub ?? "",
      );
      await this.audit.record({
        tenantId,
        actorType: req.principal?.role,
        actorId: req.principal?.sub ?? "system",
        action: "tenant-account.roles",
        resourceType: "tenant_account",
        resourceId: id,
        summary: `${updated.username} 角色更新为 ${updated.roles.join("/")}`,
      });
      return { data: updated };
    } catch (error) {
      mapError(error);
    }
  }
}

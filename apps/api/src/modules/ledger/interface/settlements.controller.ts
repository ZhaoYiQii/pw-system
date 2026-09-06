import { Body, Controller, ForbiddenException, Get, HttpException, HttpStatus, Inject, Param, Post, Req } from "@nestjs/common";
import { PrismaSettlementsRepository } from "../infrastructure/prisma-settlements.repository.js";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";

function tenantIdOf(req: AuthenticatedRequest): string {
  const id = req.principal?.tenantId;
  if (!id) throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
  return id;
}

@Controller("api/v1/tenant/settlements")
export class SettlementsController {
  constructor(@Inject(PrismaSettlementsRepository) private readonly repo: PrismaSettlementsRepository) {}

  private guard(req: AuthenticatedRequest): void {
    const role = req.principal?.role;
    if (role !== "TENANT_OWNER" && role !== "FINANCE") throw new ForbiddenException("仅店主/财务可操作结算");
  }

  private bad(error: unknown): never {
    throw new HttpException(error instanceof Error ? error.message : String(error), HttpStatus.CONFLICT);
  }

  @TenantScope()
  @Permissions("finance.manage")
  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    this.guard(req);
    return { data: await this.repo.list(tenantIdOf(req)) };
  }

  @TenantScope()
  @Permissions("finance.manage")
  @Post()
  async create(@Req() req: AuthenticatedRequest) {
    this.guard(req);
    return { data: { id: await this.repo.create(tenantIdOf(req), req.principal?.sub ?? "system") } };
  }

  @TenantScope()
  @Permissions("finance.manage")
  @Post(":id/items")
  async addItems(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: { earningIds?: unknown }) {
    this.guard(req);
    const ids = Array.isArray(body.earningIds) ? (body.earningIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
    try {
      await this.repo.addItems(tenantIdOf(req), id, ids);
      return { data: { ok: true } };
    } catch (error) {
      this.bad(error);
    }
  }

  @TenantScope()
  @Permissions("finance.manage")
  @Post(":id/review")
  async review(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    this.guard(req);
    try {
      await this.repo.review(tenantIdOf(req), id, req.principal?.sub ?? "system");
      return { data: { ok: true } };
    } catch (error) {
      this.bad(error);
    }
  }

  @TenantScope()
  @Permissions("finance.manage")
  @Post(":id/approve")
  async approve(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    this.guard(req);
    try {
      await this.repo.approve(tenantIdOf(req), id, req.principal?.sub ?? "system");
      return { data: { ok: true } };
    } catch (error) {
      this.bad(error);
    }
  }

  @TenantScope()
  @Permissions("finance.manage")
  @Post(":id/pay")
  async pay(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    this.guard(req);
    try {
      await this.repo.pay(tenantIdOf(req), id, req.principal?.sub ?? "system");
      return { data: { ok: true } };
    } catch (error) {
      this.bad(error);
    }
  }

  @TenantScope()
  @Permissions("finance.manage")
  @Post(":id/void")
  async voidBatch(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    this.guard(req);
    try {
      await this.repo.void(tenantIdOf(req), id);
      return { data: { ok: true } };
    } catch (error) {
      this.bad(error);
    }
  }
}
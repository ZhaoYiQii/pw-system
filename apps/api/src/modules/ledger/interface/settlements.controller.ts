import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { PrismaSettlementsRepository } from "../infrastructure/prisma-settlements.repository.js";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { AuditService } from "../../audit/audit.service.js";

function tenantIdOf(req: AuthenticatedRequest): string {
  const id = req.principal?.tenantId;
  if (!id)
    throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
  return id;
}

@Controller("api/v1/tenant/settlements")
export class SettlementsController {
  constructor(
    @Inject(PrismaSettlementsRepository)
    private readonly repo: PrismaSettlementsRepository,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private guard(req: AuthenticatedRequest): void {
    const role = req.principal?.role;
    if (role !== "TENANT_OWNER" && role !== "FINANCE")
      throw new ForbiddenException("仅店主/财务可操作结算");
  }

  private bad(error: unknown): never {
    throw new HttpException(
      error instanceof Error ? error.message : String(error),
      HttpStatus.CONFLICT,
    );
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
  @Get("earnings")
  async listEarnings(@Req() req: AuthenticatedRequest) {
    this.guard(req);
    return { data: await this.repo.listEarnings(tenantIdOf(req)) };
  }

  @TenantScope()
  @Permissions("finance.manage")
  @Get(":id")
  async detail(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    this.guard(req);
    const view = await this.repo.detail(tenantIdOf(req), id);
    if (!view)
      throw new HttpException("批次不存在", HttpStatus.NOT_FOUND);
    return { data: view };
  }

  @TenantScope()
  @Permissions("finance.manage")
  @Post()
  async create(@Req() req: AuthenticatedRequest) {
    this.guard(req);
    const id = await this.repo.create(
      tenantIdOf(req),
      req.principal?.sub ?? "system",
    );
    await this.audit.record({
      tenantId: tenantIdOf(req),
      actorType: req.principal?.role,
      actorId: req.principal?.sub ?? "system",
      action: "settlement.create",
      resourceType: "settlement_batch",
      resourceId: id,
      summary: "创建结算批次",
    });
    return { data: { id } };
  }

  @TenantScope()
  @Permissions("finance.manage")
  @Post(":id/items")
  async addItems(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: { earningIds?: unknown; slotEarningIds?: unknown },
  ) {
    this.guard(req);
    const ids = Array.isArray(body.earningIds)
      ? (body.earningIds as unknown[]).filter(
          (x): x is string => typeof x === "string",
        )
      : [];
    const slotIds = Array.isArray(body.slotEarningIds)
      ? (body.slotEarningIds as unknown[]).filter(
          (x): x is string => typeof x === "string",
        )
      : [];
    try {
      await this.repo.addItems(tenantIdOf(req), id, ids, slotIds);
      await this.audit.record({
        tenantId: tenantIdOf(req),
        actorType: req.principal?.role,
        actorId: req.principal?.sub ?? "system",
        action: "settlement.add_items",
        resourceType: "settlement_batch",
        resourceId: id,
        summary: `添加 ${ids.length} 条旧应收与 ${slotIds.length} 条档位收入至批次`,
      });
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
      await this.repo.review(
        tenantIdOf(req),
        id,
        req.principal?.sub ?? "system",
      );
      await this.audit.record({
        tenantId: tenantIdOf(req),
        actorType: req.principal?.role,
        actorId: req.principal?.sub ?? "system",
        action: "settlement.review",
        resourceType: "settlement_batch",
        resourceId: id,
        summary: "复核结算批次",
      });
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
      await this.repo.approve(
        tenantIdOf(req),
        id,
        req.principal?.sub ?? "system",
      );
      await this.audit.record({
        tenantId: tenantIdOf(req),
        actorType: req.principal?.role,
        actorId: req.principal?.sub ?? "system",
        action: "settlement.approve",
        resourceType: "settlement_batch",
        resourceId: id,
        summary: "批准结算批次",
      });
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
      await this.audit.record({
        tenantId: tenantIdOf(req),
        actorType: req.principal?.role,
        actorId: req.principal?.sub ?? "system",
        action: "settlement.pay",
        resourceType: "settlement_batch",
        resourceId: id,
        summary: "线下支付登记",
      });
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
      await this.audit.record({
        tenantId: tenantIdOf(req),
        actorType: req.principal?.role,
        actorId: req.principal?.sub ?? "system",
        action: "settlement.void",
        resourceType: "settlement_batch",
        resourceId: id,
        summary: "作废结算批次",
      });
      return { data: { ok: true } };
    } catch (error) {
      this.bad(error);
    }
  }
}

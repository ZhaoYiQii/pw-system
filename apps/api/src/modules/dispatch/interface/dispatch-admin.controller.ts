import { Body, Controller, ForbiddenException, Get, HttpException, HttpStatus, Inject, Param, Post, Req } from "@nestjs/common";
import { DispatchService } from "../application/dispatch.service.js";
import {
  ApplicationConflictError,
  AssignmentExistsError,
  DispatchNotFoundError,
  OrderStateConflictError,
  PlayerNotAcceptingError,
  PlayerSkillMissingError,
  PlayerTimeConflictError
} from "../domain/errors.js";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { AuditService } from "../../audit/audit.service.js";

function tenantIdOf(req: AuthenticatedRequest): string {
  const id = req.principal?.tenantId;
  if (!id) throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
  return id;
}

function actorOf(req: AuthenticatedRequest): string {
  return req.principal?.sub ?? "system";
}

function requireStaff(req: AuthenticatedRequest): void {
  const role = req.principal?.role;
  if (role !== "TENANT_OWNER" && role !== "CUSTOMER_SERVICE") throw new ForbiddenException("需要客服/店主身份");
}

@Controller("api/v1/tenant")
export class DispatchAdminController {
  constructor(
    @Inject(DispatchService) private readonly dispatch: DispatchService,
    @Inject(AuditService) private readonly audit: AuditService
  ) {}

  private mapError(error: unknown): never {
    if (error instanceof DispatchNotFoundError) throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    if (error instanceof OrderStateConflictError || error instanceof ApplicationConflictError || error instanceof AssignmentExistsError) {
      throw new HttpException(error.message, HttpStatus.CONFLICT);
    }
    if (error instanceof PlayerNotAcceptingError || error instanceof PlayerSkillMissingError || error instanceof PlayerTimeConflictError) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
    throw error;
  }

  @TenantScope()
  @Permissions("order.manage")
  @Post("orders/:id/publish")
  async publish(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    requireStaff(req);
    try {
      await this.dispatch.publish(tenantIdOf(req), id, actorOf(req));
      await this.audit.record({
        tenantId: tenantIdOf(req),
        actorType: req.principal?.role,
        actorId: actorOf(req),
        action: "dispatch.publish",
        resourceType: "order",
        resourceId: id,
        summary: "发布派单"
      });
      return { data: { ok: true } };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("order.manage")
  @Get("orders/:id/applications")
  async applications(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    requireStaff(req);
    try {
      return { data: await this.dispatch.applications(tenantIdOf(req), id) };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("order.manage")
  @Post("orders/:id/applications/:applicationId/shortlist")
  async shortlist(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Param("applicationId") applicationId: string, @Body() body: { shortlisted?: unknown }) {
    requireStaff(req);
    try {
      await this.dispatch.shortlist(tenantIdOf(req), id, applicationId, body.shortlisted === true, actorOf(req));
      await this.audit.record({
        tenantId: tenantIdOf(req),
        actorType: req.principal?.role,
        actorId: actorOf(req),
        action: body.shortlisted === true ? "dispatch.shortlist" : "dispatch.reject",
        resourceType: "application",
        resourceId: applicationId,
        summary: body.shortlisted === true ? "报名入候选" : "报名被拒绝"
      });
      return { data: { ok: true } };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("order.manage")
  @Post("orders/:id/assignment")
  async assign(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: { applicationId?: unknown }) {
    requireStaff(req);
    try {
      const assigned = await this.dispatch.assign(tenantIdOf(req), id, body.applicationId as string, actorOf(req));
      await this.audit.record({
        tenantId: tenantIdOf(req),
        actorType: req.principal?.role,
        actorId: actorOf(req),
        action: "dispatch.assign",
        resourceType: "assignment",
        resourceId: assigned.id,
        summary: "指派陪玩"
      });
      return { data: assigned };
    } catch (error) {
      this.mapError(error);
    }
  }
}

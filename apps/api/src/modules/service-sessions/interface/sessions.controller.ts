import { Body, Controller, ForbiddenException, Get, HttpException, HttpStatus, Inject, Param, Post, Req } from "@nestjs/common";
import { PrismaSessionsRepository } from "../infrastructure/prisma-sessions.repository.js";
import { AdjustmentConflictError, AdjustmentNotFoundError, InvalidSessionInputError, SessionNotFoundError, SessionStateConflictError } from "../domain/errors.js";
import { PlayersService } from "../../players/application/players.service.js";
import { TenantScope } from "../../../common/auth/decorators.js";
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

@Controller("api/v1/tenant")
export class SessionsController {
  constructor(
    @Inject(PrismaSessionsRepository) private readonly repo: PrismaSessionsRepository,
    @Inject(PlayersService) private readonly players: PlayersService,
    @Inject(AuditService) private readonly audit: AuditService
  ) {}

  private mapError(error: unknown): never {
    if (error instanceof SessionNotFoundError || error instanceof AdjustmentNotFoundError) throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    if (error instanceof SessionStateConflictError || error instanceof AdjustmentConflictError) throw new HttpException(error.message, HttpStatus.CONFLICT);
    if (error instanceof InvalidSessionInputError) throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    throw error;
  }

  private isStaff(req: AuthenticatedRequest): boolean {
    const r = req.principal?.role;
    return r === "TENANT_OWNER" || r === "CUSTOMER_SERVICE";
  }

  private async requireActor(req: AuthenticatedRequest, tenantId: string, playerId: string | null): Promise<void> {
    if (this.isStaff(req)) return;
    if (req.principal?.role !== "PLAYER") throw new ForbiddenException("无权操作场次");
    if (!playerId) throw new ForbiddenException("订单未指派");
    const me = await this.players.getByAccount(tenantId, req.principal.sub).catch(() => null);
    if (!me || me.id !== playerId) throw new ForbiddenException("只能操作自己被指派的场次");
  }

  private async actorPlayerId(req: AuthenticatedRequest, tenantId: string, orderId: string): Promise<string | null> {
    const order = await this.repo.detailByOrder(tenantId, orderId);
    if (!order) return null;
    return order.playerId;
  }

  @TenantScope()
  @Get("orders/:orderId/session")
  async session(@Req() req: AuthenticatedRequest, @Param("orderId") orderId: string) {
    const tenantId = tenantIdOf(req);
    const view = await this.repo.detailByOrder(tenantId, orderId);
    await this.requireActor(req, tenantId, view?.playerId ?? null);
    return { data: view ?? null };
  }

  @TenantScope()
  @Post("orders/:orderId/session/start")
  async start(@Req() req: AuthenticatedRequest, @Param("orderId") orderId: string) {
    const tenantId = tenantIdOf(req);
    const assigned = await this.repo.detailByOrder(tenantId, orderId);
    await this.requireActor(req, tenantId, assigned?.playerId ?? (await this.repo.assignedPlayerId(tenantId, orderId)));
    try {
      const result = await this.repo.start(tenantId, orderId, actorOf(req), assigned?.playerId ?? undefined);
      await this.audit.record({
        tenantId,
        actorType: req.principal?.role,
        actorId: actorOf(req),
        action: "session.start",
        resourceType: "service_session",
        resourceId: result.id,
        summary: "开始服务场次"
      });
      return { data: result };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Post("orders/:orderId/session/end")
  async end(@Req() req: AuthenticatedRequest, @Param("orderId") orderId: string) {
    const tenantId = tenantIdOf(req);
    const assigned = await this.repo.detailByOrder(tenantId, orderId);
    await this.requireActor(req, tenantId, assigned?.playerId ?? (await this.repo.assignedPlayerId(tenantId, orderId)));
    try {
      const result = await this.repo.end(tenantId, orderId, actorOf(req));
      await this.audit.record({
        tenantId,
        actorType: req.principal?.role,
        actorId: actorOf(req),
        action: "session.end",
        resourceType: "service_session",
        resourceId: result.id,
        summary: "结束服务场次"
      });
      return { data: result };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Post("sessions/:sessionId/adjustments")
  async adjust(@Req() req: AuthenticatedRequest, @Param("sessionId") sessionId: string, @Body() body: { requestedDurationSeconds?: unknown; reason?: unknown }) {
    const tenantId = tenantIdOf(req);
    const view = await this.repo.detailById(tenantId, sessionId);
    await this.requireActor(req, tenantId, view?.playerId ?? null);
    try {
      const result = await this.repo.requestAdjustment(tenantId, sessionId, Number(body.requestedDurationSeconds), String(body.reason ?? ""), actorOf(req));
      await this.audit.record({
        tenantId,
        actorType: req.principal?.role,
        actorId: actorOf(req),
        action: "session.adjustment.request",
        resourceType: "service_session",
        resourceId: sessionId,
        summary: "申请时长调整"
      });
      return { data: result };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Post("sessions/:sessionId/adjustments/:adjustmentId/review")
  async review(
    @Req() req: AuthenticatedRequest,
    @Param("sessionId") sessionId: string,
    @Param("adjustmentId") adjustmentId: string,
    @Body() body: { approve?: unknown; comment?: unknown }
  ) {
    if (!this.isStaff(req)) throw new ForbiddenException("仅客服/店主可复核");
    try {
      const result = await this.repo.reviewAdjustment(tenantIdOf(req), adjustmentId, body.approve === true, typeof body.comment === "string" ? body.comment : null);
      await this.audit.record({
        tenantId: tenantIdOf(req),
        actorType: req.principal?.role,
        actorId: actorOf(req),
        action: "session.adjustment.review",
        resourceType: "session_adjustment",
        resourceId: adjustmentId,
        summary: body.approve === true ? "复核通过调整" : "复核拒绝调整"
      });
      return { data: result };
    } catch (error) {
      this.mapError(error);
    }
  }
}

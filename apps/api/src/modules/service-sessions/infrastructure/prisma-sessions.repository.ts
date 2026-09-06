import type { PrismaClient } from "@pw/database";
import {
  AdjustmentConflictError,
  AdjustmentNotFoundError,
  InvalidSessionInputError,
  SessionNotFoundError,
  SessionStateConflictError
} from "../domain/errors.js";

export interface SessionView {
  id: string;
  orderId: string;
  playerId: string;
  status: string;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
  events: Array<{ id: string; eventType: string; fromStatus: string | null; toStatus: string | null; occurredAt: Date }>;
  adjustments: Array<{ id: string; originalDurationSeconds: number; requestedDurationSeconds: number; reason: string; status: string }>;
}

export class PrismaSessionsRepository {
  constructor(private readonly client: PrismaClient) {}

  async detailByOrder(tenantId: string, orderId: string): Promise<SessionView | null> {
    const s = await this.client.serviceSession.findFirst({ where: { tenantId, orderId } });
    if (!s) return null;
    return this.assemble(tenantId, s.id);
  }

  async assignedPlayerId(tenantId: string, orderId: string): Promise<string | null> {
    const a = await this.client.assignment.findFirst({ where: { tenantId, orderId }, select: { playerId: true } });
    return a?.playerId ?? null;
  }

  async detailById(tenantId: string, sessionId: string): Promise<SessionView | null> {
    const s = await this.client.serviceSession.findFirst({ where: { tenantId, id: sessionId } });
    if (!s) return null;
    return this.assemble(tenantId, s.id);
  }

  private async assemble(tenantId: string, sessionId: string): Promise<SessionView> {
    const s = await this.client.serviceSession.findFirst({ where: { tenantId, id: sessionId } });
    if (!s) throw new SessionNotFoundError("session", sessionId);
    const events = await this.client.sessionEvent.findMany({ where: { tenantId, sessionId }, orderBy: { occurredAt: "asc" } });
    const adjustments = await this.client.sessionAdjustment.findMany({ where: { tenantId, sessionId }, orderBy: { createdAt: "desc" } });
    return {
      id: s.id,
      orderId: s.orderId,
      playerId: s.playerId,
      status: s.status,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      durationSeconds: s.durationSeconds,
      events: events.map((e) => ({ id: e.id, eventType: e.eventType, fromStatus: e.fromStatus, toStatus: e.toStatus, occurredAt: e.occurredAt })),
      adjustments: adjustments.map((a) => ({
        id: a.id,
        originalDurationSeconds: a.originalDurationSeconds,
        requestedDurationSeconds: a.requestedDurationSeconds,
        reason: a.reason,
        status: a.status
      }))
    };
  }

  /** 开始场次：订单必须 ASSIGNED；服务器时间；重复开始幂等返回同一场次。 */
  async start(tenantId: string, orderId: string, actorId: string, playerId?: string): Promise<SessionView> {
    const id = await this.client.$transaction(async (tx) => {
      const order = await tx.order.findFirst({ where: { tenantId, id: orderId }, select: { status: true } });
      if (!order) throw new SessionNotFoundError("order", orderId);
      if (order.status !== "ASSIGNED") throw new SessionStateConflictError(orderId, order.status, "START");
      const existing = await tx.serviceSession.findFirst({ where: { tenantId, orderId } });
      if (existing) return existing.id;
      const assignment = await tx.assignment.findFirst({ where: { tenantId, orderId }, select: { playerId: true, id: true } });
      const finalPlayerId = playerId ?? assignment?.playerId;
      if (!finalPlayerId) throw new InvalidSessionInputError("缺少陪玩");
      const now = new Date();
      const created = await tx.serviceSession.create({
        data: { tenantId, orderId, playerId: finalPlayerId, assignmentId: assignment?.id ?? null, startedAt: now, status: "STARTED" }
      });
      await tx.sessionEvent.create({
        data: { tenantId, sessionId: created.id, eventType: "SESSION_STARTED", fromStatus: "SCHEDULED", toStatus: "STARTED", actorType: "tenant_account", actorId, payload: { startedAt: now.toISOString() } }
      });
      await tx.outboxEvent.create({
        data: { tenantId, aggregateType: "session", aggregateId: created.id, eventType: "session.started", payload: { orderId, startedAt: now.toISOString() } }
      });
      return created.id;
    });
    return (await this.detailById(tenantId, id)) as SessionView;
  }

  /** 结束场次：服务器时间核算 duration；已结束幂等返回同一场次。 */
  async end(tenantId: string, orderId: string, actorId: string): Promise<SessionView> {
    const id = await this.client.$transaction(async (tx) => {
      const s = await tx.serviceSession.findFirst({ where: { tenantId, orderId }, select: { id: true, status: true, startedAt: true } });
      if (!s) throw new SessionNotFoundError("session", orderId);
      if (s.status === "ENDED") return s.id;
      if (s.status !== "STARTED") throw new SessionStateConflictError(s.id, s.status, "END");
      if (!s.startedAt) throw new InvalidSessionInputError("缺少 startedAt");
      const now = new Date();
      const duration = Math.max(0, Math.floor((now.getTime() - s.startedAt.getTime()) / 1000));
      await tx.serviceSession.update({ where: { id: s.id }, data: { status: "ENDED", endedAt: now, durationSeconds: duration } });
      await tx.sessionEvent.create({
        data: { tenantId, sessionId: s.id, eventType: "SESSION_ENDED", fromStatus: "STARTED", toStatus: "ENDED", actorType: "tenant_account", actorId, payload: { endedAt: now.toISOString(), durationSeconds: duration } }
      });
      await tx.outboxEvent.create({
        data: { tenantId, aggregateType: "session", aggregateId: s.id, eventType: "session.ended", payload: { orderId, durationSeconds: duration } }
      });
      return s.id;
    });
    return (await this.detailById(tenantId, id)) as SessionView;
  }

  async requestAdjustment(tenantId: string, sessionId: string, requestedDurationSeconds: number, reason: string, actorId: string): Promise<SessionView> {
    if (!Number.isInteger(requestedDurationSeconds) || requestedDurationSeconds <= 0) {
      throw new InvalidSessionInputError("requestedDurationSeconds 必须为正整数");
    }
    await this.client.$transaction(async (tx) => {
      const s = await tx.serviceSession.findFirst({ where: { tenantId, id: sessionId }, select: { id: true, status: true, durationSeconds: true } });
      if (!s) throw new SessionNotFoundError("session", sessionId);
      if (s.status !== "ENDED") throw new SessionStateConflictError(sessionId, s.status, "ADJUST");
      await tx.sessionAdjustment.create({
        data: { tenantId, sessionId, originalDurationSeconds: s.durationSeconds ?? 0, requestedDurationSeconds, reason, requestedBy: actorId }
      });
      await tx.serviceSession.update({ where: { id: sessionId }, data: { status: "ADJUSTMENT_PENDING" } });
    });
    return (await this.detailById(tenantId, sessionId)) as SessionView;
  }

  async reviewAdjustment(tenantId: string, adjustmentId: string, approve: boolean, comment: string | null): Promise<SessionView> {
    const sessionId = await this.client.$transaction(async (tx) => {
      const a = await tx.sessionAdjustment.findFirst({ where: { tenantId, id: adjustmentId } });
      if (!a) throw new AdjustmentNotFoundError(adjustmentId);
      if (a.status !== "PENDING") throw new AdjustmentConflictError("该调整已处理");
      await tx.sessionAdjustment.update({
        where: { id: a.id },
        data: { status: approve ? "APPROVED" : "REJECTED", ...(comment ? { reviewComment: comment } : {}) }
      });
      if (approve) {
        await tx.serviceSession.update({ where: { id: a.sessionId }, data: { status: "ENDED", durationSeconds: a.requestedDurationSeconds } });
      }
      return a.sessionId;
    });
    return (await this.detailById(tenantId, sessionId)) as SessionView;
  }
}
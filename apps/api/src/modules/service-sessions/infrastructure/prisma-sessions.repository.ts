import type { PrismaClient } from "@pw/database";
import {
  AdjustmentConflictError,
  AdjustmentNotFoundError,
  InvalidSessionInputError,
  SessionNotFoundError,
  SessionStateConflictError,
} from "../domain/errors.js";

export interface SessionView {
  id: string;
  flow: "CLASSIC" | "GAME_DISPATCH";
  slotId: string | null;
  orderId: string;
  playerId: string;
  status: string;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
  /** 算价模型 Task 3：报单申报时长与客服审批留痕（CLASSIC 流程恒为 null / 未报单）。 */
  declaredDurationMinutes: number | null;
  reportStatus: "NOT_REPORTED" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";
  reportSubmittedAt: Date | null;
  reportReviewedAt: Date | null;
  reportReviewNote: string | null;
  events: Array<{
    id: string;
    eventType: string;
    fromStatus: string | null;
    toStatus: string | null;
    occurredAt: Date;
  }>;
  evidence: Array<{
    id: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    uploadedBy: string | null;
    /** 证据用途：计时证据 START/END；报单截图 REPORT_START/REPORT_END。 */
    evidenceType: string;
    createdAt: Date;
  }>;
  adjustments: Array<{
    id: string;
    originalDurationSeconds: number;
    requestedDurationSeconds: number;
    reason: string;
    status: string;
  }>;
}

export interface SessionListRow {
  id: string;
  flow: "CLASSIC" | "GAME_DISPATCH";
  slotId: string | null;
  orderId: string;
  orderNo: string;
  playerId: string;
  playerName: string;
  customerName: string;
  status: string;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
  evidenceCount: number;
  adjustmentPendingCount: number;
  createdAt: Date;
  /**
   * 报单字段（Slice 2 审核台）：CLASSIC 恒为未报单；GAME_DISPATCH 与详情页同一推导口径。
   * 列表页此前没有这些字段，客服只能逐条翻详情，审核台因此无法成队列。
   */
  declaredDurationMinutes: number | null;
  reportStatus: SlotReportStatus;
  reportSubmittedAt: Date | null;
  /** 是否已上传报单需要的开始/结束截图（两类都齐才算 true）。 */
  hasReportEvidence: boolean;
}

export type SlotReportStatus =
  "NOT_REPORTED" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";

/**
 * 报单状态推导（与场次详情同一口径，避免两处漂移）：
 * 未提交=NOT_REPORTED；有 SlotEarning=APPROVED；已审批但无金额=REJECTED；其余=PENDING_REVIEW。
 */
export function slotReportStatusOf(input: {
  reportSubmittedAt: Date | null;
  reportReviewedAt: Date | null;
  hasEarning: boolean;
}): SlotReportStatus {
  if (input.reportSubmittedAt === null) return "NOT_REPORTED";
  if (input.hasEarning) return "APPROVED";
  return input.reportReviewedAt === null ? "PENDING_REVIEW" : "REJECTED";
}

/** 报单截图的两类用途；两类都上传才算证据齐全。 */
const REPORT_EVIDENCE_TYPES = ["REPORT_START", "REPORT_END"] as const;

export class PrismaSessionsRepository {
  constructor(private readonly client: PrismaClient) {}

  async detailByOrder(
    tenantId: string,
    orderId: string,
  ): Promise<SessionView | null> {
    const s = await this.client.serviceSession.findFirst({
      where: { tenantId, orderId },
    });
    if (!s) return null;
    return this.assemble(tenantId, s.id);
  }

  async assignedPlayerId(
    tenantId: string,
    orderId: string,
  ): Promise<string | null> {
    const a = await this.client.assignment.findFirst({
      where: { tenantId, orderId },
      select: { playerId: true },
    });
    return a?.playerId ?? null;
  }

  async detailById(
    tenantId: string,
    sessionId: string,
  ): Promise<SessionView | null> {
    const s = await this.client.serviceSession.findFirst({
      where: { tenantId, id: sessionId },
    });
    if (s) return this.assemble(tenantId, s.id);
    const slot = await this.client.slotSession.findFirst({
      where: { tenantId, id: sessionId },
    });
    if (!slot) return null;
    return this.assembleSlot(tenantId, slot.id);
  }

  private async assemble(
    tenantId: string,
    sessionId: string,
  ): Promise<SessionView> {
    const s = await this.client.serviceSession.findFirst({
      where: { tenantId, id: sessionId },
    });
    if (!s) throw new SessionNotFoundError("session", sessionId);
    const events = await this.client.sessionEvent.findMany({
      where: { tenantId, sessionId },
      orderBy: { occurredAt: "asc" },
    });
    const adjustments = await this.client.sessionAdjustment.findMany({
      where: { tenantId, sessionId },
      orderBy: { createdAt: "desc" },
    });
    const evidence = await this.client.evidenceAsset.findMany({
      where: { tenantId, sessionId },
      orderBy: { createdAt: "asc" },
    });
    return {
      id: s.id,
      flow: "CLASSIC",
      slotId: null,
      orderId: s.orderId,
      playerId: s.playerId,
      status: s.status,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      durationSeconds: s.durationSeconds,
      // CLASSIC 流程没有报单链路（ADR-0002 冻结）：固定为“未报单”。
      declaredDurationMinutes: null,
      reportStatus: "NOT_REPORTED",
      reportSubmittedAt: null,
      reportReviewedAt: null,
      reportReviewNote: null,
      events: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        occurredAt: e.occurredAt,
      })),
      evidence: evidence.map((e) => ({
        id: e.id,
        originalName: e.originalName,
        mimeType: e.mimeType,
        sizeBytes: e.sizeBytes,
        uploadedBy: e.uploadedBy,
        // CLASSIC 证据通道不区分用途（旧流程无报单概念）。
        evidenceType: "EVIDENCE",
        createdAt: e.createdAt,
      })),
      adjustments: adjustments.map((a) => ({
        id: a.id,
        originalDurationSeconds: a.originalDurationSeconds,
        requestedDurationSeconds: a.requestedDurationSeconds,
        reason: a.reason,
        status: a.status,
      })),
    };
  }

  private async assembleSlot(
    tenantId: string,
    sessionId: string,
  ): Promise<SessionView> {
    const s = await this.client.slotSession.findFirst({
      where: { tenantId, id: sessionId },
    });
    if (!s) throw new SessionNotFoundError("session", sessionId);
    const evidence = await this.client.slotEvidence.findMany({
      where: { tenantId, sessionId: s.id },
      orderBy: { createdAt: "asc" },
    });
    // 报单审批通过才落 SlotEarning；有金额即“已通过”（设计规格 §3.3）。
    const earning = await this.client.slotEarning.findFirst({
      where: { tenantId, orderSlotId: s.orderSlotId },
      select: { id: true },
    });
    const events: SessionView["events"] = [];
    if (s.startedAt) {
      events.push({
        id: `${s.id}-started`,
        eventType: "SLOT_SESSION_STARTED",
        fromStatus: "NOT_STARTED",
        toStatus: "STARTED",
        occurredAt: s.startedAt,
      });
    }
    if (s.endedAt) {
      events.push({
        id: `${s.id}-ended`,
        eventType: "SLOT_SESSION_ENDED",
        fromStatus: "STARTED",
        toStatus: "ENDED",
        occurredAt: s.endedAt,
      });
    }
    return {
      id: s.id,
      flow: "GAME_DISPATCH",
      slotId: s.orderSlotId,
      orderId: s.orderId,
      playerId: s.playerId,
      status: s.status,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      durationSeconds: s.durationSeconds,
      declaredDurationMinutes: s.declaredDurationMinutes ?? null,
      // 推导收敛到 `slotReportStatusOf`：列表（审核台队列）与详情必须同一口径。
      reportStatus: slotReportStatusOf({
        reportSubmittedAt: s.reportSubmittedAt ?? null,
        reportReviewedAt: s.reportReviewedAt ?? null,
        hasEarning: earning !== null && earning !== undefined,
      }),
      reportSubmittedAt: s.reportSubmittedAt ?? null,
      reportReviewedAt: s.reportReviewedAt ?? null,
      reportReviewNote: s.reportReviewNote ?? null,
      events,
      evidence: evidence.map((e) => ({
        id: e.id,
        originalName: e.originalName,
        mimeType: e.mimeType,
        sizeBytes: e.sizeBytes,
        uploadedBy: e.uploadedBy,
        evidenceType: e.evidenceType,
        createdAt: e.createdAt,
      })),
      adjustments: [],
    };
  }

  async list(
    tenantId: string,
    opts: {
      status?: string;
      q?: string;
      /** 审核台队列：按报单状态过滤（与详情页 reportStatus 同口径）。 */
      reportStatus?: string;
    } = {},
  ): Promise<SessionListRow[]> {
    const wantReportStatus = opts.reportStatus;
    const classicRows = await this.client.serviceSession.findMany({
      where: {
        tenantId,
        ...(opts.status ? { status: opts.status as never } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const slotRows = await this.client.slotSession.findMany({
      where: {
        tenantId,
        ...(opts.status ? { status: opts.status as never } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    if (classicRows.length === 0 && slotRows.length === 0) return [];
    const orderIds = Array.from(
      new Set([
        ...classicRows.map((r) => r.orderId),
        ...slotRows.map((r) => r.orderId),
      ]),
    );
    const playerIds = Array.from(
      new Set([
        ...classicRows.map((r) => r.playerId),
        ...slotRows.map((r) => r.playerId),
      ]),
    );
    const [orders, players, evidenceRows, pendingAdjustments] =
      await Promise.all([
        this.client.order.findMany({
          where: { tenantId, id: { in: orderIds } },
          select: {
            id: true,
            orderNo: true,
            customerProfileId: true,
          },
        }),
        this.client.playerProfile.findMany({
          where: { tenantId, id: { in: playerIds } },
          select: { id: true, name: true },
        }),
        this.client.evidenceAsset.groupBy({
          by: ["sessionId"],
          where: {
            tenantId,
            sessionId: { in: classicRows.map((r) => r.id) },
          },
          _count: { _all: true },
        }),
        this.client.sessionAdjustment.groupBy({
          by: ["sessionId"],
          where: {
            tenantId,
            sessionId: { in: classicRows.map((r) => r.id) },
            status: "PENDING",
          },
          _count: { _all: true },
        }),
      ]);
    const slotEvidenceRows =
      slotRows.length > 0
        ? await this.client.slotEvidence.groupBy({
            by: ["sessionId"],
            where: {
              tenantId,
              sessionId: { in: slotRows.map((r) => r.id) },
            },
            _count: { _all: true },
          })
        : [];
    // 审核台队列：报单截图按用途分组，用于判断「开始/结束截图是否齐」。
    const reportEvidenceRows =
      slotRows.length > 0
        ? await this.client.slotEvidence.groupBy({
            by: ["sessionId", "evidenceType"],
            where: {
              tenantId,
              sessionId: { in: slotRows.map((r) => r.id) },
              evidenceType: { in: [...REPORT_EVIDENCE_TYPES] },
            },
            _count: { _all: true },
          })
        : [];
    // 审批通过才会落 SlotEarning；有金额=APPROVED，已审批无金额=REJECTED（与详情同口径）。
    const slotIdsForEarning = slotRows.map((r) => r.orderSlotId);
    const earningRows =
      slotIdsForEarning.length > 0
        ? await this.client.slotEarning.findMany({
            where: { tenantId, orderSlotId: { in: slotIdsForEarning } },
            select: { orderSlotId: true },
          })
        : [];
    const earningSlotIds = new Set(earningRows.map((row) => row.orderSlotId));
    const customerIds = Array.from(
      new Set(orders.map((o) => o.customerProfileId)),
    );
    const customers =
      customerIds.length > 0
        ? await this.client.customerProfile.findMany({
            where: { tenantId, id: { in: customerIds } },
            select: { id: true, name: true },
          })
        : [];
    const orderById = new Map(orders.map((o) => [o.id, o]));
    const playerById = new Map(players.map((p) => [p.id, p.name]));
    const customerById = new Map(customers.map((c) => [c.id, c.name]));
    const evidenceCount = new Map(
      evidenceRows.map((r) => [r.sessionId, r._count._all]),
    );
    const slotEvidenceCount = new Map(
      slotEvidenceRows.map((r) => [r.sessionId, r._count._all]),
    );
    const pendingCount = new Map(
      pendingAdjustments.map((r) => [r.sessionId, r._count._all]),
    );
    // 报单截图是否齐：按 sessionId 收集已上传的用途集合
    const reportEvidenceTypes = new Map<string, Set<string>>();
    for (const row of reportEvidenceRows) {
      const types = reportEvidenceTypes.get(row.sessionId) ?? new Set<string>();
      types.add(row.evidenceType);
      reportEvidenceTypes.set(row.sessionId, types);
    }
    const hasFullReportEvidence = (sessionId: string): boolean => {
      const types = reportEvidenceTypes.get(sessionId);
      return (
        types !== undefined && REPORT_EVIDENCE_TYPES.every((t) => types.has(t))
      );
    };
    const classicOut = classicRows.map((r) => {
      const order = orderById.get(r.orderId);
      return {
        id: r.id,
        flow: "CLASSIC" as const,
        slotId: null,
        orderId: r.orderId,
        orderNo: order?.orderNo ?? "未知订单",
        playerId: r.playerId,
        playerName: playerById.get(r.playerId) ?? "未知陪玩",
        customerName: order
          ? (customerById.get(order.customerProfileId) ?? "未知客户")
          : "未知客户",
        status: r.status,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        durationSeconds: r.durationSeconds,
        evidenceCount: evidenceCount.get(r.id) ?? 0,
        adjustmentPendingCount: pendingCount.get(r.id) ?? 0,
        createdAt: r.createdAt,
        // CLASSIC 流程没有报单链路（ADR-0002 冻结）：固定「未报单」。
        declaredDurationMinutes: null,
        reportStatus: "NOT_REPORTED" as SlotReportStatus,
        reportSubmittedAt: null,
        hasReportEvidence: false,
      };
    });
    const slotOut = slotRows.map((r) => {
      const order = orderById.get(r.orderId);
      return {
        id: r.id,
        flow: "GAME_DISPATCH" as const,
        slotId: r.orderSlotId,
        orderId: r.orderId,
        orderNo: order?.orderNo ?? "未知订单",
        playerId: r.playerId,
        playerName: playerById.get(r.playerId) ?? "未知陪玩",
        customerName: order
          ? (customerById.get(order.customerProfileId) ?? "未知客户")
          : "未知客户",
        status: r.status,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        durationSeconds: r.durationSeconds,
        evidenceCount: slotEvidenceCount.get(r.id) ?? 0,
        adjustmentPendingCount: 0,
        createdAt: r.createdAt,
        declaredDurationMinutes: r.declaredDurationMinutes ?? null,
        reportStatus: slotReportStatusOf({
          reportSubmittedAt: r.reportSubmittedAt ?? null,
          reportReviewedAt: r.reportReviewedAt ?? null,
          hasEarning: earningSlotIds.has(r.orderSlotId),
        }),
        reportSubmittedAt: r.reportSubmittedAt ?? null,
        hasReportEvidence: hasFullReportEvidence(r.id),
      };
    });
    return [...slotOut, ...classicOut]
      .filter((row) =>
        wantReportStatus ? row.reportStatus === wantReportStatus : true,
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 100);
  }

  /** 开始场次：ASSIGNED→READY→IN_PROGRESS；服务器时间；重复开始幂等返回同一场次。 */
  async start(
    tenantId: string,
    orderId: string,
    actorId: string,
    playerId?: string,
  ): Promise<SessionView> {
    const id = await this.client.$transaction(async (tx) => {
      // 行锁串行化并发 start，避免唯一约束下 500
      const locks = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM orders
        WHERE id = ${orderId}::uuid AND tenant_id = ${tenantId}::uuid
        FOR UPDATE`;
      if (locks.length === 0) throw new SessionNotFoundError("order", orderId);
      const orderStatus = locks[0]?.status as string;
      const existing = await tx.serviceSession.findFirst({
        where: { tenantId, orderId },
      });
      if (existing) return existing.id;
      if (orderStatus === "ASSIGNED") {
        await tx.orderEvent.create({
          data: {
            tenantId,
            orderId,
            eventType: "ORDER_READY",
            fromStatus: "ASSIGNED",
            toStatus: "READY",
            actorType: "tenant_account",
            actorId,
            payload: {},
          },
        });
        await tx.order.update({
          where: { id: orderId },
          data: { status: "READY" },
        });
        await tx.orderEvent.create({
          data: {
            tenantId,
            orderId,
            eventType: "ORDER_STARTED",
            fromStatus: "READY",
            toStatus: "IN_PROGRESS",
            actorType: "tenant_account",
            actorId,
            payload: {},
          },
        });
        await tx.order.update({
          where: { id: orderId },
          data: { status: "IN_PROGRESS" },
        });
      } else if (orderStatus !== "READY") {
        throw new SessionStateConflictError(orderId, orderStatus, "START");
      } else {
        await tx.orderEvent.create({
          data: {
            tenantId,
            orderId,
            eventType: "ORDER_STARTED",
            fromStatus: "READY",
            toStatus: "IN_PROGRESS",
            actorType: "tenant_account",
            actorId,
            payload: {},
          },
        });
        await tx.order.update({
          where: { id: orderId },
          data: { status: "IN_PROGRESS" },
        });
      }
      const assignment = await tx.assignment.findFirst({
        where: { tenantId, orderId },
        select: { playerId: true, id: true },
      });
      const finalPlayerId = playerId ?? assignment?.playerId;
      if (!finalPlayerId) throw new InvalidSessionInputError("缺少陪玩");
      const now = new Date();
      const created = await tx.serviceSession.create({
        data: {
          tenantId,
          orderId,
          playerId: finalPlayerId,
          assignmentId: assignment?.id ?? null,
          startedAt: now,
          status: "STARTED",
        },
      });
      await tx.sessionEvent.create({
        data: {
          tenantId,
          sessionId: created.id,
          eventType: "SESSION_STARTED",
          fromStatus: "SCHEDULED",
          toStatus: "STARTED",
          actorType: "tenant_account",
          actorId,
          payload: { startedAt: now.toISOString() },
        },
      });
      await tx.outboxEvent.create({
        data: {
          tenantId,
          aggregateType: "session",
          aggregateId: created.id,
          eventType: "session.started",
          payload: { orderId, startedAt: now.toISOString() },
        },
      });
      return created.id;
    });
    return (await this.detailById(tenantId, id)) as SessionView;
  }

  /** 结束场次：服务器时间核算 duration；条件更新保证并发下仅一次成功，幂等返回同一场次。 */
  async end(
    tenantId: string,
    orderId: string,
    actorId: string,
  ): Promise<SessionView> {
    const id = await this.client.$transaction(async (tx) => {
      const s = await tx.serviceSession.findFirst({
        where: { tenantId, orderId },
        select: { id: true, status: true, startedAt: true },
      });
      if (!s) throw new SessionNotFoundError("session", orderId);
      if (s.status === "ENDED") return s.id;
      if (s.status !== "STARTED")
        throw new SessionStateConflictError(s.id, s.status, "END");
      if (!s.startedAt) throw new InvalidSessionInputError("缺少 startedAt");
      const evidenceCount = await tx.evidenceAsset.count({
        where: { tenantId, sessionId: s.id },
      });
      if (evidenceCount < 1)
        throw new InvalidSessionInputError(
          "场次结束前至少需上传 1 张真实图片证据（主规格 10.3/10.5）",
        );
      const now = new Date();
      const duration = Math.max(
        0,
        Math.floor((now.getTime() - s.startedAt.getTime()) / 1000),
      );
      const updated = await tx.serviceSession.updateMany({
        where: { tenantId, id: s.id, status: "STARTED" },
        data: { status: "ENDED", endedAt: now, durationSeconds: duration },
      });
      if (updated.count === 0) {
        const after = await tx.serviceSession.findFirst({
          where: { tenantId, id: s.id },
          select: { status: true },
        });
        if (after?.status === "ENDED") return s.id;
        throw new SessionStateConflictError(s.id, s.status ?? "STARTED", "END");
      }
      await tx.sessionEvent.create({
        data: {
          tenantId,
          sessionId: s.id,
          eventType: "SESSION_ENDED",
          fromStatus: "STARTED",
          toStatus: "ENDED",
          actorType: "tenant_account",
          actorId,
          payload: { endedAt: now.toISOString(), durationSeconds: duration },
        },
      });
      await tx.outboxEvent.create({
        data: {
          tenantId,
          aggregateType: "session",
          aggregateId: s.id,
          eventType: "session.ended",
          payload: { orderId, durationSeconds: duration },
        },
      });
      const orderRes = await tx.order.updateMany({
        where: { tenantId, id: orderId, status: "IN_PROGRESS" },
        data: { status: "PENDING_CONFIRMATION" },
      });
      if (orderRes.count > 0) {
        await tx.orderEvent.create({
          data: {
            tenantId,
            orderId,
            eventType: "ORDER_SESSION_ENDED",
            fromStatus: "IN_PROGRESS",
            toStatus: "PENDING_CONFIRMATION",
            actorType: "tenant_account",
            actorId,
            payload: { durationSeconds: duration },
          },
        });
      }
      return s.id;
    });
    return (await this.detailById(tenantId, id)) as SessionView;
  }
  async requestAdjustment(
    tenantId: string,
    sessionId: string,
    requestedDurationSeconds: number,
    reason: string,
    actorId: string,
  ): Promise<SessionView> {
    if (
      !Number.isInteger(requestedDurationSeconds) ||
      requestedDurationSeconds <= 0
    ) {
      throw new InvalidSessionInputError(
        "requestedDurationSeconds 必须为正整数",
      );
    }
    await this.client.$transaction(async (tx) => {
      const s = await tx.serviceSession.findFirst({
        where: { tenantId, id: sessionId },
        select: { id: true, status: true, durationSeconds: true },
      });
      if (!s) throw new SessionNotFoundError("session", sessionId);
      if (s.status !== "ENDED")
        throw new SessionStateConflictError(sessionId, s.status, "ADJUST");
      await tx.sessionAdjustment.create({
        data: {
          tenantId,
          sessionId,
          originalDurationSeconds: s.durationSeconds ?? 0,
          requestedDurationSeconds,
          reason,
          requestedBy: actorId,
        },
      });
      await tx.serviceSession.update({
        where: { id: sessionId },
        data: { status: "ADJUSTMENT_PENDING" },
      });
    });
    return (await this.detailById(tenantId, sessionId)) as SessionView;
  }

  async reviewAdjustment(
    tenantId: string,
    adjustmentId: string,
    approve: boolean,
    comment: string | null,
    actorId: string,
  ): Promise<SessionView> {
    const sessionId = await this.client.$transaction(async (tx) => {
      const a = await tx.sessionAdjustment.findFirst({
        where: { tenantId, id: adjustmentId },
      });
      if (!a) throw new AdjustmentNotFoundError(adjustmentId);
      if (a.status !== "PENDING")
        throw new AdjustmentConflictError("该调整已处理");
      if (a.requestedBy !== null && a.requestedBy === actorId) {
        throw new AdjustmentConflictError("发起人不能复核自己的调整");
      }
      await tx.sessionAdjustment.update({
        where: { id: a.id },
        data: {
          status: approve ? "APPROVED" : "REJECTED",
          ...(comment ? { reviewComment: comment } : {}),
        },
      });
      const session = await tx.serviceSession.findFirst({
        where: { tenantId, id: a.sessionId },
        select: { id: true, status: true },
      });
      if (!session) throw new SessionNotFoundError("session", a.sessionId);
      if (approve) {
        // ADJUSTMENT_PENDING → CONFIRMED：批准后时长定稿
        await tx.serviceSession.update({
          where: { id: a.sessionId },
          data: {
            status: "CONFIRMED",
            durationSeconds: a.requestedDurationSeconds,
          },
        });
        await tx.sessionEvent.create({
          data: {
            tenantId,
            sessionId: a.sessionId,
            eventType: "SESSION_CONFIRMED",
            fromStatus: session.status,
            toStatus: "CONFIRMED",
            actorType: "tenant_account",
            actorId,
            payload: {
              durationSeconds: a.requestedDurationSeconds,
              adjustmentId: a.id,
            },
          },
        });
      } else {
        // 拒绝调整：回到 ENDED，保留原时长
        await tx.serviceSession.update({
          where: { id: a.sessionId },
          data: { status: "ENDED" },
        });
        await tx.sessionEvent.create({
          data: {
            tenantId,
            sessionId: a.sessionId,
            eventType: "SESSION_ADJUSTMENT_REJECTED",
            fromStatus: session.status,
            toStatus: "ENDED",
            actorType: "tenant_account",
            actorId,
            payload: { adjustmentId: a.id },
          },
        });
      }
      return a.sessionId;
    });
    return (await this.detailById(tenantId, sessionId)) as SessionView;
  }

  async sessionOf(
    tenantId: string,
    sessionId: string,
  ): Promise<{ id: string; playerId: string } | null> {
    const s = await this.client.serviceSession.findFirst({
      where: { tenantId, id: sessionId },
      select: { id: true, playerId: true },
    });
    return s ? { id: s.id, playerId: s.playerId } : null;
  }

  async createEvidence(
    tenantId: string,
    sessionId: string,
    input: {
      objectKey: string;
      originalName: string;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
      uploadedBy: string | null;
    },
  ): Promise<{ id: string }> {
    const row = await this.client.evidenceAsset.create({
      data: {
        tenantId,
        sessionId,
        objectKey: input.objectKey,
        originalName: input.originalName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        uploadedBy: input.uploadedBy,
      },
      select: { id: true },
    });
    return { id: row.id };
  }

  async findEvidence(tenantId: string, id: string) {
    return this.client.evidenceAsset.findFirst({ where: { tenantId, id } });
  }

  async findSlotEvidence(tenantId: string, id: string) {
    return this.client.slotEvidence.findFirst({ where: { tenantId, id } });
  }
}

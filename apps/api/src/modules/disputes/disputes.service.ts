import type { DbTransaction, PrismaClient } from "@pw/database";
import { withTenantContext } from "@pw/database";
import { AuditService } from "../audit/audit.service.js";

export class DisputeOrderNotFoundError extends Error {
  constructor(orderId: string) {
    super(`订单不存在：${orderId}`);
    this.name = "DisputeOrderNotFoundError";
  }
}

export class DisputeEarningMismatchError extends Error {
  constructor() {
    super("earning 不存在或不属于该订单");
    this.name = "DisputeEarningMismatchError";
  }
}

export class DisputeNoPlayerError extends Error {
  constructor() {
    super("订单尚未指派陪玩，无法开争议");
    this.name = "DisputeNoPlayerError";
  }
}

export class InvalidDisputeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDisputeInputError";
  }
}

export class DisputesService {
  constructor(
    private readonly client: PrismaClient,
    private readonly audit: AuditService
  ) {}

  async open(
    tenantId: string,
    orderId: string,
    reason: string,
    earningId: string | null,
    actorId: string,
    actorType: string
  ): Promise<{ id: string; status: string; earningId: string | null }> {
    const reasonText = typeof reason === "string" ? reason.trim() : "";
    if (!reasonText || reasonText.length > 1000) {
      throw new InvalidDisputeInputError("reason 需为 1-1000 字符");
    }
    const created = await withTenantContext(this.client, tenantId, async (tx: DbTransaction) => {
      const order = await tx.order.findFirst({
        where: { tenantId, id: orderId },
        select: { id: true, customerProfileId: true }
      });
      if (!order) throw new DisputeOrderNotFoundError(orderId);

      let resolvedEarningId: string | null = null;
      let resolvedPlayerId: string;
      if (earningId) {
        const earning = await tx.earning.findFirst({
          where: { tenantId, id: earningId },
          select: { id: true, playerId: true, orderId: true }
        });
        if (!earning || earning.orderId !== orderId) throw new DisputeEarningMismatchError();
        resolvedEarningId = earning.id;
        resolvedPlayerId = earning.playerId;
      } else {
        const assignment = await tx.assignment.findFirst({
          where: { tenantId, orderId },
          select: { playerId: true }
        });
        if (!assignment) throw new DisputeNoPlayerError();
        resolvedPlayerId = assignment.playerId;
      }

      const d = await tx.dispute.create({
        data: {
          tenantId,
          orderId,
          earningId: resolvedEarningId,
          playerId: resolvedPlayerId,
          customerProfileId: order.customerProfileId,
          reason: reasonText,
          openedBy: actorId
        }
      });
      await tx.disputeEvent.create({
        data: { tenantId, disputeId: d.id, eventType: "DISPUTE_OPENED", fromStatus: null, toStatus: "OPEN", actorType, actorId, payload: { reason: reasonText } }
      });
      return { id: d.id, status: d.status, earningId: resolvedEarningId };
    });
    await this.audit.record({ tenantId, actorType, actorId, action: "dispute.open", resourceType: "dispute", resourceId: created.id, summary: `开争议：${reasonText.slice(0, 100)}` });
    return created;
  }

  async resolve(tenantId: string, disputeId: string, actorId: string, resolution: string): Promise<{ id: string; status: string }> {
    const updated = await withTenantContext(this.client, tenantId, async (tx: DbTransaction) => {
      const d = await tx.dispute.findFirst({ where: { tenantId, id: disputeId } });
      if (!d) throw new Error("争议不存在");
      if (d.status !== "OPEN") throw new Error("仅 OPEN 争议可处理");
      await tx.dispute.update({ where: { id: d.id }, data: { status: "RESOLVED", resolvedBy: actorId, resolution } });
      await tx.disputeEvent.create({
        data: { tenantId, disputeId: d.id, eventType: "DISPUTE_RESOLVED", fromStatus: "OPEN", toStatus: "RESOLVED", actorType: "tenant_account", actorId, payload: { resolution } }
      });
      return { id: d.id, status: "RESOLVED" };
    });
    await this.audit.record({ tenantId, actorType: "tenant_account", actorId, action: "dispute.resolve", resourceType: "dispute", resourceId: updated.id, summary: `处理争议：${resolution.slice(0, 100)}` });
    return updated;
  }

  async list(tenantId: string, orderId?: string) {
    return withTenantContext(this.client, tenantId, (tx: DbTransaction) =>
      tx.dispute.findMany({
        where: { tenantId, ...(orderId ? { orderId } : {}) },
        orderBy: { createdAt: "desc" },
        take: 100
      })
    );
  }

  async hasOpenOnEarnings(tenantId: string, earningIds: string[]): Promise<boolean> {
    if (earningIds.length === 0) return false;
    const row = await withTenantContext(this.client, tenantId, (tx: DbTransaction) =>
      tx.dispute.findFirst({ where: { tenantId, earningId: { in: earningIds }, status: "OPEN" }, select: { id: true } })
    );
    return row !== null;
  }
}
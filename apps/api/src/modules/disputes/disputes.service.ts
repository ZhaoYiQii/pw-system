import type { PrismaClient } from "@pw/database";
import { AuditService } from "../audit/audit.service.js";

export class DisputesService {
  constructor(
    private readonly client: PrismaClient,
    private readonly audit: AuditService
  ) {}

  async open(tenantId: string, orderId: string, reason: string, earningId: string | null, actorId: string, actorType: string): Promise<{ id: string; status: string }> {
    const order = await this.client.order.findFirst({ where: { tenantId, id: orderId }, select: { id: true } });
    if (!order) throw new Error("订单不存在");
    const earning = earningId ? await this.client.earning.findFirst({ where: { tenantId, id: earningId as string }, select: { id: true } }) : null;
    if (earningId && !earning) throw new Error("earning 不存在");
    const player = earning ? await this.client.earning.findFirst({ where: { tenantId, id: earningId as string }, select: { playerId: true } }) : null;
    const customer = await this.client.order.findFirst({ where: { tenantId, id: orderId }, select: { customerProfileId: true } });
    const d = await this.client.dispute.create({
      data: {
        tenantId,
        orderId,
        earningId: earningId ?? null,
        playerId: player?.playerId ?? "00000000-0000-0000-0000-000000000000",
        customerProfileId: customer?.customerProfileId ?? "00000000-0000-0000-0000-000000000000",
        reason,
        openedBy: actorId
      }
    });
    await this.client.disputeEvent.create({
      data: { tenantId, disputeId: d.id, eventType: "DISPUTE_OPENED", fromStatus: null, toStatus: "OPEN", actorType, actorId, payload: { reason } }
    });
    await this.audit.record({ tenantId, actorType, actorId, action: "dispute.open", resourceType: "dispute", resourceId: d.id, summary: `开争议：${reason.slice(0, 100)}` });
    return { id: d.id, status: d.status };
  }

  async resolve(tenantId: string, disputeId: string, actorId: string, resolution: string): Promise<{ id: string; status: string }> {
    const d = await this.client.dispute.findFirst({ where: { tenantId, id: disputeId } });
    if (!d) throw new Error("争议不存在");
    if (d.status !== "OPEN") throw new Error("仅 OPEN 争议可处理");
    await this.client.dispute.update({ where: { id: d.id }, data: { status: "RESOLVED", resolvedBy: actorId, resolution } });
    await this.client.disputeEvent.create({
      data: { tenantId, disputeId: d.id, eventType: "DISPUTE_RESOLVED", fromStatus: "OPEN", toStatus: "RESOLVED", actorType: "tenant_account", actorId, payload: { resolution } }
    });
    await this.audit.record({ tenantId, actorType: "tenant_account", actorId, action: "dispute.resolve", resourceType: "dispute", resourceId: d.id, summary: `处理争议：${resolution.slice(0, 100)}` });
    return { id: d.id, status: "RESOLVED" };
  }

  async list(tenantId: string, orderId?: string) {
    return this.client.dispute.findMany({
      where: { tenantId, ...(orderId ? { orderId } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100
    });
  }

  async hasOpenOnEarnings(tenantId: string, earningIds: string[]): Promise<boolean> {
    if (earningIds.length === 0) return false;
    const row = await this.client.dispute.findFirst({ where: { tenantId, earningId: { in: earningIds }, status: "OPEN" }, select: { id: true } });
    return row !== null;
  }
}
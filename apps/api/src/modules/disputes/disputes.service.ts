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
    private readonly audit: AuditService,
  ) {}

  async open(
    tenantId: string,
    orderId: string,
    reason: string,
    earningId: string | null,
    actorId: string,
    actorType: string,
  ): Promise<{ id: string; status: string; earningId: string | null }> {
    const reasonText = typeof reason === "string" ? reason.trim() : "";
    if (!reasonText || reasonText.length > 1000) {
      throw new InvalidDisputeInputError("reason 需为 1-1000 字符");
    }
    const created = await withTenantContext(
      this.client,
      tenantId,
      async (tx: DbTransaction) => {
        const order = await tx.order.findFirst({
          where: { tenantId, id: orderId },
          select: { id: true, customerProfileId: true },
        });
        if (!order) throw new DisputeOrderNotFoundError(orderId);

        let resolvedEarningId: string | null = null;
        let resolvedPlayerId: string;
        if (earningId) {
          const earning = await tx.earning.findFirst({
            where: { tenantId, id: earningId },
            select: { id: true, playerId: true, orderId: true },
          });
          if (!earning || earning.orderId !== orderId)
            throw new DisputeEarningMismatchError();
          resolvedEarningId = earning.id;
          resolvedPlayerId = earning.playerId;
        } else {
          const assignment = await tx.assignment.findFirst({
            where: { tenantId, orderId },
            select: { playerId: true },
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
            openedBy: actorId,
          },
        });
        await tx.disputeEvent.create({
          data: {
            tenantId,
            disputeId: d.id,
            eventType: "DISPUTE_OPENED",
            fromStatus: null,
            toStatus: "OPEN",
            actorType,
            actorId,
            payload: { reason: reasonText },
          },
        });
        return { id: d.id, status: d.status, earningId: resolvedEarningId };
      },
    );
    await this.audit.record({
      tenantId,
      actorType,
      actorId,
      action: "dispute.open",
      resourceType: "dispute",
      resourceId: created.id,
      summary: `开争议：${reasonText.slice(0, 100)}`,
    });
    return created;
  }

  async resolve(
    tenantId: string,
    disputeId: string,
    actorId: string,
    resolution: string,
  ): Promise<{ id: string; status: string }> {
    const updated = await withTenantContext(
      this.client,
      tenantId,
      async (tx: DbTransaction) => {
        const d = await tx.dispute.findFirst({
          where: { tenantId, id: disputeId },
        });
        if (!d) throw new Error("争议不存在");
        if (d.status !== "OPEN") throw new Error("仅 OPEN 争议可处理");
        await tx.dispute.update({
          where: { id: d.id },
          data: { status: "RESOLVED", resolvedBy: actorId, resolution },
        });
        await tx.disputeEvent.create({
          data: {
            tenantId,
            disputeId: d.id,
            eventType: "DISPUTE_RESOLVED",
            fromStatus: "OPEN",
            toStatus: "RESOLVED",
            actorType: "tenant_account",
            actorId,
            payload: { resolution },
          },
        });
        return { id: d.id, status: "RESOLVED" };
      },
    );
    await this.audit.record({
      tenantId,
      actorType: "tenant_account",
      actorId,
      action: "dispute.resolve",
      resourceType: "dispute",
      resourceId: updated.id,
      summary: `处理争议：${resolution.slice(0, 100)}`,
    });
    return updated;
  }

  async list(tenantId: string, orderId?: string) {
    return withTenantContext(this.client, tenantId, (tx: DbTransaction) =>
      tx.dispute
        .findMany({
          where: { tenantId, ...(orderId ? { orderId } : {}) },
          orderBy: { createdAt: "desc" },
          take: 100,
        })
        .then(async (rows) => {
          if (rows.length === 0) return rows;
          const orderIds = Array.from(new Set(rows.map((r) => r.orderId)));
          const playerIds = Array.from(new Set(rows.map((r) => r.playerId)));
          const customerIds = Array.from(
            new Set(rows.map((r) => r.customerProfileId)),
          );
          const [orders, players, customers] = await Promise.all([
            tx.order.findMany({
              where: { tenantId, id: { in: orderIds } },
              select: { id: true, orderNo: true },
            }),
            tx.playerProfile.findMany({
              where: { tenantId, id: { in: playerIds } },
              select: { id: true, name: true },
            }),
            tx.customerProfile.findMany({
              where: { tenantId, id: { in: customerIds } },
              select: { id: true, name: true },
            }),
          ]);
          const orderNoById = new Map(orders.map((o) => [o.id, o.orderNo]));
          const playerById = new Map(players.map((p) => [p.id, p.name]));
          const customerById = new Map(customers.map((c) => [c.id, c.name]));
          return rows.map((d) => ({
            id: d.id,
            orderId: d.orderId,
            orderNo: orderNoById.get(d.orderId) ?? "未知订单",
            playerId: d.playerId,
            playerName: playerById.get(d.playerId) ?? "未知陪玩",
            customerProfileId: d.customerProfileId,
            customerName: customerById.get(d.customerProfileId) ?? "未知客户",
            earningId: d.earningId,
            reason: d.reason,
            status: d.status,
            openedBy: d.openedBy,
            resolvedBy: d.resolvedBy,
            resolution: d.resolution,
            createdAt: d.createdAt,
            updatedAt: d.updatedAt,
          }));
        }),
    );
  }

  async detail(tenantId: string, disputeId: string) {
    return withTenantContext(this.client, tenantId, async (tx: DbTransaction) => {
      const d = await tx.dispute.findFirst({
        where: { tenantId, id: disputeId },
      });
      if (!d) return null;
      const [events, order, player, customer] = await Promise.all([
        tx.disputeEvent.findMany({
          where: { tenantId, disputeId: d.id },
          orderBy: { occurredAt: "asc" },
        }),
        tx.order.findFirst({
          where: { tenantId, id: d.orderId },
          select: { id: true, orderNo: true },
        }),
        tx.playerProfile.findFirst({
          where: { tenantId, id: d.playerId },
          select: { id: true, name: true },
        }),
        tx.customerProfile.findFirst({
          where: { tenantId, id: d.customerProfileId },
          select: { id: true, name: true },
        }),
      ]);
      let earning: {
        id: string;
        amountFen: string;
        status: string;
        settlementBatchStatus: string | null;
        settlementBatchNo: string | null;
      } | null = null;
      if (d.earningId) {
        const earningRow = await tx.earning.findFirst({
          where: { tenantId, id: d.earningId },
        });
        if (earningRow) {
          const item = await tx.settlementItem.findFirst({
            where: { tenantId, earningId: d.earningId },
            select: { batchId: true },
          });
          const batch = item
            ? await tx.settlementBatch.findFirst({
                where: { tenantId, id: item.batchId },
                select: { status: true, batchNo: true },
              })
            : null;
          earning = {
            id: earningRow.id,
            amountFen: earningRow.amountFen.toString(),
            status: earningRow.status,
            settlementBatchStatus: batch?.status ?? null,
            settlementBatchNo: batch?.batchNo ?? null,
          };
        }
      }
      return {
        id: d.id,
        orderId: d.orderId,
        orderNo: order?.orderNo ?? "未知订单",
        playerId: d.playerId,
        playerName: player?.name ?? "未知陪玩",
        customerProfileId: d.customerProfileId,
        customerName: customer?.name ?? "未知客户",
        earningId: d.earningId,
        earning,
        reason: d.reason,
        status: d.status,
        openedBy: d.openedBy,
        resolvedBy: d.resolvedBy,
        resolution: d.resolution,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        events: events.map((e) => ({
          id: e.id,
          eventType: e.eventType,
          fromStatus: e.fromStatus,
          toStatus: e.toStatus,
          actorType: e.actorType,
          actorId: e.actorId,
          payload: e.payload,
          occurredAt: e.occurredAt,
        })),
      };
    });
  }

  async listMine(
    tenantId: string,
    filter: { playerId?: string; customerProfileId?: string },
  ) {
    return withTenantContext(this.client, tenantId, async (tx: DbTransaction) => {
      const rows = await tx.dispute.findMany({
        where: { tenantId, ...filter },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      if (rows.length === 0) return [];
      const orderIds = Array.from(new Set(rows.map((r) => r.orderId)));
      const orders = await tx.order.findMany({
        where: { tenantId, id: { in: orderIds } },
        select: { id: true, orderNo: true },
      });
      const orderNoById = new Map(orders.map((o) => [o.id, o.orderNo]));
      return rows.map((d) => ({
        id: d.id,
        orderId: d.orderId,
        orderNo: orderNoById.get(d.orderId) ?? "未知订单",
        status: d.status,
        reason: d.reason,
        resolution: d.resolution,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      }));
    });
  }

  async hasOpenOnEarnings(
    tenantId: string,
    earningIds: string[],
  ): Promise<boolean> {
    if (earningIds.length === 0) return false;
    const row = await withTenantContext(
      this.client,
      tenantId,
      (tx: DbTransaction) =>
        tx.dispute.findFirst({
          where: { tenantId, earningId: { in: earningIds }, status: "OPEN" },
          select: { id: true },
        }),
    );
    return row !== null;
  }
}

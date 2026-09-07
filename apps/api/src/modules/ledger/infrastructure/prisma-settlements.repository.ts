import type { PrismaClient } from "@pw/database";

export interface BatchView {
  id: string;
  batchNo: string;
  status: string;
  totalAmountFen: string;
  itemCount: number;
  createdBy: string | null;
  createdAt: Date;
}

export interface PendingEarningView {
  id: string;
  playerId: string;
  amountFen: string;
  playerName: string;
  orderNo: string;
  createdAt: Date;
}

export interface SettlementDetailItem {
  earningId: string;
  amountFen: string;
  playerName: string;
  orderNo: string;
  createdAt: Date;
}

export interface SettlementDetailView extends BatchView {
  items: SettlementDetailItem[];
}

export class PrismaSettlementsRepository {
  constructor(private readonly client: PrismaClient) {}

  private async row(tenantId: string, id: string) {
    return this.client.settlementBatch.findFirst({ where: { tenantId, id } });
  }

  async list(tenantId: string): Promise<BatchView[]> {
    const rows = await this.client.settlementBatch.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
    const out: BatchView[] = [];
    for (const r of rows) {
      const items = await this.client.settlementItem.findMany({
        where: { tenantId, batchId: r.id },
        select: { amountFen: true },
      });
      out.push({
        id: r.id,
        batchNo: r.batchNo,
        status: r.status,
        totalAmountFen: items.reduce((a, i) => a + i.amountFen, 0n).toString(),
        itemCount: items.length,
        createdBy: r.createdBy,
        createdAt: r.createdAt,
      });
    }
    return out;
  }

  async listEarnings(tenantId: string): Promise<PendingEarningView[]> {
    const earnings = await this.client.earning.findMany({
      where: { tenantId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    if (earnings.length === 0) return [];
    const playerIds = Array.from(new Set(earnings.map((e) => e.playerId)));
    const orderIds = Array.from(new Set(earnings.map((e) => e.orderId)));
    const players = await this.client.playerProfile.findMany({
      where: { tenantId, id: { in: playerIds } },
      select: { id: true, name: true },
    });
    const orders = await this.client.order.findMany({
      where: { tenantId, id: { in: orderIds } },
      select: { id: true, orderNo: true },
    });
    const playerById = new Map(players.map((p) => [p.id, p.name]));
    const orderNoById = new Map(orders.map((o) => [o.id, o.orderNo]));
    return earnings.map((e) => ({
      id: e.id,
      playerId: e.playerId,
      amountFen: e.amountFen.toString(),
      playerName: playerById.get(e.playerId) ?? "未知陪玩",
      orderNo: orderNoById.get(e.orderId) ?? "未知订单",
      createdAt: e.createdAt,
    }));
  }

  async detail(
    tenantId: string,
    batchId: string,
  ): Promise<SettlementDetailView | null> {
    const batch = await this.client.settlementBatch.findFirst({
      where: { tenantId, id: batchId },
    });
    if (!batch) return null;
    const items = await this.client.settlementItem.findMany({
      where: { tenantId, batchId },
      orderBy: { createdAt: "asc" },
    });
    const outItems: SettlementDetailItem[] = [];
    if (items.length > 0) {
      const earningIds = items.map((i) => i.earningId);
      const earnings = await this.client.earning.findMany({
        where: { tenantId, id: { in: earningIds } },
      });
      const playerIds = Array.from(
        new Set(earnings.map((e) => e.playerId)),
      );
      const orderIds = Array.from(new Set(earnings.map((e) => e.orderId)));
      const players = await this.client.playerProfile.findMany({
        where: { tenantId, id: { in: playerIds } },
        select: { id: true, name: true },
      });
      const orders = await this.client.order.findMany({
        where: { tenantId, id: { in: orderIds } },
        select: { id: true, orderNo: true },
      });
      const playerById = new Map(players.map((p) => [p.id, p.name]));
      const orderNoById = new Map(orders.map((o) => [o.id, o.orderNo]));
      for (const item of items) {
        const earning = earnings.find((e) => e.id === item.earningId);
        outItems.push({
          earningId: item.earningId,
          amountFen: item.amountFen.toString(),
          playerName: earning
            ? (playerById.get(earning.playerId) ?? "未知陪玩")
            : "未知陪玩",
          orderNo: earning
            ? (orderNoById.get(earning.orderId) ?? "未知订单")
            : "未知订单",
          createdAt: item.createdAt,
        });
      }
    }
    return {
      id: batch.id,
      batchNo: batch.batchNo,
      status: batch.status,
      totalAmountFen: batch.totalAmountFen.toString(),
      itemCount: items.length,
      createdBy: batch.createdBy,
      createdAt: batch.createdAt,
      items: outItems,
    };
  }

  async create(tenantId: string, actorId: string): Promise<string> {
    const batchNo = `S${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const b = await this.client.settlementBatch.create({
      data: {
        tenantId,
        batchNo,
        totalAmountFen: BigInt(0),
        createdBy: actorId,
      },
    });
    return b.id;
  }

  async addItems(
    tenantId: string,
    batchId: string,
    earningIds: string[],
  ): Promise<void> {
    await this.client.$transaction(async (tx) => {
      const batch = await tx.settlementBatch.findFirst({
        where: { tenantId, id: batchId },
        select: { id: true, status: true },
      });
      if (!batch) throw new Error("批次不存在");
      if (batch.status !== "DRAFT") throw new Error("仅 DRAFT 批次可添加");
      for (const earningId of earningIds) {
        const lock = await tx.$queryRaw<Array<{ id: string; status: string }>>`
          SELECT id, status FROM earnings WHERE id = ${earningId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;
        if (lock.length === 0) throw new Error("earning 不存在");
        const e = lock[0] as { id: string; status: string };
        if (e.status !== "PENDING")
          throw new Error("该 earning 已被结算或不可用");
        const openD = await tx.dispute.findFirst({
          where: { tenantId, earningId, status: "OPEN" },
          select: { id: true },
        });
        if (openD) throw new Error("存在开放争议，不能结算");
        const earning = await tx.earning.findFirst({
          where: { tenantId, id: earningId },
          select: { amountFen: true, playerId: true },
        });
        await tx.settlementItem.create({
          data: {
            tenantId,
            batchId,
            earningId,
            amountFen: earning?.amountFen ?? BigInt(0),
          },
        });
        await tx.earning.update({
          where: { id: earningId },
          data: { status: "BATCHED" },
        });
      }
    });
  }

  private async guardStatus(
    tenantId: string,
    id: string,
    expected: string[],
    next: string,
    actorId: string,
    forbidCreator?: boolean,
  ): Promise<{ id: string; createdBy: string | null }> {
    const b = await this.client.settlementBatch.findFirst({
      where: { tenantId, id },
      select: { id: true, status: true, createdBy: true },
    });
    if (!b) throw new Error("批次不存在");
    if (!expected.includes(b.status))
      throw new Error(`状态不允许 ${b.status} -> ${next}`);
    if (forbidCreator && b.createdBy === actorId)
      throw new Error("发起人不能批准自己的批次");
    return b;
  }

  async review(tenantId: string, id: string, actorId: string): Promise<void> {
    await this.guardStatus(tenantId, id, ["DRAFT"], "REVIEWED", actorId);
    await this.client.settlementBatch.updateMany({
      where: { tenantId, id, status: "DRAFT" },
      data: { status: "REVIEWED", reviewedBy: actorId },
    });
  }

  async approve(tenantId: string, id: string, actorId: string): Promise<void> {
    await this.guardStatus(
      tenantId,
      id,
      ["REVIEWED"],
      "APPROVED",
      actorId,
      true,
    );
    await this.client.settlementBatch.updateMany({
      where: { tenantId, id, status: "REVIEWED" },
      data: { status: "APPROVED", approvedBy: actorId },
    });
  }

  async pay(tenantId: string, id: string, actorId: string): Promise<void> {
    await this.guardStatus(tenantId, id, ["APPROVED"], "PAID", actorId);
    await this.client.$transaction(async (tx) => {
      const locks = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM settlement_batches
        WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
        FOR UPDATE`;
      if (locks.length === 0) throw new Error("批次不存在");
      if (locks[0]?.status !== "APPROVED")
        throw new Error(`状态不允许 ${locks[0]?.status ?? "?"} -> PAID`);
      const items = await tx.settlementItem.findMany({
        where: { tenantId, batchId: id },
      });
      const openD = await tx.dispute.findFirst({
        where: {
          tenantId,
          earningId: { in: items.map((i) => i.earningId) },
          status: "OPEN",
        },
        select: { id: true },
      });
      if (openD) throw new Error("批次含开放争议 earning，不能结算");
      const total = items.reduce((a, i) => a + i.amountFen, 0n);
      await tx.manualPaymentRecord.create({
        data: {
          tenantId,
          batchId: id,
          amountFen: total,
          channel: "OFFLINE",
          operatorId: actorId,
        },
      });
      await tx.earning.updateMany({
        where: { tenantId, id: { in: items.map((i) => i.earningId) } },
        data: { status: "PAID" },
      });
      const paidRes = await tx.settlementBatch.updateMany({
        where: { tenantId, id, status: "APPROVED" },
        data: { status: "PAID", paidBy: actorId, totalAmountFen: total },
      });
      if (paidRes.count === 0) throw new Error("批次状态已变化，拒绝重复支付");
    });
  }

  async void(tenantId: string, id: string): Promise<void> {
    await this.guardStatus(
      tenantId,
      id,
      ["DRAFT", "REVIEWED"],
      "VOID",
      "system",
    );
    await this.client.$transaction(async (tx) => {
      const items = await tx.settlementItem.findMany({
        where: { tenantId, batchId: id },
        select: { earningId: true },
      });
      await tx.earning.updateMany({
        where: { tenantId, id: { in: items.map((i) => i.earningId) } },
        data: { status: "PENDING" },
      });
      await tx.settlementItem.deleteMany({ where: { tenantId, batchId: id } });
      await tx.settlementBatch.update({
        where: { id },
        data: { status: "VOID" },
      });
    });
  }
}

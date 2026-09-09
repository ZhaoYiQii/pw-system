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
  source: "LEGACY" | "SLOT";
  playerId: string;
  amountFen: string;
  playerName: string;
  orderNo: string;
  createdAt: Date;
}

export interface SettlementDetailItem {
  itemId: string;
  source: "LEGACY" | "SLOT";
  earningId: string | null;
  slotEarningId: string | null;
  amountFen: string;
  playerName: string;
  orderNo: string;
  createdAt: Date;
}

export interface SettlementDetailView extends BatchView {
  items: SettlementDetailItem[];
  createdByName: string | null;
  reviewedByName: string | null;
  approvedByName: string | null;
  paidByName: string | null;
  paidAt: Date | null;
}

export interface FinanceLedgerRow {
  id: string;
  source: "LEGACY" | "SLOT";
  amountFen: string;
  status: string;
  playerId: string;
  playerName: string;
  orderNo: string;
  batchNo: string | null;
  createdAt: Date;
}

export interface FinanceLedgerView {
  paidFen: string;
  unpaidFen: string;
  rows: FinanceLedgerRow[];
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
    const [legacy, slots] = await Promise.all([
      this.client.earning.findMany({
        where: { tenantId, status: "PENDING" },
        orderBy: { createdAt: "desc" },
      }),
      this.client.slotEarning.findMany({
        where: { tenantId, status: "SETTLED" },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    if (legacy.length === 0 && slots.length === 0) return [];
    const playerIds = Array.from(
      new Set([
        ...legacy.map((e) => e.playerId),
        ...slots.map((e) => e.playerId),
      ]),
    );
    const orderIds = Array.from(
      new Set([
        ...legacy.map((e) => e.orderId),
        ...slots.map((e) => e.orderId),
      ]),
    );
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
    const legacyOut = legacy.map((e): PendingEarningView => ({
      id: e.id,
      source: "LEGACY",
      playerId: e.playerId,
      amountFen: e.amountFen.toString(),
      playerName: playerById.get(e.playerId) ?? "未知陪玩",
      orderNo: orderNoById.get(e.orderId) ?? "未知订单",
      createdAt: e.createdAt,
    }));
    const slotOut = slots.map((e): PendingEarningView => ({
      id: e.id,
      source: "SLOT",
      playerId: e.playerId,
      amountFen: e.amountFen.toString(),
      playerName: playerById.get(e.playerId) ?? "未知陪玩",
      orderNo: orderNoById.get(e.orderId) ?? "未知订单",
      createdAt: e.createdAt,
    }));
    return [...slotOut, ...legacyOut].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  async detail(
    tenantId: string,
    batchId: string,
  ): Promise<SettlementDetailView | null> {
    const batch = await this.client.settlementBatch.findFirst({
      where: { tenantId, id: batchId },
    });
    if (!batch) return null;
    const actorIds = [
      batch.createdBy,
      batch.reviewedBy,
      batch.approvedBy,
      batch.paidBy,
    ].filter((x): x is string => x !== null);
    const actors =
      actorIds.length > 0
        ? await this.client.tenantAccount.findMany({
            where: { tenantId, id: { in: actorIds } },
            select: { id: true, username: true },
          })
        : [];
    const actorName = new Map(actors.map((a) => [a.id, a.username]));
    const payments = await this.client.manualPaymentRecord.findMany({
      where: { tenantId, batchId },
      orderBy: { paidAt: "desc" },
      take: 1,
    });
    const items = await this.client.settlementItem.findMany({
      where: { tenantId, batchId },
      orderBy: { createdAt: "asc" },
    });
    const outItems: SettlementDetailItem[] = [];
    if (items.length > 0) {
      const legacyItems = items.filter((i) => i.sourceType === "LEGACY");
      const slotItems = items.filter((i) => i.sourceType === "SLOT");
      const earningIds = legacyItems
        .map((i) => i.earningId)
        .filter((x): x is string => x !== null);
      const slotEarningIds = slotItems
        .map((i) => i.slotEarningId)
        .filter((x): x is string => x !== null);
      const [earnings, slotEarnings] = await Promise.all([
        this.client.earning.findMany({
          where: { tenantId, id: { in: earningIds } },
        }),
        this.client.slotEarning.findMany({
          where: { tenantId, id: { in: slotEarningIds } },
        }),
      ]);
      const allSources = [...earnings, ...slotEarnings];
      const playerIds = Array.from(
        new Set(allSources.map((e) => e.playerId)),
      );
      const orderIds = Array.from(
        new Set(allSources.map((e) => e.orderId)),
      );
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
        const slotEarning = slotEarnings.find(
          (e) => e.id === item.slotEarningId,
        );
        const source = earning ?? slotEarning;
        outItems.push({
          itemId: item.id,
          source: (item.sourceType === "SLOT" ? "SLOT" : "LEGACY"),
          earningId: item.earningId,
          slotEarningId: item.slotEarningId,
          amountFen: item.amountFen.toString(),
          playerName: source
            ? (playerById.get(source.playerId) ?? "未知陪玩")
            : "未知陪玩",
          orderNo: source
            ? (orderNoById.get(source.orderId) ?? "未知订单")
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
      createdByName: batch.createdBy
        ? (actorName.get(batch.createdBy) ?? null)
        : null,
      reviewedByName: batch.reviewedBy
        ? (actorName.get(batch.reviewedBy) ?? null)
        : null,
      approvedByName: batch.approvedBy
        ? (actorName.get(batch.approvedBy) ?? null)
        : null,
      paidByName: batch.paidBy
        ? (actorName.get(batch.paidBy) ?? null)
        : null,
      paidAt: payments[0]?.paidAt ?? null,
    };
  }

  async financeLedger(tenantId: string): Promise<FinanceLedgerView> {
    const [legacy, slots] = await Promise.all([
      this.client.earning.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
      this.client.slotEarning.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
    ]);
    if (legacy.length === 0 && slots.length === 0)
      return { paidFen: "0", unpaidFen: "0", rows: [] };
    const [players, orders, legacyItems, slotItems] = await Promise.all([
      this.client.playerProfile.findMany({
        where: {
          tenantId,
          id: {
            in: Array.from(
              new Set([
                ...legacy.map((e) => e.playerId),
                ...slots.map((e) => e.playerId),
              ]),
            ),
          },
        },
        select: { id: true, name: true },
      }),
      this.client.order.findMany({
        where: {
          tenantId,
          id: {
            in: Array.from(
              new Set([
                ...legacy.map((e) => e.orderId),
                ...slots.map((e) => e.orderId),
              ]),
            ),
          },
        },
        select: { id: true, orderNo: true },
      }),
      legacy.length > 0
        ? this.client.settlementItem.findMany({
            where: {
              tenantId,
              earningId: { in: legacy.map((e) => e.id) },
            },
            select: { earningId: true, batchId: true },
          })
        : Promise.resolve([]),
      slots.length > 0
        ? this.client.settlementItem.findMany({
            where: {
              tenantId,
              slotEarningId: { in: slots.map((e) => e.id) },
            },
            select: { slotEarningId: true, batchId: true },
          })
        : Promise.resolve([]),
    ]);
    const batchIds = Array.from(
      new Set([
        ...legacyItems.map((i) => i.batchId),
        ...slotItems.map((i) => i.batchId),
      ]),
    );
    const batches =
      batchIds.length > 0
        ? await this.client.settlementBatch.findMany({
            where: { tenantId, id: { in: batchIds } },
            select: { id: true, batchNo: true },
          })
        : [];
    const batchNoById = new Map(batches.map((b) => [b.id, b.batchNo]));
    const playerById = new Map(players.map((p) => [p.id, p.name]));
    const orderNoById = new Map(orders.map((o) => [o.id, o.orderNo]));
    const batchByLegacy = new Map(
      legacyItems.map((i) => [i.earningId, i.batchId]),
    );
    const batchBySlot = new Map(
      slotItems.map((i) => [i.slotEarningId, i.batchId]),
    );
    const rows: FinanceLedgerRow[] = [
      ...legacy.map((e) => {
        const batchId = batchByLegacy.get(e.id);
        return {
          id: e.id,
          source: "LEGACY" as const,
          amountFen: e.amountFen.toString(),
          status: e.status,
          playerId: e.playerId,
          playerName: playerById.get(e.playerId) ?? "未知陪玩",
          orderNo: orderNoById.get(e.orderId) ?? "未知订单",
          batchNo: batchId ? (batchNoById.get(batchId) ?? null) : null,
          createdAt: e.createdAt,
        };
      }),
      ...slots.map((e) => {
        const batchId = batchBySlot.get(e.id);
        return {
          id: e.id,
          source: "SLOT" as const,
          amountFen: e.amountFen.toString(),
          status: e.status,
          playerId: e.playerId,
          playerName: playerById.get(e.playerId) ?? "未知陪玩",
          orderNo: orderNoById.get(e.orderId) ?? "未知订单",
          batchNo: batchId ? (batchNoById.get(batchId) ?? null) : null,
          createdAt: e.createdAt,
        };
      }),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    let paidFen = 0n;
    let unpaidFen = 0n;
    for (const r of rows) {
      if (r.status === "PAID") paidFen += BigInt(r.amountFen);
      else unpaidFen += BigInt(r.amountFen);
    }
    return {
      paidFen: paidFen.toString(),
      unpaidFen: unpaidFen.toString(),
      rows,
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
    slotEarningIds: string[] = [],
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
      for (const slotEarningId of slotEarningIds) {
        const lock = await tx.$queryRaw<Array<{ id: string; status: string }>>`
          SELECT id, status FROM slot_earnings
          WHERE id = ${slotEarningId}::uuid AND tenant_id = ${tenantId}::uuid
          FOR UPDATE`;
        if (lock.length === 0) throw new Error("档位收入不存在");
        const slot = lock[0] as { id: string; status: string };
        if (slot.status !== "SETTLED")
          throw new Error("该档位收入尚未完成老板结算或已入批次");
        const row = await tx.slotEarning.findFirst({
          where: { tenantId, id: slotEarningId },
          select: { amountFen: true },
        });
        await tx.settlementItem.create({
          data: {
            tenantId,
            batchId,
            sourceType: "SLOT",
            earningId: null,
            slotEarningId,
            amountFen: row?.amountFen ?? BigInt(0),
          },
        });
        await tx.slotEarning.update({
          where: { id: slotEarningId },
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
      const legacyIds = items
        .filter((i) => i.sourceType === "LEGACY")
        .map((i) => i.earningId)
        .filter((x): x is string => x !== null);
      const slotIds = items
        .filter((i) => i.sourceType === "SLOT")
        .map((i) => i.slotEarningId)
        .filter((x): x is string => x !== null);
      const openD = await tx.dispute.findFirst({
        where: {
          tenantId,
          earningId: { in: legacyIds },
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
      if (legacyIds.length > 0)
        await tx.earning.updateMany({
          where: { tenantId, id: { in: legacyIds } },
          data: { status: "PAID" },
        });
      if (slotIds.length > 0)
        await tx.slotEarning.updateMany({
          where: { tenantId, id: { in: slotIds } },
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
        select: { sourceType: true, earningId: true, slotEarningId: true },
      });
      const legacyIds = items
        .filter((i) => i.sourceType === "LEGACY")
        .map((i) => i.earningId)
        .filter((x): x is string => x !== null);
      const slotIds = items
        .filter((i) => i.sourceType === "SLOT")
        .map((i) => i.slotEarningId)
        .filter((x): x is string => x !== null);
      if (legacyIds.length > 0)
        await tx.earning.updateMany({
          where: { tenantId, id: { in: legacyIds } },
          data: { status: "PENDING" },
        });
      if (slotIds.length > 0)
        await tx.slotEarning.updateMany({
          where: { tenantId, id: { in: slotIds } },
          data: { status: "SETTLED" },
        });
      await tx.settlementItem.deleteMany({ where: { tenantId, batchId: id } });
      await tx.settlementBatch.update({
        where: { id },
        data: { status: "VOID" },
      });
    });
  }
}

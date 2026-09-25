import type { PrismaClient } from "@pw/database";
import {
  PLAYER_PAYABLE_ACCOUNT,
  PLAYER_PAYOUT_CONFIRMED_EVENT_TYPE,
  PLAYER_PAYOUT_CONFIRMED_SOURCE_TYPE,
  PlayerPayoutConfirmedConflictError,
  SETTLEMENT_FUND_ASSET_ACCOUNT,
  buildManualPaymentNote,
  buildPlayerPayoutConfirmedLedgerPosting,
  toSettlementBatchStatus,
} from "../domain/player-payout-confirmed-ledger-posting.js";
import { assertSettlementBatchTransition } from "../domain/settlement-batch-state.js";

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

/** DS-006：实际付款确认的输入对象（明确输入对象，而非多个位置参数）。 */
export interface ConfirmSettlementPaymentInput {
  tenantId: string;
  batchId: string;
  /** 同租户且 `ACTIVE` 的资金账户 id；查不到即回滚，绝不回退到默认账户。 */
  fundAccountId: string;
  /** 已校验的付款凭证号：进入本方法前必须已过边界校验，本方法内再校验一次。 */
  evidenceRef: string;
  /** 实际付款时间：原样写入 `ManualPaymentRecord.paidAt` 与总账发生/确认时间。 */
  occurredAt: Date;
  /** 客户端本次提交的幂等键：进交易描述；耐久防重靠批次来源唯一交易键。 */
  idempotencyKey: string;
  /** 可选备注（已裁剪，空白为 `null`）。 */
  note: string | null;
  /** 服务端登录态里的操作者 id。 */
  operatorId: string;
}

export interface ConfirmSettlementPaymentResult {
  batchId: string;
  batchNo: string;
  paymentId: string;
  transactionId: string;
  amountFen: bigint;
  status: "PAID";
  /** 资金账户代码/名称：供控制器写审计摘要，避免为审计再查一次库。 */
  fundAccountCode: string;
  fundAccountName: string;
}

/** 科目 id 解析：缺科目直接报错，不做静默兜底（兜底会让分录挂到错误科目上）。 */
function accountIdOf(
  accounts: ReadonlyArray<{ id: string; code: string }>,
  code: string,
): string {
  const found = accounts.find((account) => account.code === code);
  if (!found) throw new Error(`账务科目未就绪（${code}）`);
  return found.id;
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
      const playerIds = Array.from(new Set(allSources.map((e) => e.playerId)));
      const orderIds = Array.from(new Set(allSources.map((e) => e.orderId)));
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
          source: item.sourceType === "SLOT" ? "SLOT" : "LEGACY",
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
      paidByName: batch.paidBy ? (actorName.get(batch.paidBy) ?? null) : null,
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

  /**
   * DS-006：确认门店**已实际付款**（不是代付接口）。
   *
   * 全部写入在 `tenantGuarded` 提供的同一租户事务里完成，顺序即口径：
   * 锁批次 → 幂等检查 → 资金账户 → 合计与争议 → 科目 → 交易与分录 → 付款记录 → 状态。
   * 任一步失败都回滚：批次保持 `APPROVED`，earnings/slot earnings 保持原状态，
   * 不留付款记录与分录。付款成功后不得更新或删除确认交易/分录（更正只能后续走反向交易）。
   */
  async confirmPayment(
    input: ConfirmSettlementPaymentInput,
  ): Promise<ConfirmSettlementPaymentResult> {
    const { tenantId, batchId, fundAccountId, operatorId } = input;
    return this.client.$transaction(async (tx) => {
      // 1) 锁内取批次：不存在/状态不符一律拒绝；状态必须过状态机，不能绕过
      const locks = await tx.$queryRaw<
        Array<{ id: string; status: string; batchNo: string }>
      >`
        SELECT id, status, batch_no AS "batchNo" FROM settlement_batches
        WHERE id = ${batchId}::uuid AND tenant_id = ${tenantId}::uuid
        FOR UPDATE`;
      const locked = locks[0];
      if (!locked) {
        throw new PlayerPayoutConfirmedConflictError("结算批次不存在");
      }
      const status = toSettlementBatchStatus(locked.status);
      if (status !== "APPROVED") {
        throw new PlayerPayoutConfirmedConflictError(
          `批次当前状态为 ${status}，只有 APPROVED 批次可以确认实际付款`,
        );
      }
      assertSettlementBatchTransition(status, "PAID");

      // 2) 同批次只允许一笔 PLAYER_PAYOUT_CONFIRMED：唯一交易键是耐久防重的唯一权威，
      //    重复或并发提交在这里被拦住，不会产生第二条付款记录/交易/分录
      const existing = await tx.ledgerTransaction.findFirst({
        where: {
          tenantId,
          sourceType: PLAYER_PAYOUT_CONFIRMED_SOURCE_TYPE,
          sourceId: batchId,
          eventType: PLAYER_PAYOUT_CONFIRMED_EVENT_TYPE,
        },
        select: { id: true },
      });
      if (existing) {
        throw new PlayerPayoutConfirmedConflictError(
          "该批次已登记实际付款，拒绝重复付款",
        );
      }

      // 3) 资金账户必须属于同一租户：查不到（含跨租户）或非 ACTIVE 一律回滚，
      //    绝不回退到默认账户
      const fundAccount = await tx.fundAccount.findFirst({
        where: { tenantId, id: fundAccountId },
        select: { id: true, code: true, name: true, kind: true, status: true },
      });
      if (!fundAccount) {
        throw new PlayerPayoutConfirmedConflictError(
          "付款资金账户不存在或不属于当前租户",
        );
      }
      if (fundAccount.status !== "ACTIVE") {
        throw new PlayerPayoutConfirmedConflictError(
          `付款资金账户不可用（${fundAccount.status}），不能用于结算付款`,
        );
      }

      // 4) 锁内算合计：必须为正；开放争议仍然冻结付款，批次保持 APPROVED
      const items = await tx.settlementItem.findMany({
        where: { tenantId, batchId },
        select: {
          sourceType: true,
          earningId: true,
          slotEarningId: true,
          amountFen: true,
        },
      });
      const total = items.reduce((sum, item) => sum + item.amountFen, 0n);
      if (total <= 0n) {
        throw new PlayerPayoutConfirmedConflictError(
          "批次项目合计必须大于 0，拒绝付款",
        );
      }
      const legacyIds = items
        .filter((item) => item.sourceType === "LEGACY")
        .map((item) => item.earningId)
        .filter((x): x is string => x !== null);
      const slotIds = items
        .filter((item) => item.sourceType === "SLOT")
        .map((item) => item.slotEarningId)
        .filter((x): x is string => x !== null);
      // 4b) 项目来源无法识别时，合计里会混进一条永远不会被标记 PAID 的款项：
      //     宁可拒绝付款，也不按「总金额对了」静默放行（fail-closed）
      if (legacyIds.length + slotIds.length !== items.length) {
        throw new PlayerPayoutConfirmedConflictError(
          "批次存在无法识别的项目来源，拒绝付款",
        );
      }
      const openDispute = await tx.dispute.findFirst({
        where: { tenantId, earningId: { in: legacyIds }, status: "OPEN" },
        select: { id: true },
      });
      if (openDispute) {
        throw new PlayerPayoutConfirmedConflictError(
          "批次含开放争议 earning，不能结算",
        );
      }

      // 5) 两个科目只补建缺失的（upsert，update 为空 = 不改已有科目）
      await tx.ledgerAccount.upsert({
        where: {
          tenantId_code: { tenantId, code: PLAYER_PAYABLE_ACCOUNT.code },
        },
        create: {
          tenantId,
          code: PLAYER_PAYABLE_ACCOUNT.code,
          name: PLAYER_PAYABLE_ACCOUNT.name,
        },
        update: {},
      });
      await tx.ledgerAccount.upsert({
        where: {
          tenantId_code: {
            tenantId,
            code: SETTLEMENT_FUND_ASSET_ACCOUNT.code,
          },
        },
        create: {
          tenantId,
          code: SETTLEMENT_FUND_ASSET_ACCOUNT.code,
          name: SETTLEMENT_FUND_ASSET_ACCOUNT.name,
        },
        update: {},
      });
      const accounts = await tx.ledgerAccount.findMany({
        where: {
          tenantId,
          code: {
            in: [
              PLAYER_PAYABLE_ACCOUNT.code,
              SETTLEMENT_FUND_ASSET_ACCOUNT.code,
            ],
          },
        },
        select: { id: true, code: true },
      });

      // 6) 交易与分录全部由领域口径生成（含借贷平衡守卫），仓储不自行拼装
      const posting = buildPlayerPayoutConfirmedLedgerPosting({
        batchId,
        batchNo: locked.batchNo,
        fundAccountId,
        amountFen: total,
        occurredAt: input.occurredAt,
        actorId: operatorId,
        idempotencyKey: input.idempotencyKey,
      });
      const txRow = await tx.ledgerTransaction.create({
        data: {
          tenantId,
          txNo: posting.transaction.txNo,
          description: posting.transaction.description,
          sourceType: posting.transaction.sourceType,
          sourceId: posting.transaction.sourceId,
          eventType: posting.transaction.eventType,
          status: posting.transaction.status,
          fundAccountId: posting.transaction.fundAccountId,
          createdBy: posting.transaction.createdBy,
          confirmedBy: posting.transaction.confirmedBy,
          occurredAt: posting.transaction.occurredAt,
          confirmedAt: posting.transaction.confirmedAt,
        },
      });
      for (const entry of posting.entries) {
        await tx.ledgerEntry.create({
          data: {
            tenantId,
            transactionId: txRow.id,
            accountId: accountIdOf(accounts, entry.accountCode),
            direction: entry.direction,
            amountFen: entry.amountFen,
            fundAccountId: entry.fundAccountId,
            auxiliaryType: entry.auxiliaryType,
            auxiliaryId: entry.auxiliaryId,
          },
        });
      }

      // 7) 付款记录：金额=批次合计，渠道=资金账户种类，备注只放安全组合
      //    （凭证号在这里再校验一次，仓储不假设调用方已经校验）
      const payment = await tx.manualPaymentRecord.create({
        data: {
          tenantId,
          batchId,
          amountFen: total,
          paidAt: posting.transaction.occurredAt,
          channel: fundAccount.kind,
          operatorId,
          note: buildManualPaymentNote(input.evidenceRef, input.note),
        },
      });

      // 8) 只有付款记录与两条分录都写成功之后，才动 earnings 与批次状态。
      //    每批都带「原状态必须是 BATCHED」的前置条件并核对影响行数：行数不符说明有项目
      //    状态已被并发改动，此刻整笔回滚——绝不带着「部分项目没标记」返回成功。
      if (legacyIds.length > 0) {
        const paidEarnings = await tx.earning.updateMany({
          where: { tenantId, id: { in: legacyIds }, status: "BATCHED" },
          data: { status: "PAID" },
        });
        if (paidEarnings.count !== legacyIds.length) {
          throw new PlayerPayoutConfirmedConflictError(
            "批次内 earning 状态已变化，拒绝付款",
          );
        }
      }
      if (slotIds.length > 0) {
        const paidSlots = await tx.slotEarning.updateMany({
          where: { tenantId, id: { in: slotIds }, status: "BATCHED" },
          data: { status: "PAID" },
        });
        if (paidSlots.count !== slotIds.length) {
          throw new PlayerPayoutConfirmedConflictError(
            "批次内档位收入状态已变化，拒绝付款",
          );
        }
      }
      const paidRes = await tx.settlementBatch.updateMany({
        where: { tenantId, id: batchId, status: "APPROVED" },
        data: { status: "PAID", paidBy: operatorId, totalAmountFen: total },
      });
      if (paidRes.count === 0) {
        throw new PlayerPayoutConfirmedConflictError(
          "批次状态已变化，拒绝重复付款",
        );
      }

      const result: ConfirmSettlementPaymentResult = {
        batchId,
        batchNo: locked.batchNo,
        paymentId: payment.id,
        transactionId: txRow.id,
        amountFen: total,
        status: "PAID",
        fundAccountCode: fundAccount.code,
        fundAccountName: fundAccount.name,
      };
      return result;
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

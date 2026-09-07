import type { PrismaClient } from "@pw/database";
import { splitSettlement } from "../domain/split.js";

export interface PlayerFinanceView {
  pendingFen: string;
  batchedFen: string;
  paidFen: string;
}

export interface PlayerIncomeRecord {
  id: string;
  source: "LEGACY" | "SLOT";
  amountFen: string;
  status: string;
  orderNo: string;
  createdAt: Date;
}

export interface PlayerIncomeView {
  pendingFen: string;
  settledFen: string;
  records: PlayerIncomeRecord[];
}

export class PrismaLedgerRepository {
  constructor(private readonly client: PrismaClient) {}

  async rates(
    tenantId: string,
  ): Promise<{ platformFeeBp: number; storeCutBp: number }> {
    const row = await this.client.financeRateRule.findUnique({
      where: { tenantId },
    });
    return row
      ? { platformFeeBp: row.platformFeeBp, storeCutBp: row.storeCutBp }
      : { platformFeeBp: 300, storeCutBp: 2000 };
  }

  private async ensureAccount(
    tenantId: string,
    code: string,
    name: string,
  ): Promise<void> {
    await this.client.ledgerAccount.upsert({
      where: { tenantId_code: { tenantId, code } },
      create: { tenantId, code, name },
      update: {},
    });
  }

  /** 生成 earning + 平衡账本；幂等（已有 earning 返回既有）。金额输出十进制字符串（分）。 */
  async completeAccounting(
    tenantId: string,
    orderId: string,
    actorId: string,
    actorType = "tenant_account",
  ): Promise<{ earningId: string; playerShareFen: string } | null> {
    const existing = await this.client.earning.findFirst({
      where: { tenantId, orderId },
    });
    if (existing)
      return {
        earningId: existing.id,
        playerShareFen: existing.amountFen.toString(),
      };

    return this.client.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { tenantId, id: orderId },
        select: { id: true, orderNo: true, status: true },
      });
      if (!order || order.status !== "PENDING_CONFIRMATION") return null;
      const session = await tx.serviceSession.findFirst({
        where: { tenantId, orderId },
        select: { id: true, status: true },
      });
      if (
        !session ||
        (session.status !== "ENDED" && session.status !== "CONFIRMED")
      )
        return null;
      const assignment = await tx.assignment.findFirst({
        where: { tenantId, orderId },
        select: { playerId: true },
      });
      if (!assignment) return null;
      const snapshot = await tx.orderPriceSnapshot.findMany({
        where: { tenantId, orderId },
      });
      let total = 0n;
      for (const s of snapshot) total += s.lineTotalFen;
      if (total <= 0n) return null;
      const rates = await this.rates(tenantId);
      const split = splitSettlement(total, rates);

      await this.ensureAccount(
        tenantId,
        "CUSTOMER_RECEIVABLE",
        "客户应收（门店代收）",
      );
      await this.ensureAccount(tenantId, "PLATFORM_REVENUE", "平台服务费收入");
      await this.ensureAccount(tenantId, "STORE_COMMISSION", "门店佣金收入");
      await this.ensureAccount(tenantId, "PLAYER_PAYABLE", "应付陪玩款");

      const earning = await tx.earning.create({
        data: {
          tenantId,
          orderId,
          playerId: assignment.playerId,
          amountFen: split.playerShareFen,
        },
      });
      const txRow = await tx.ledgerTransaction.create({
        data: {
          tenantId,
          txNo: `T${Date.now().toString(36).toUpperCase()}`,
          description: `订单核算 ${order.orderNo}`,
        },
      });
      const accs = await tx.ledgerAccount.findMany({
        where: {
          tenantId,
          code: {
            in: [
              "CUSTOMER_RECEIVABLE",
              "PLATFORM_REVENUE",
              "STORE_COMMISSION",
              "PLAYER_PAYABLE",
            ],
          },
        },
        select: { id: true, code: true },
      });
      const idOf = (code: string) =>
        accs.find((a) => a.code === code)?.id as string;
      const entries: Array<{
        accountId: string;
        direction: "DEBIT" | "CREDIT";
        amountFen: bigint;
      }> = [
        {
          accountId: idOf("CUSTOMER_RECEIVABLE"),
          direction: "DEBIT",
          amountFen: total,
        },
        {
          accountId: idOf("PLATFORM_REVENUE"),
          direction: "CREDIT",
          amountFen: split.platformFeeFen,
        },
        {
          accountId: idOf("STORE_COMMISSION"),
          direction: "CREDIT",
          amountFen: split.storeCutFen,
        },
        {
          accountId: idOf("PLAYER_PAYABLE"),
          direction: "CREDIT",
          amountFen: split.playerShareFen,
        },
      ];
      const debit = entries
        .filter((e) => e.direction === "DEBIT")
        .reduce((a, e) => a + e.amountFen, 0n);
      const credit = entries
        .filter((e) => e.direction === "CREDIT")
        .reduce((a, e) => a + e.amountFen, 0n);
      if (debit !== credit) throw new Error("ledger unbalanced");
      for (const e of entries) {
        await tx.ledgerEntry.create({
          data: {
            tenantId,
            transactionId: txRow.id,
            accountId: e.accountId,
            direction: e.direction,
            amountFen: e.amountFen,
          },
        });
      }
      // 场次 ENDED/CONFIRMED → CONFIRMED（核算/确认完成时定稿）
      if (session.status !== "CONFIRMED") {
        await tx.serviceSession.update({
          where: { id: session.id },
          data: { status: "CONFIRMED" },
        });
        await tx.sessionEvent.create({
          data: {
            tenantId,
            sessionId: session.id,
            eventType: "SESSION_CONFIRMED",
            fromStatus: session.status,
            toStatus: "CONFIRMED",
            actorType,
            actorId,
            payload: {},
          },
        });
      }
      await tx.order.update({
        where: { id: orderId },
        data: { status: "COMPLETED" },
      });
      await tx.orderEvent.create({
        data: {
          tenantId,
          orderId,
          eventType: "ORDER_ACCOUNTED",
          fromStatus: order.status,
          toStatus: "COMPLETED",
          actorType,
          actorId,
          payload: {
            earningId: earning.id,
            playerShareFen: split.playerShareFen.toString(),
          },
        },
      });
      await tx.outboxEvent.create({
        data: {
          tenantId,
          aggregateType: "order",
          aggregateId: orderId,
          eventType: "order.accounted",
          payload: { orderId, earningId: earning.id },
        },
      });
      return {
        earningId: earning.id,
        playerShareFen: split.playerShareFen.toString(),
      };
    });
  }

  async playerFinance(
    tenantId: string,
    playerId: string,
  ): Promise<PlayerFinanceView> {
    const rows = await this.client.earning.groupBy({
      by: ["status"],
      where: { tenantId, playerId },
      _sum: { amountFen: true },
    });
    const out: PlayerFinanceView = {
      pendingFen: "0",
      batchedFen: "0",
      paidFen: "0",
    };
    for (const r of rows) {
      const value = (r._sum.amountFen ?? 0n).toString();
      if (r.status === "PAID") out.paidFen = value;
      else if (r.status === "BATCHED") out.batchedFen = value;
      else out.pendingFen = value;
    }
    return out;
  }

  async playerIncome(
    tenantId: string,
    playerId: string,
  ): Promise<PlayerIncomeView> {
    const [legacy, slots, orders] = await Promise.all([
      this.client.earning.findMany({
        where: { tenantId, playerId },
        orderBy: { createdAt: "desc" },
      }),
      this.client.slotEarning.findMany({
        where: { tenantId, playerId },
        orderBy: { createdAt: "desc" },
      }),
      this.client.order.findMany({
        where: { tenantId },
        select: { id: true, orderNo: true },
      }),
    ]);
    const orderNoById = new Map(orders.map((o) => [o.id, o.orderNo]));
    const records: PlayerIncomeRecord[] = [
      ...legacy.map((e) => ({
        id: e.id,
        source: "LEGACY" as const,
        amountFen: e.amountFen.toString(),
        status: e.status,
        orderNo: orderNoById.get(e.orderId) ?? "未知订单",
        createdAt: e.createdAt,
      })),
      ...slots.map((e) => ({
        id: e.id,
        source: "SLOT" as const,
        amountFen: e.amountFen.toString(),
        status: e.status,
        orderNo: orderNoById.get(e.orderId) ?? "未知订单",
        createdAt: e.createdAt,
      })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    let pendingFen = 0n;
    let settledFen = 0n;
    for (const r of records) {
      if (r.status === "PAID") settledFen += BigInt(r.amountFen);
      else pendingFen += BigInt(r.amountFen);
    }
    return {
      pendingFen: pendingFen.toString(),
      settledFen: settledFen.toString(),
      records,
    };
  }
}

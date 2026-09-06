import type { PrismaClient } from "@pw/database";
import { splitSettlement } from "../domain/split.js";

export interface PlayerFinanceView {
  pendingFen: number;
  batchedFen: number;
  paidFen: number;
}

export class PrismaLedgerRepository {
  constructor(private readonly client: PrismaClient) {}

  async rates(tenantId: string): Promise<{ platformFeeBp: number; storeCutBp: number }> {
    const row = await this.client.financeRateRule.findUnique({ where: { tenantId } });
    return row ? { platformFeeBp: row.platformFeeBp, storeCutBp: row.storeCutBp } : { platformFeeBp: 300, storeCutBp: 2000 };
  }

  private async ensureAccount(tenantId: string, code: string, name: string): Promise<void> {
    await this.client.ledgerAccount.upsert({
      where: { tenantId_code: { tenantId, code } },
      create: { tenantId, code, name },
      update: {}
    });
  }

  /** 生成 earning + 平衡账本；幂等（已有 earning 返回既有）。 */
  async completeAccounting(tenantId: string, orderId: string, actorId: string): Promise<{ earningId: string; playerShareFen: number } | null> {
    const existing = await this.client.earning.findFirst({ where: { tenantId, orderId } });
    if (existing) return { earningId: existing.id, playerShareFen: Number(existing.amountFen) };

    return this.client.$transaction(async (tx) => {
      const order = await tx.order.findFirst({ where: { tenantId, id: orderId }, select: { id: true, orderNo: true, status: true } });
      if (!order) return null;
      const session = await tx.serviceSession.findFirst({ where: { tenantId, orderId }, select: { status: true } });
      if (!session || (session.status !== "ENDED" && session.status !== "CONFIRMED")) return null;
      const assignment = await tx.assignment.findFirst({ where: { tenantId, orderId }, select: { playerId: true } });
      if (!assignment) return null;
      const snapshot = await tx.orderPriceSnapshot.findMany({ where: { tenantId, orderId } });
      const total = snapshot.reduce((sum, s) => sum + Number(s.lineTotalFen), 0);
      if (total <= 0) return null;
      const rates = await this.rates(tenantId);
      const split = splitSettlement(total, rates);

      await this.ensureAccount(tenantId, "CUSTOMER_RECEIVABLE", "客户应收（门店代收）");
      await this.ensureAccount(tenantId, "PLATFORM_REVENUE", "平台服务费收入");
      await this.ensureAccount(tenantId, "STORE_COMMISSION", "门店佣金收入");
      await this.ensureAccount(tenantId, "PLAYER_PAYABLE", "应付陪玩款");

      const earning = await tx.earning.create({
        data: { tenantId, orderId, playerId: assignment.playerId, amountFen: BigInt(split.playerShareFen) }
      });
      const txRow = await tx.ledgerTransaction.create({
        data: { tenantId, txNo: `T${Date.now().toString(36).toUpperCase()}`, description: `订单核算 ${order.orderNo}` }
      });
      const accs = await tx.ledgerAccount.findMany({
        where: { tenantId, code: { in: ["CUSTOMER_RECEIVABLE", "PLATFORM_REVENUE", "STORE_COMMISSION", "PLAYER_PAYABLE"] } },
        select: { id: true, code: true }
      });
      const idOf = (code: string) => accs.find((a) => a.code === code)?.id as string;
      const entries: Array<{ accountId: string; direction: string; amountFen: bigint }> = [
        { accountId: idOf("CUSTOMER_RECEIVABLE"), direction: "DEBIT", amountFen: BigInt(total) },
        { accountId: idOf("PLATFORM_REVENUE"), direction: "CREDIT", amountFen: BigInt(split.platformFeeFen) },
        { accountId: idOf("STORE_COMMISSION"), direction: "CREDIT", amountFen: BigInt(split.storeCutFen) },
        { accountId: idOf("PLAYER_PAYABLE"), direction: "CREDIT", amountFen: BigInt(split.playerShareFen) }
      ];
      const debit = entries.filter((e) => e.direction === "DEBIT").reduce((a, e) => a + e.amountFen, 0n);
      const credit = entries.filter((e) => e.direction === "CREDIT").reduce((a, e) => a + e.amountFen, 0n);
      if (debit !== credit) throw new Error("ledger unbalanced");
      for (const e of entries) {
        await tx.ledgerEntry.create({ data: { tenantId, transactionId: txRow.id, accountId: e.accountId, direction: e.direction as never, amountFen: e.amountFen } });
      }
      await tx.order.update({ where: { id: orderId }, data: { status: "COMPLETED" } });
      await tx.orderEvent.create({
        data: { tenantId, orderId, eventType: "ORDER_ACCOUNTED", fromStatus: "ASSIGNED", toStatus: "COMPLETED", actorType: "tenant_account", actorId, payload: { earningId: earning.id, playerShareFen: split.playerShareFen } }
      });
      await tx.outboxEvent.create({
        data: { tenantId, aggregateType: "order", aggregateId: orderId, eventType: "order.accounted", payload: { orderId, earningId: earning.id } }
      });
      return { earningId: earning.id, playerShareFen: split.playerShareFen };
    });
  }

  async playerFinance(tenantId: string, playerId: string): Promise<PlayerFinanceView> {
    const rows = await this.client.earning.groupBy({
      by: ["status"],
      where: { tenantId, playerId },
      _sum: { amountFen: true }
    });
    const out: PlayerFinanceView = { pendingFen: 0, batchedFen: 0, paidFen: 0 };
    for (const r of rows) {
      const v = Number(r._sum.amountFen ?? 0);
      if (r.status === "PAID") out.paidFen = v;
      else if (r.status === "BATCHED") out.batchedFen = v;
      else out.pendingFen = v;
    }
    return out;
  }
}
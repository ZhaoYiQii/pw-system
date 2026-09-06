import {
  PrismaLedgerRepository,
  PlayerFinanceView,
} from "../infrastructure/prisma-ledger.repository.js";

export class LedgerService {
  constructor(private readonly repo: PrismaLedgerRepository) {}

  async completeAccounting(
    tenantId: string,
    orderId: string,
    actorId: string,
    actorType = "tenant_account",
  ) {
    const result = await this.repo.completeAccounting(
      tenantId,
      orderId,
      actorId,
      actorType,
    );
    if (!result) throw new Error("订单不可核算（需已指派且场次已结束）");
    return result;
  }

  playerFinance(
    tenantId: string,
    playerId: string,
  ): Promise<PlayerFinanceView> {
    return this.repo.playerFinance(tenantId, playerId);
  }
}

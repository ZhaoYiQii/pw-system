import { LedgerRulesRepository, RuleRow } from "../infrastructure/prisma-ledger-rules.repository.js";
import { splitSettlement, SplitResult } from "../domain/split.js";

export class LedgerRulesService {
  constructor(private readonly repo: LedgerRulesRepository) {}

  effective(tenantId: string): Promise<RuleRow> {
    return this.repo.get(tenantId);
  }

  async setStoreCut(tenantId: string, storeCutBp: unknown): Promise<RuleRow> {
    const cur = await this.repo.get(tenantId);
    const bp = this.parseBp(storeCutBp, "storeCutBp");
    if (cur.platformFeeBp + bp > 10000) throw new Error("platformFeeBp+storeCutBp 不得超过 10000");
    return this.repo.setStoreCut(tenantId, bp);
  }

  async setPlatformFee(tenantId: string, platformFeeBp: unknown): Promise<RuleRow> {
    const cur = await this.repo.get(tenantId);
    const bp = this.parseBp(platformFeeBp, "platformFeeBp");
    if (bp + cur.storeCutBp > 10000) throw new Error("platformFeeBp+storeCutBp 不得超过 10000");
    return this.repo.setPlatformFee(tenantId, bp);
  }

  async preview(tenantId: string, amountFen: unknown): Promise<SplitResult> {
    const amount = Number(amountFen);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("amountFen 必须为正整数（分）");
    const rules = await this.repo.get(tenantId);
    return splitSettlement(amount, rules);
  }

  private parseBp(value: unknown, label: string): number {
    const bp = Number(value);
    if (!Number.isInteger(bp) || bp < 0 || bp > 10000) throw new Error(`${label} 需为 0-10000 的整数（基点）`);
    return bp;
  }
}
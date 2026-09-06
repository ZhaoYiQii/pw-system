import type { PrismaClient } from "@pw/database";

export interface RuleRow { platformFeeBp: number; storeCutBp: number }

const DEFAULTS: RuleRow = { platformFeeBp: 300, storeCutBp: 2000 };

export class LedgerRulesRepository {
  constructor(private readonly client: PrismaClient) {}

  async get(tenantId: string): Promise<RuleRow> {
    const row = await this.client.financeRateRule.findUnique({ where: { tenantId } });
    return row ? { platformFeeBp: row.platformFeeBp, storeCutBp: row.storeCutBp } : DEFAULTS;
  }

  async setStoreCut(tenantId: string, storeCutBp: number): Promise<RuleRow> {
    const cur = await this.get(tenantId);
    await this.client.financeRateRule.upsert({
      where: { tenantId },
      create: { tenantId, platformFeeBp: cur.platformFeeBp, storeCutBp },
      update: { storeCutBp }
    });
    return this.get(tenantId);
  }

  async setPlatformFee(tenantId: string, platformFeeBp: number): Promise<RuleRow> {
    const cur = await this.get(tenantId);
    await this.client.financeRateRule.upsert({
      where: { tenantId },
      create: { tenantId, platformFeeBp, storeCutBp: cur.storeCutBp },
      update: { platformFeeBp }
    });
    return this.get(tenantId);
  }
}
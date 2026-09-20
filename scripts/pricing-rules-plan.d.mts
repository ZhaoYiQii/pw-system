/**
 * scripts/lib/pricing-rules-plan.mjs 的类型声明（脚本本身保持 .mjs，供 CLI 直接运行）。
 */

export interface PricingRulePlanItem {
  dimensionKey: string;
  amountFen: string;
  sources: string[];
}

export interface PricingRulePlanConflict {
  tenantId?: string;
  gameId?: string;
  dimensionKey: string;
  amounts: string[];
  sources: string[];
}

export interface PricingRulePlanGame {
  tenantId: string;
  gameId: string;
  items: PricingRulePlanItem[];
  conflicts: PricingRulePlanConflict[];
}

export interface PricingRulePlan {
  games: PricingRulePlanGame[];
  conflicts: PricingRulePlanConflict[];
  skipped: {
    unclassifiedTemplates: number;
    unclassifiedRankRules: number;
    unclassifiedOptionPrices: number;
  };
}

export interface PricingMigrationTemplate {
  id: string;
  tenantId: string;
  gameId: string | null;
  name: string;
  archivedAt: Date | null;
  activeVersionId: string | null;
  draftConfigJson: unknown;
}

export interface PricingMigrationInput {
  templates?: PricingMigrationTemplate[];
  versions?: { id: string; configJson: unknown }[];
  rankRules?: {
    tenantId: string;
    templateId: string;
    rankLabel: string;
    addPriceFen: string | number | bigint;
  }[];
}

export interface PricingMigrationResult {
  writtenGames: number;
  writtenItems: number;
  skippedGames: number;
}

export function optionSurcharges(config: unknown): {
  stableKey: string;
  optionValue: string;
  priceDeltaFen: string;
}[];

export function buildPricingRulePlan(
  input?: PricingMigrationInput,
): PricingRulePlan;

export function applyPricingRulePlan(
  client: unknown,
  plan: PricingRulePlan,
): Promise<PricingMigrationResult>;

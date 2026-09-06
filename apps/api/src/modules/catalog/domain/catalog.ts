export interface GameView {
  id: string;
  tenantId: string;
  name: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RegionView {
  id: string;
  tenantId: string;
  gameId: string;
  name: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductView {
  id: string;
  tenantId: string;
  gameId: string;
  gameRegionId: string | null;
  name: string;
  description: string | null;
  enabled: boolean;
  gameName: string;
  regionName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** MoneyFen：金额（分）——bigint 列对外映射为 number（安全整数范围内）。 */
export interface PricingRuleView {
  id: string;
  tenantId: string;
  serviceProductId: string;
  durationSeconds: number;
  priceFen: number;
  playerCostFen: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}
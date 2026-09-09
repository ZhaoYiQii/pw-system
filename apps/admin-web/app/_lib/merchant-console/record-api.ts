/**
 * 记录台模块的真实后端契约（字段来自已核对接口返回，与 OpenAPI/旧页一致）。
 */

export interface CustomerRow {
  id: string;
  name: string;
  mobile: string | null;
  remark: string | null;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
}

export interface CustomerWalletEntry {
  id: string;
  txNo: string;
  type: string;
  amountFen: string;
  balanceAfterFen: string;
  reason: string | null;
  createdAt: string;
}

export interface CustomerAccount {
  customerId: string;
  wallet: {
    bossNo: string;
    balanceFen: string;
    entries: CustomerWalletEntry[];
  } | null;
}

export interface CustomerOrderHistory {
  orderId: string;
  orderNo: string;
  dispatchNo: string | null;
  processType: "CLASSIC" | "GAME_DISPATCH";
  status: string;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlayerRow {
  id: string;
  name: string;
  mobile: string | null;
  status: "ACTIVE" | "INACTIVE";
  acceptingOrders: boolean;
  basePricePerHourFen: string;
}

export interface PlayerSkill {
  id: string;
  gameName: string;
  title: string | null;
}

export interface PlayerAvailability {
  id: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
}

export interface PlayerDetail extends PlayerRow {
  skills: PlayerSkill[];
  availability: PlayerAvailability[];
}

export interface PlayerEarningRecord {
  id: string;
  source: "LEGACY" | "SLOT";
  amountFen: string;
  status: string;
  orderId: string;
  orderNo: string;
  createdAt: string;
}

export interface PlayerAccount {
  id: string;
  name: string;
  finance: {
    paidFen: string;
    unpaidFen: string;
    records: PlayerEarningRecord[];
  };
}

export interface GameRow {
  id: string;
  name: string;
  enabled: boolean;
}

export interface RegionRow {
  id: string;
  name: string;
  enabled: boolean;
}

export interface ProductRow {
  id: string;
  gameId: string;
  gameRegionId: string | null;
  name: string;
  description: string | null;
  enabled: boolean;
  regionName: string | null;
}

export interface PricingRule {
  id: string;
  serviceProductId: string;
  durationSeconds: number;
  priceFen: string;
  playerCostFen: string;
  enabled: boolean;
}

export interface SessionRow {
  id: string;
  flow: "CLASSIC" | "GAME_DISPATCH";
  slotId: string | null;
  orderId: string;
  orderNo: string;
  playerId: string;
  playerName: string;
  customerName: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  evidenceCount: number;
  adjustmentPendingCount: number;
  createdAt: string;
}

export interface SessionEvent {
  id: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  occurredAt: string;
}

export interface SessionEvidence {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string | null;
  createdAt: string;
}

export interface SessionAdjustment {
  id: string;
  originalDurationSeconds: number;
  requestedDurationSeconds: number;
  reason: string;
  status: string;
}

export interface SessionDetail {
  id: string;
  flow: "CLASSIC" | "GAME_DISPATCH";
  slotId: string | null;
  orderId: string;
  playerId: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  events: SessionEvent[];
  evidence: SessionEvidence[];
  adjustments: SessionAdjustment[];
}

export interface BatchRow {
  id: string;
  batchNo: string;
  status: "DRAFT" | "REVIEWED" | "APPROVED" | "PAID" | "VOID";
  totalAmountFen: string;
  itemCount: number;
  createdBy: string | null;
  createdAt: string;
}

export interface PendingEarning {
  id: string;
  source: "LEGACY" | "SLOT";
  playerId: string;
  amountFen: string;
  playerName: string;
  orderNo: string;
  createdAt: string;
}

export interface BatchDetailItem {
  itemId: string;
  source: "LEGACY" | "SLOT";
  earningId: string | null;
  slotEarningId: string | null;
  amountFen: string;
  playerName: string;
  orderNo: string;
  createdAt: string;
}

export interface BatchDetail {
  id: string;
  batchNo: string;
  status: BatchRow["status"];
  totalAmountFen: string;
  itemCount: number;
  items: BatchDetailItem[];
  createdByName: string | null;
  reviewedByName: string | null;
  approvedByName: string | null;
  paidByName: string | null;
  paidAt: string | null;
}

export interface DisputeRow {
  id: string;
  orderId: string;
  orderNo: string;
  playerId: string;
  playerName: string;
  customerProfileId: string;
  customerName: string;
  reason: string;
  status: "OPEN" | "RESOLVED";
  resolution: string | null;
  createdAt: string;
}

export interface DisputeEarningInfo {
  id: string;
  amountFen: string;
  status: string;
  settlementBatchStatus: string | null;
  settlementBatchNo: string | null;
}

export interface DisputeEvent {
  id: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorType: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface DisputeDetail {
  id: string;
  orderId: string;
  orderNo: string;
  playerId: string;
  playerName: string;
  customerProfileId: string;
  customerName: string;
  earningId: string | null;
  earning: DisputeEarningInfo | null;
  reason: string;
  status: "OPEN" | "RESOLVED";
  openedBy: string | null;
  resolvedBy: string | null;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
  events: DisputeEvent[];
}

export interface AuditRow {
  id: string;
  actorType: string | null;
  actorId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  summary: string | null;
  createdAt: string;
}

export interface FinanceRules {
  platformFeeBp: number;
  storeCutBp: number;
}

export interface FinanceSplit {
  platformFeeFen: string;
  storeCutFen: string;
  playerShareFen: string;
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
  createdAt: string;
}

export interface FinanceLedger {
  paidFen: string;
  unpaidFen: string;
  rows: FinanceLedgerRow[];
}

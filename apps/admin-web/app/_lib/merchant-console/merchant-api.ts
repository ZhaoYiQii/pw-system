/** 商家端真实接口的类型与状态映射。金额一律以“分”字符串传输。 */

export type MerchantStatusTone =
  | "muted"
  | "dispatch"
  | "assigned"
  | "running"
  | "pending"
  | "done"
  | "cancelled";

export const STATUS_TEXT: Record<string, string> = {
  // 订单 / 派单
  DRAFT: "待发布",
  CONFIRMED: "已确认",
  DISPATCHING: "报名选人",
  ASSIGNED: "已选定",
  READY: "待开始",
  IN_PROGRESS: "服务中",
  PENDING_CONFIRMATION: "待核算",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
  // 场次
  SCHEDULED: "待开始",
  NOT_STARTED: "待开始",
  STARTED: "进行中",
  ENDED: "已结束",
  ADJUSTMENT_PENDING: "调整待复核",
  CONFIRMED_SESSION: "已确认",
  // 结算批次
  REVIEWED: "已复核",
  APPROVED: "已批准",
  PAID: "已支付",
  VOID: "已作废",
  // 争议
  OPEN: "待处理",
  RESOLVED: "已处理",
  // 账号
  ACTIVE: "正常",
  INACTIVE: "停用",
  DISABLED: "停用",
  // 通知
  READ: "已读",
};

export function toneFor(status: string): MerchantStatusTone {
  if (["DRAFT", "PENDING_CONFIRMATION", "ADJUSTMENT_PENDING"].includes(status))
    return "pending";
  if (status === "CONFIRMED") return "pending";
  if (status === "DISPATCHING" || status === "OPEN") return "dispatch";
  if (["ASSIGNED", "READY", "REVIEWED"].includes(status)) return "assigned";
  if (["IN_PROGRESS", "STARTED", "SCHEDULED", "NOT_STARTED"].includes(status))
    return "running";
  if (
    ["COMPLETED", "PAID", "RESOLVED", "APPROVED", "ACTIVE", "CONFIRMED_SESSION"].includes(
      status,
    )
  )
    return "done";
  if (["CANCELLED", "VOID", "INACTIVE", "DISABLED"].includes(status))
    return "cancelled";
  return "muted";
}

export function statusLabel(status: string): string {
  return STATUS_TEXT[status] ?? status;
}

// ---------------- 账号 / 会话 ----------------
export interface TenantMe {
  sub: string;
  username: string;
  role: string;
  tenantId?: string;
  scope?: string;
}

// ---------------- 订单 ----------------
export interface CustomerRow {
  id: string;
  name: string;
  mobile: string | null;
  remark: string | null;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
}

export interface GameProduct {
  id: string;
  name: string;
  enabled: boolean;
  gameName: string;
  regionName: string | null;
}

export interface OrderRow {
  id: string;
  orderNo: string;
  status: string;
  customerName: string;
  createdAt: string;
}

export interface DispatchRow {
  orderId: string;
  dispatchNo: string;
  status: string;
  durationMinutes: number;
  createdAt: string;
}

export interface OrderView {
  id: string;
  orderNo: string;
  status: string;
  customerName: string;
  createdAt: string;
  requirement: {
    description: string;
    gameName: string | null;
    productName: string | null;
    desiredStartAt: string | null;
    durationSeconds: number | null;
    note: string | null;
  } | null;
  snapshot: Array<{
    productName: string;
    unitPriceFen: string;
    lineTotalFen: string;
    durationSeconds: number;
  }> | null;
  timeline: Array<{
    eventType: string;
    fromStatus: string | null;
    toStatus: string | null;
    occurredAt: string;
  }>;
}

export interface ApplicationView {
  id: string;
  orderId: string;
  playerId: string;
  playerName: string;
  status: string;
  playerNote: string | null;
  createdAt: string;
}

export interface SessionOfOrder {
  id: string;
  orderId: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  adjustments: Array<{
    id: string;
    originalDurationSeconds: number;
    requestedDurationSeconds: number;
    status: string;
    reason: string;
  }>;
}

// ---------------- GD 派单 ----------------
export interface TemplateRow {
  id: string;
  name: string;
  enabled: boolean;
}

export interface TemplateField {
  fieldKey: string;
  label: string;
  fieldType:
    | "text"
    | "select"
    | "multiline"
    | "datetime"
    | "duration"
    | "note";
  required: boolean;
  options: string[];
}

export interface TemplateDetail extends TemplateRow {
  fields: TemplateField[];
  positions: Array<{ id: string; label: string; defaultCount: number }>;
  copy?: string;
  ranks?: Array<{ id: string; label: string; gameId?: string }>;
  draft?: boolean;
}

export interface DispatchApplication {
  id: string;
  playerName: string;
  status: string;
  createdAt: string;
}

export interface DispatchLine {
  id: string;
  positionLabel: string;
  requiredCount: number;
  applications: DispatchApplication[];
}

export interface DispatchDetail {
  dispatchNo: string;
  status: string;
  copyText: string;
  applyUrl: string;
  bossUrl: string;
  lines: DispatchLine[];
  round: { roundNo: number; closesAt: string; status: string } | null;
}

// ---------------- 客户 / 陪玩 / 场次 / 财务 ----------------
export interface CustomerAccount {
  customerId: string;
  wallet: {
    bossNo: string;
    balanceFen: string;
    entries: Array<{
      id: string;
      txNo: string;
      type: string;
      amountFen: string;
      balanceAfterFen: string;
      reason: string | null;
      createdAt: string;
    }>;
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

export interface PlayerDetail extends PlayerRow {
  skills: Array<{ id: string; gameName: string; title: string | null }>;
  availability: Array<{
    id: string;
    startsAt: string;
    endsAt: string;
    reason: string | null;
  }>;
}

export interface PlayerAccount {
  id: string;
  name: string;
  finance: {
    paidFen: string;
    unpaidFen: string;
    records: Array<{
      id: string;
      source: "LEGACY" | "SLOT";
      amountFen: string;
      status: string;
      orderId: string;
      orderNo: string;
      createdAt: string;
    }>;
  };
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

export interface SessionEvidence {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string | null;
  createdAt: string;
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
  events: Array<{
    id: string;
    eventType: string;
    fromStatus: string | null;
    toStatus: string | null;
    occurredAt: string;
  }>;
  evidence: SessionEvidence[];
  adjustments: Array<{
    id: string;
    originalDurationSeconds: number;
    requestedDurationSeconds: number;
    reason: string;
    status: string;
  }>;
}

export interface SettlementBatchRow {
  id: string;
  batchNo: string;
  status: "DRAFT" | "REVIEWED" | "APPROVED" | "PAID" | "VOID";
  totalAmountFen: string;
  itemCount: number;
  createdBy: string | null;
  createdAt: string;
}

export interface SettlementBatchDetail {
  id: string;
  batchNo: string;
  status: SettlementBatchRow["status"];
  totalAmountFen: string;
  itemCount: number;
  items: Array<{
    itemId: string;
    source: "LEGACY" | "SLOT";
    earningId: string | null;
    slotEarningId: string | null;
    amountFen: string;
    playerName: string;
    orderNo: string;
    createdAt: string;
  }>;
  createdByName: string | null;
  reviewedByName: string | null;
  approvedByName: string | null;
  paidByName: string | null;
  paidAt: string | null;
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

export interface FinanceLedger {
  paidFen: string;
  unpaidFen: string;
  rows: Array<{
    id: string;
    source: "LEGACY" | "SLOT";
    amountFen: string;
    status: string;
    playerId: string;
    playerName: string;
    orderNo: string;
    batchNo: string | null;
    createdAt: string;
  }>;
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

export interface DisputeDetail extends DisputeRow {
  earningId: string | null;
  earning: {
    id: string;
    amountFen: string;
    status: string;
    settlementBatchStatus: string | null;
    settlementBatchNo: string | null;
  } | null;
  openedBy: string | null;
  resolvedBy: string | null;
  updatedAt: string;
  events: Array<{
    id: string;
    eventType: string;
    fromStatus: string | null;
    toStatus: string | null;
    actorType: string | null;
    payload: Record<string, unknown>;
    occurredAt: string;
  }>;
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

export interface NotificationRow {
  id: string;
  title: string | null;
  content: string;
  readAt: string | null;
  createdAt: string;
}

export interface CatalogGame {
  id: string;
  name: string;
  enabled: boolean;
}

export interface CatalogRegion {
  id: string;
  name: string;
  enabled: boolean;
}

export interface CatalogProduct {
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

export interface FeatureState {
  featureKey: string;
  core: boolean;
  enabled: boolean;
}

export interface SubscriptionView {
  id: string;
  packageCode: string;
  status: string;
  startsAt: string;
  endsAt: string | null;
}

export interface EffectiveConfig {
  status: "ACTIVE" | "CONFIG_ERROR";
  version: number;
  config: TenantConfigV1 | null;
  hasSaved: boolean;
}

export interface TenantConfigV1 {
  schemaVersion: "v1";
  brand: {
    primaryColor: string;
    accentColor: string;
    logoText: string;
    borderRadius: number;
  };
  storefront: {
    allowCustomerSelection: boolean;
    showServiceDuration: boolean;
  };
}

export interface ConfigVersionRow {
  id: string;
  version: number;
  status: string;
  createdAt: string;
}

export interface TenantAccount {
  id: string;
  username: string;
  status: "ACTIVE" | "DISABLED";
  roles: string[];
  createdAt: string;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || Number.isNaN(seconds)) return "-";
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  return `${m} 分 ${total % 60} 秒`;
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString("zh-CN", { hour12: false });
}

export const DASHBOARD_STAFF_ROLES = [
  "TENANT_OWNER",
  "TENANT_ADMIN",
  "CUSTOMER_SERVICE",
  "FINANCE",
] as const;

export type DashboardStaffRole = (typeof DASHBOARD_STAFF_ROLES)[number];

export type AttentionKind =
  | "ORDER_TODO"
  | "SESSION_TODO"
  | "SETTLEMENT_TODO"
  | "DISPUTE_TODO";

export type RiskKind = "ADJUSTMENT_TODO" | "SETTLEMENT_TODO" | "DISPUTE_TODO";

export type Priority = "HIGH" | "MEDIUM" | "LOW";

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  refType: string;
  refId: string;
  refNo: string;
  flow?: "CLASSIC" | "GAME_DISPATCH";
  title: string;
  subtitle: string | null;
  priority: Priority;
  action: string;
  occurredAt: string;
}

export interface RiskFeedItem {
  id: string;
  kind: RiskKind;
  refType: string;
  refId: string;
  refNo: string;
  title: string;
  amountFen?: string;
  priority: Priority;
  occurredAt: string;
}

export interface DashboardMetrics {
  todoOrders: number;
  liveSessions: number;
  financeTodos?: number;
  openDisputes: number;
  riskAlerts: number;
  todayServiceCount: number;
  pendingSettlementCount?: number;
  pendingSettlementAmountFen?: string;
}

export interface DashboardSummary {
  day: { date: string; tz: string };
  metrics: DashboardMetrics;
  attention: AttentionItem[];
  riskFeed: RiskFeedItem[];
}

const FINANCE_ATTENTION_KINDS = new Set<AttentionKind>(["SETTLEMENT_TODO"]);

export function canViewFinance(role: DashboardStaffRole): boolean {
  return role !== "CUSTOMER_SERVICE";
}

export function applyRoleMask(
  role: DashboardStaffRole,
  summary: DashboardSummary,
): DashboardSummary {
  if (canViewFinance(role)) return summary;

  const {
    financeTodos,
    pendingSettlementCount,
    pendingSettlementAmountFen,
    ...rest
  } = summary.metrics;
  void financeTodos;
  void pendingSettlementCount;
  void pendingSettlementAmountFen;

  const attention = summary.attention.filter(
    (item) => !FINANCE_ATTENTION_KINDS.has(item.kind),
  );
  const riskFeed = summary.riskFeed.filter(
    (item) => item.kind !== "SETTLEMENT_TODO",
  );
  return {
    day: summary.day,
    metrics: {
      ...rest,
      riskAlerts:
        summary.metrics.riskAlerts - (financeTodos ?? 0),
    },
    attention,
    riskFeed,
  };
}

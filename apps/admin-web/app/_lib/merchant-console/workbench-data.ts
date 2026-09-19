import { formatFenYuan } from "../money";
import type { MerchantRole } from "./modules";

export type DashboardAttentionKind =
  "ORDER_TODO" | "SESSION_TODO" | "SETTLEMENT_TODO" | "DISPUTE_TODO";

export type DashboardRiskKind =
  "ADJUSTMENT_TODO" | "SETTLEMENT_TODO" | "DISPUTE_TODO";

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

export interface DashboardAttentionItem {
  id: string;
  kind: DashboardAttentionKind;
  refType: string;
  refId: string;
  refNo: string;
  flow?: "CLASSIC" | "GAME_DISPATCH";
  title: string;
  subtitle: string | null;
  priority: "HIGH" | "MEDIUM" | "LOW";
  action: string;
  occurredAt: string;
}

export interface DashboardRiskItem {
  id: string;
  kind: DashboardRiskKind;
  refType: string;
  refId: string;
  refNo: string;
  title: string;
  amountFen?: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  occurredAt: string;
}

export interface DashboardSummaryData {
  day: { date: string; tz: string };
  metrics: DashboardMetrics;
  attention: DashboardAttentionItem[];
  riskFeed: DashboardRiskItem[];
}

export interface DashboardTile {
  id: "todo" | "live" | "finance" | "disputes";
  label: string;
  value: number;
  href: string;
}

export interface FinanceCard {
  id: "settlement" | "receivable-placeholder";
  label: string;
  value: string;
  href: string | null;
}

export function canSeeFinance(role: MerchantRole): boolean {
  return role !== "CS";
}

export function dashboardTiles(
  role: MerchantRole,
  metrics: DashboardMetrics,
): DashboardTile[] {
  const tiles: DashboardTile[] = [
    {
      id: "todo",
      label: "待办订单",
      value: metrics.todoOrders,
      href: "/merchant-console/dispatch",
    },
    {
      id: "live",
      label: "进行中场次",
      value: metrics.liveSessions,
      href: "/merchant-console/live",
    },
    {
      id: "disputes",
      label: "争议/异常",
      value: metrics.openDisputes,
      href: "/merchant-console/disputes",
    },
  ];
  if (role === "FINANCE") {
    return tiles.filter((tile) => tile.id !== "live");
  }
  return tiles;
}

export function financeCards(
  role: MerchantRole,
  metrics: DashboardMetrics,
): FinanceCard[] {
  if (!canSeeFinance(role)) return [];
  const amount =
    metrics.pendingSettlementAmountFen === undefined
      ? "—"
      : formatFenYuan(metrics.pendingSettlementAmountFen);
  return [
    {
      id: "settlement",
      label: "结算待办（陪玩应付）",
      value: `${amount} · ${metrics.pendingSettlementCount ?? 0} 笔`,
      href: "/merchant-console/settlements",
    },
    {
      id: "receivable-placeholder",
      label: "经营入账（应收/实收/毛利）",
      value: "待开通",
      href: null,
    },
  ];
}

export function attentionHref(item: DashboardAttentionItem): string {
  const id = encodeURIComponent(item.refId);
  switch (item.kind) {
    case "ORDER_TODO":
      return `/merchant-console/dispatch/${id}?kind=${
        item.flow === "GAME_DISPATCH" ? "GD" : "CLASSIC"
      }`;
    case "SESSION_TODO":
      return `/merchant-console/sessions/${id}`;
    case "SETTLEMENT_TODO":
      return `/merchant-console/settlements/${id}`;
    case "DISPUTE_TODO":
      return `/merchant-console/disputes/${id}`;
  }
}

export function riskHref(item: DashboardRiskItem): string {
  const id = encodeURIComponent(item.refId);
  switch (item.kind) {
    case "ADJUSTMENT_TODO":
      return `/merchant-console/sessions/${id}`;
    case "SETTLEMENT_TODO":
      return `/merchant-console/settlements/${id}`;
    case "DISPUTE_TODO":
      return `/merchant-console/disputes/${id}`;
  }
}

export function actionLabel(action: string): string {
  switch (action) {
    case "GO_PUBLISH":
      return "去发布";
    case "GO_SELECT":
      return "去选人";
    case "GO_SETTLE":
      return "去核算";
    case "GO_REVIEW":
      return "去复核";
    case "GO_DISPUTE":
      return "去处理";
    default:
      return "去处理";
  }
}

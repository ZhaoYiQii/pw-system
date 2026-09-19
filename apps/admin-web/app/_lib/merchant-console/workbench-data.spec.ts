import { describe, expect, it } from "vitest";
import {
  actionLabel,
  attentionHref,
  canSeeFinance,
  dashboardTiles,
  financeCards,
  type DashboardAttentionItem,
  type DashboardMetrics,
  type DashboardRiskItem,
  riskHref,
} from "./workbench-data";

const METRICS: DashboardMetrics = {
  todoOrders: 5,
  liveSessions: 3,
  financeTodos: 4,
  openDisputes: 2,
  riskAlerts: 10,
  todayServiceCount: 23,
  pendingSettlementCount: 4,
  pendingSettlementAmountFen: "210000",
};

function attention(
  kind: DashboardAttentionItem["kind"],
  refId: string,
  flow?: "CLASSIC" | "GAME_DISPATCH",
): DashboardAttentionItem {
  const item: DashboardAttentionItem = {
    id: `item-${refId}`,
    kind,
    refType: "ref",
    refId,
    refNo: `NO-${refId}`,
    title: "标题",
    subtitle: null,
    priority: "HIGH",
    action: "GO_SELECT",
    occurredAt: "2026-09-10T02:00:00.000Z",
  };
  if (flow) item.flow = flow;
  return item;
}

describe("经营工作台展示数据", () => {
  it("CS 无财务权限，其余角色有", () => {
    expect(canSeeFinance("OWNER")).toBe(true);
    expect(canSeeFinance("ADMIN")).toBe(true);
    expect(canSeeFinance("FINANCE")).toBe(true);
    expect(canSeeFinance("CS")).toBe(false);
  });

  it("指标带按角色过滤进行中场次", () => {
    const cs = dashboardTiles("CS", METRICS);
    expect(cs.find((tile) => tile.id === "live")).toBeDefined();
    const finance = dashboardTiles("FINANCE", METRICS);
    expect(finance.find((tile) => tile.id === "live")).toBeUndefined();
    expect(finance.find((tile) => tile.id === "todo")).toBeDefined();
  });

  it("财务卡片展示结算待办与经营入账占位；CS 为空", () => {
    expect(financeCards("CS", METRICS)).toHaveLength(0);
    const cards = financeCards("OWNER", METRICS);
    expect(cards[0]).toMatchObject({
      id: "settlement",
      value: "¥2100.00 · 4 笔",
      href: "/merchant-console/settlements",
    });
    expect(cards[1]).toMatchObject({
      id: "receivable-placeholder",
      value: "待开通",
      href: null,
    });
  });

  it("待办深链按类型生成，客服动作文案可读", () => {
    expect(attentionHref(attention("ORDER_TODO", "o1", "GAME_DISPATCH"))).toBe(
      "/merchant-console/dispatch/o1?kind=GD",
    );
    expect(attentionHref(attention("SESSION_TODO", "s1"))).toBe(
      "/merchant-console/sessions/s1",
    );
    expect(attentionHref(attention("SETTLEMENT_TODO", "b1"))).toBe(
      "/merchant-console/settlements/b1",
    );
    expect(attentionHref(attention("DISPUTE_TODO", "d1"))).toBe(
      "/merchant-console/disputes/d1",
    );
    expect(actionLabel("GO_SETTLE")).toBe("去核算");
    expect(actionLabel("UNKNOWN")).toBe("去处理");
  });

  it("风险流深链：调整去场次，结算与争议去对应详情", () => {
    const risk = (kind: DashboardRiskItem["kind"], refId: string) =>
      ({
        id: `r-${refId}`,
        kind,
        refType: "ref",
        refId,
        refNo: `NO-${refId}`,
        title: "风险",
        priority: "HIGH",
        occurredAt: "2026-09-10T02:00:00.000Z",
      }) satisfies DashboardRiskItem;
    expect(riskHref(risk("ADJUSTMENT_TODO", "s1"))).toBe(
      "/merchant-console/sessions/s1",
    );
    expect(riskHref(risk("SETTLEMENT_TODO", "b1"))).toBe(
      "/merchant-console/settlements/b1",
    );
    expect(riskHref(risk("DISPUTE_TODO", "d1"))).toBe(
      "/merchant-console/disputes/d1",
    );
  });
});

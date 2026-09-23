import { describe, expect, it } from "vitest";
import {
  canAccessModule,
  getModuleDomain,
  getVisibleNavDomains,
  MERCHANT_NAV_DOMAINS,
  getVisibleNavGroups,
  MERCHANT_MODULES,
  MERCHANT_ROLES,
} from "./modules";

describe("merchant navigation and UI permission mock", () => {
  it("keeps 24 registered modules across four roles", () => {
    // P3 / D3 新增「陪玩违约」台账模块；订单中心列表 Slice 2 新增「审核台」模块；
    // S4-8 新增支付三页（支付台账 / 对账差异 / 支付设置），挂在商家端侧栏。
    expect(MERCHANT_MODULES).toHaveLength(24);
    expect(MERCHANT_ROLES).toEqual(["OWNER", "ADMIN", "CS", "FINANCE"]);
  });

  it("keeps role-visible module counts aligned with the approved demo matrix", () => {
    const counts = Object.fromEntries(
      MERCHANT_ROLES.map((role) => [
        role,
        getVisibleNavGroups(role).flatMap((group) => group.items).length,
      ]),
    );
    // S4-8：支付台账 / 对账差异 给老板 + 财务（读账是财务日常）；支付设置只给老板
    // （绑定子商户号与刷新状态在后端要求 tenant.manage，仅老板持有）。
    expect(counts).toEqual({
      OWNER: 24,
      ADMIN: 19,
      CS: 11,
      FINANCE: 14,
    });
  });

  it("S4-8：支付三页挂进商家端（财务结算 / 运营设置）且角色口径与后端一致", () => {
    expect(getModuleDomain("payments-ledger")?.label).toBe("财务结算");
    expect(getModuleDomain("payments-reconciliation")?.label).toBe("财务结算");
    expect(getModuleDomain("payments-settings")?.label).toBe("运营设置");

    expect(canAccessModule("OWNER", "payments-ledger")).toBe(true);
    expect(canAccessModule("OWNER", "payments-settings")).toBe(true);
    expect(canAccessModule("FINANCE", "payments-ledger")).toBe(true);
    expect(canAccessModule("FINANCE", "payments-reconciliation")).toBe(true);
    // 绑定子商户号/刷新状态是 tenant.manage（仅老板）：财务不该看到这个入口
    expect(canAccessModule("FINANCE", "payments-settings")).toBe(false);
    // 客服不碰门店的钱
    expect(canAccessModule("CS", "payments-ledger")).toBe(false);
    expect(canAccessModule("CS", "payments-settings")).toBe(false);
  });

  it("hides settings from ADMIN and keeps audit read-only visible to FINANCE", () => {
    expect(canAccessModule("ADMIN", "settings")).toBe(false);
    expect(canAccessModule("ADMIN", "audit")).toBe(false);
    expect(canAccessModule("FINANCE", "audit")).toBe(true);
    expect(canAccessModule("CS", "finance")).toBe(false);
    expect(canAccessModule("OWNER", "settings")).toBe(true);
  });

  it("审核台（Slice 2）对四种角色都可见：报单审批是客服日常队列", () => {
    for (const role of MERCHANT_ROLES) {
      expect(canAccessModule(role, "review")).toBe(true);
    }
    expect(getModuleDomain("review")?.label).toBe("订单履约");
  });

  it("keeps eight business domains in the approved order", () => {
    expect(MERCHANT_NAV_DOMAINS.map((domain) => domain.label)).toEqual([
      "经营台",
      "订单履约",
      "客户陪玩",
      "商品店铺",
      "营销会员",
      "财务结算",
      "数据风控",
      "运营设置",
    ]);
    expect(getModuleDomain("dispatch")?.id).toBe("orders");
    expect(getModuleDomain("finance")?.id).toBe("finance");
    expect(getModuleDomain("settings")?.id).toBe("settings");
  });

  it("only exposes preview and planned modules to owners", () => {
    const ownerItems = getVisibleNavDomains("OWNER").flatMap((domain) => [
      ...domain.activeItems,
      ...domain.previewItems,
      ...domain.plannedItems,
    ]);
    const staffItems = (["ADMIN", "CS", "FINANCE"] as const).flatMap((role) =>
      getVisibleNavDomains(role).flatMap((domain) => [
        ...domain.activeItems,
        ...domain.previewItems,
        ...domain.plannedItems,
      ]),
    );

    expect(ownerItems.some((item) => item.status === "preview")).toBe(true);
    expect(ownerItems.some((item) => item.status === "planned")).toBe(true);
    expect(staffItems.every((item) => item.status === "active")).toBe(true);
  });

  it("keeps every active module reachable exactly once", () => {
    const activeIds = getVisibleNavDomains("OWNER").flatMap((domain) =>
      domain.activeItems.map((item) => item.moduleId),
    );

    expect(activeIds).toHaveLength(MERCHANT_MODULES.length);
    expect(new Set(activeIds).size).toBe(MERCHANT_MODULES.length);
  });

  it("exposes the order center third-level entries for every dispatch role", () => {
    for (const role of MERCHANT_ROLES) {
      const dispatchItem = getVisibleNavDomains(role)
        .flatMap((domain) => domain.activeItems)
        .find((item) => item.id === "dispatch");
      if (!canAccessModule(role, "dispatch")) {
        expect(dispatchItem).toBeUndefined();
        continue;
      }
      expect(dispatchItem?.children?.map((child) => child.label)).toEqual([
        "派单工作台",
        "模板管理",
      ]);
      expect(dispatchItem?.children?.map((child) => child.href)).toEqual([
        "/merchant-console/dispatch",
        "/merchant-console/dispatch/templates",
      ]);
    }
  });
});

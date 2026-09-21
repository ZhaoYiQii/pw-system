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
  it("keeps 20 registered modules across four roles", () => {
    // P3 / D3 新增「陪玩违约」台账模块（records 组）。
    expect(MERCHANT_MODULES).toHaveLength(20);
    expect(MERCHANT_ROLES).toEqual(["OWNER", "ADMIN", "CS", "FINANCE"]);
  });

  it("keeps role-visible module counts aligned with the approved demo matrix", () => {
    const counts = Object.fromEntries(
      MERCHANT_ROLES.map((role) => [
        role,
        getVisibleNavGroups(role).flatMap((group) => group.items).length,
      ]),
    );
    expect(counts).toEqual({
      OWNER: 20,
      ADMIN: 18,
      CS: 10,
      FINANCE: 11,
    });
  });

  it("hides settings from ADMIN and keeps audit read-only visible to FINANCE", () => {
    expect(canAccessModule("ADMIN", "settings")).toBe(false);
    expect(canAccessModule("ADMIN", "audit")).toBe(false);
    expect(canAccessModule("FINANCE", "audit")).toBe(true);
    expect(canAccessModule("CS", "finance")).toBe(false);
    expect(canAccessModule("OWNER", "settings")).toBe(true);
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

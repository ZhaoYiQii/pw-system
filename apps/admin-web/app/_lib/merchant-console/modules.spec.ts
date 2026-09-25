import { describe, expect, it } from "vitest";
import {
  canAccessModule,
  getMerchantModule,
  getModuleDomain,
  getVisibleNavDomains,
  MERCHANT_NAV_CHILDREN,
  MERCHANT_NAV_DOMAINS,
  MERCHANT_FUTURE_MODULES,
  getVisibleNavGroups,
  MERCHANT_MODULES,
  MERCHANT_ROLES,
  resolveMerchantBreadcrumb,
} from "./modules";

describe("merchant navigation and UI permission mock", () => {
  it("keeps 26 registered modules across four roles", () => {
    // P3 / D3 新增「陪玩违约」台账模块；订单中心列表 Slice 2 新增「审核台」模块；
    // S4-8 新增支付三页（支付台账 / 对账差异 / 支付设置）；S4-9a 新增「客户钱包」。
    expect(MERCHANT_MODULES).toHaveLength(26);
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
      OWNER: 26,
      ADMIN: 19,
      CS: 11,
      FINANCE: 16,
    });
  });

  it("DS-009：统一资金台账落在财务结算域，只有 OWNER 和 FINANCE 可见", () => {
    expect(getMerchantModule("fund-ledger")?.label).toBe("统一资金台账");
    expect(getModuleDomain("fund-ledger")?.id).toBe("finance");
    expect(canAccessModule("OWNER", "fund-ledger")).toBe(true);
    expect(canAccessModule("FINANCE", "fund-ledger")).toBe(true);
    expect(canAccessModule("ADMIN", "fund-ledger")).toBe(false);
    expect(canAccessModule("CS", "fund-ledger")).toBe(false);
    expect(
      MERCHANT_FUTURE_MODULES.some((item) => item.id === "finance-ledger"),
    ).toBe(false);
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

  it("keeps seven business domains in the approved order", () => {
    // 2026-09-25：单店实际只有 1 个游戏 / 1 个区服 / 1 个商品，服务目录撑不起
    // 一个一级域，且它长期是「商品店铺 ⑥」里唯一可点的一项（另外 6 项都是
    // preview/planned），徽标在骗人。删除 `catalog` 域，服务目录并入「运营设置」。
    expect(MERCHANT_NAV_DOMAINS.map((domain) => domain.label)).toEqual([
      "经营台",
      "订单履约",
      "客户陪玩",
      "营销会员",
      "财务结算",
      "数据风控",
      "运营设置",
    ]);
    expect(getModuleDomain("dispatch")?.id).toBe("orders");
    expect(getModuleDomain("finance")?.id).toBe("finance");
    expect(getModuleDomain("settings")?.id).toBe("settings");
    // 服务目录是配置面，与「算价模型」「门店与套餐」同类，落在运营设置。
    expect(getModuleDomain("catalog")?.label).toBe("运营设置");
  });

  it("未来模块的 domain 必须指向真实存在的域", () => {
    // `getVisibleNavDomains` 按 `item.domain === domain.id` 过滤未来模块：
    // domain 写错不会报错，只会让那一项从侧栏静默消失。迁移域时必须先锁这条。
    const domainIds = new Set(MERCHANT_NAV_DOMAINS.map((domain) => domain.id));

    expect(
      MERCHANT_FUTURE_MODULES.filter((item) => !domainIds.has(item.domain)),
    ).toEqual([]);
  });

  it("未来模块在侧栏里一个不多一个不少（OWNER 视角）", () => {
    const futureIds = MERCHANT_FUTURE_MODULES.map((item) => item.id);
    // 唯一性必须单独锁：两侧同时出现重复 id 时，排序后仍然相等，上面那条比较
    // 会照常通过；而侧栏用 key={item.id}，重复 id 会渲染出两个一模一样的菜单项。
    expect(new Set(futureIds).size).toBe(futureIds.length);

    const rendered = getVisibleNavDomains("OWNER").flatMap((domain) => [
      ...domain.previewItems,
      ...domain.plannedItems,
    ]);

    expect(rendered.map((item) => item.id).sort()).toEqual(
      [...futureIds].sort(),
    );
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
      // 侧栏「当前所在」按 child.id 定位，组内 id 必须唯一。
      const childIds = dispatchItem?.children?.map((child) => child.id) ?? [];
      expect(new Set(childIds).size).toBe(childIds.length);
    }
  });
});

describe("merchant breadcrumb route resolution", () => {
  it("审核台挂在派单路径下，面包屑显示自己的模块名", () => {
    expect(resolveMerchantBreadcrumb("dispatch/audit")).toEqual({
      moduleId: "review",
      label: "审核台",
    });
  });

  it("模板管理显示三级菜单名，且与侧栏注册表同源", () => {
    // Arrange：三级菜单文案以 MERCHANT_NAV_CHILDREN 为准，避免两处硬编码漂移。
    const templateChild = MERCHANT_NAV_CHILDREN.dispatch?.find(
      (child) => child.id === "dispatch-templates",
    );

    expect(templateChild?.label).toBe("模板管理");
    expect(resolveMerchantBreadcrumb("dispatch/templates")).toEqual({
      moduleId: "dispatch",
      label: templateChild?.label,
    });
  });

  it("订单列表与订单详情仍显示所属模块名", () => {
    expect(resolveMerchantBreadcrumb("dispatch")).toEqual({
      moduleId: "dispatch",
      label: "订单台账",
    });
    expect(resolveMerchantBreadcrumb("dispatch/9c1f-order")).toEqual({
      moduleId: "dispatch",
      label: "订单台账",
    });
  });

  it("工作台与未知路径回落到经营工作台，不抛错", () => {
    expect(resolveMerchantBreadcrumb("")).toEqual({
      moduleId: "work",
      label: "经营工作台",
    });
    expect(resolveMerchantBreadcrumb("nope/deep/path")).toEqual({
      moduleId: "work",
      label: "经营工作台",
    });
    // 原型键：`/merchant-console/constructor` 是可达路径（[module] 路由会接住），
    // 例外表若用对象字面量查表会返回 Object 构造函数，这里必须回落。
    expect(resolveMerchantBreadcrumb("constructor")).toEqual({
      moduleId: "work",
      label: "经营工作台",
    });
  });

  it("归一化前导斜杠，更深的子孙路由按模块名兜底", () => {
    expect(resolveMerchantBreadcrumb("/dispatch/audit")).toEqual({
      moduleId: "review",
      label: "审核台",
    });
    expect(resolveMerchantBreadcrumb("dispatch/new")).toEqual({
      moduleId: "dispatch",
      label: "订单台账",
    });
    // 三级菜单名用 href 精确匹配：今天没有更深的子孙路由；一旦新增，
    // 必须同时收敛侧栏的最长前缀匹配口径，否则面包屑与高亮会分叉。
    expect(resolveMerchantBreadcrumb("dispatch/templates/new")).toEqual({
      moduleId: "dispatch",
      label: "订单台账",
    });
  });
});

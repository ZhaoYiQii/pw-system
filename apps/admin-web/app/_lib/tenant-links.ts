export interface TenantNavLink {
  href: string;
  label: string;
}

export interface TenantNavGroup {
  id: "workbench" | "records" | "monitor" | "settings";
  label: string;
  items: TenantNavLink[];
}

export const TENANT_NAV_GROUPS: readonly TenantNavGroup[] = [
  {
    id: "workbench",
    label: "工作台",
    items: [
      { href: "/dashboard", label: "门店概览" },
      { href: "/game-dispatch/new", label: "新建派单" },
    ],
  },
  {
    id: "records",
    label: "记录台",
    items: [
      { href: "/orders", label: "订单台账" },
      { href: "/game-dispatch", label: "派单管理" },
      { href: "/sessions", label: "场次与证据" },
      { href: "/customers", label: "客户档案" },
      { href: "/players", label: "陪玩档案" },
      { href: "/catalog", label: "服务目录" },
      { href: "/game-templates", label: "陪玩模板" },
      { href: "/finance", label: "收入账本" },
      { href: "/settlements", label: "结算批次" },
      { href: "/disputes", label: "客诉记录" },
      { href: "/audit", label: "审计日志" },
    ],
  },
  {
    id: "monitor",
    label: "监控台",
    items: [
      { href: "/sessions", label: "进行中场次" },
      { href: "/disputes", label: "异常与争议" },
      { href: "/settlements", label: "财务风险" },
      { href: "/notifications", label: "通知与健康" },
    ],
  },
  {
    id: "settings",
    label: "设置",
    items: [{ href: "/settings", label: "门店设置" }],
  },
];

export const TENANT_LINKS: readonly TenantNavLink[] = TENANT_NAV_GROUPS.flatMap(
  (group) => group.items,
);

export const TENANT_ADDON_LINKS = [
  {
    featureKey: "addon.ai_requirement_parser",
    href: "/ai",
    label: "AI 需求助手",
  },
] as const;

export function tenantNavGroupsWithAddons(
  enabledAddonLinks: readonly TenantNavLink[],
): readonly TenantNavGroup[] {
  return TENANT_NAV_GROUPS.map((group) =>
    group.id === "workbench" && enabledAddonLinks.length > 0
      ? { ...group, items: [...group.items, ...enabledAddonLinks] }
      : group,
  );
}

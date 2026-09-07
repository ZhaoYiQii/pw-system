export const TENANT_LINKS = [
  { href: "/customers", label: "客户" },
  { href: "/orders", label: "订单" },
  { href: "/players", label: "陪玩" },
  { href: "/catalog", label: "服务目录" },
  { href: "/game-templates", label: "陪玩模板" },
  { href: "/game-dispatch", label: "派单管理" },
  { href: "/notifications", label: "通知" },
  { href: "/audit", label: "审计" },
  { href: "/disputes", label: "争议" },
  { href: "/settings", label: "门店设置" },
  { href: "/finance", label: "财务" },
  { href: "/settlements", label: "结算批次" },
] as const;

export const TENANT_ADDON_LINKS = [
  {
    featureKey: "addon.ai_requirement_parser",
    href: "/ai",
    label: "AI 需求助手",
  },
] as const;

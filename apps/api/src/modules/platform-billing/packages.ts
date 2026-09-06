export interface PackageDef {
  code: string;
  name: string;
  addons: string[];
}

export const PACKAGES: PackageDef[] = [
  { code: "BASIC", name: "基础版", addons: [] },
  { code: "PRO", name: "专业版", addons: ["addon.customer_self_service", "addon.player_order_hall"] },
  {
    code: "PREMIUM",
    name: "旗舰版",
    addons: [
      "addon.customer_self_service",
      "addon.player_order_hall",
      "addon.advanced_reports",
      "addon.custom_domain",
      "addon.online_payment",
      "addon.enterprise_wechat_notifications",
      "addon.open_api"
    ]
  }
];

export function packageByCode(code: string): PackageDef | undefined {
  return PACKAGES.find((p) => p.code === code);
}
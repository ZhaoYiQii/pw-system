export interface PackageDef {
  code: string;
  name: string;
  addons: string[];
  /** 订阅有效期（天）；到期后由平台 expireDueSubscriptions 置 EXPIRED 并回收 addon。 */
  durationDays: number;
}

export const PACKAGES: PackageDef[] = [
  { code: "BASIC", name: "基础版", addons: [], durationDays: 30 },
  {
    code: "PRO",
    name: "专业版",
    addons: ["addon.customer_self_service", "addon.player_order_hall"],
    durationDays: 90,
  },
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
      "addon.open_api",
    ],
    durationDays: 365,
  },
];

export function packageByCode(code: string): PackageDef | undefined {
  return PACKAGES.find((p) => p.code === code);
}

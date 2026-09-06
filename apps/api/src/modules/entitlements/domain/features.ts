// 主规格 9：永久启用 core 功能 + 可销售 addon。集中定义，禁止魔法字符串。
export const CORE_FEATURES = [
  "core.tenancy",
  "core.identity",
  "core.audit",
  "core.customers",
  "core.players",
  "core.catalog",
  "core.orders",
  "core.dispatch",
  "core.sessions",
  "core.settlements",
] as const;

export const ADDON_FEATURES = [
  "addon.customer_self_service",
  "addon.player_order_hall",
  "addon.ai_requirement_parser",
  "addon.ai_match_recommendation",
  "addon.ai_anomaly_detection",
  "addon.advanced_reports",
  "addon.custom_domain",
  "addon.independent_miniprogram",
  "addon.online_payment",
  "addon.enterprise_wechat_notifications",
  "addon.chain_stores",
  "addon.open_api",
] as const;

export const FEATURE_KEYS = [...CORE_FEATURES, ...ADDON_FEATURES] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export function isCoreFeature(key: string): boolean {
  return (CORE_FEATURES as readonly string[]).includes(key);
}

export function isFeatureKey(key: string): key is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(key);
}

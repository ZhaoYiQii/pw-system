import {
  isCoreFeature,
  isFeatureKey,
  type FeatureKey,
} from "../domain/features.js";
import { FeatureDisabledError, UnknownFeatureError } from "../domain/errors.js";

export interface FeatureRow {
  featureKey: string;
  enabled: boolean;
}

export interface TenantSubscriptionView {
  id: string;
  packageCode: string;
  status: string;
  startsAt: Date;
  endsAt: Date | null;
}

export interface EntitlementRepository {
  list(tenantId: string): Promise<FeatureRow[]>;
  set(tenantId: string, featureKey: string, enabled: boolean): Promise<void>;
  getSubscription(
    tenantId: string,
  ): Promise<TenantSubscriptionView | null>;
}

export interface FeatureState extends FeatureRow {
  core: boolean;
}

export class EntitlementsService {
  constructor(private readonly repository: EntitlementRepository) {}

  async listFeatures(tenantId: string): Promise<FeatureState[]> {
    const rows = await this.repository.list(tenantId);
    const enabledAddons = new Set(
      rows.filter((r) => r.enabled).map((r) => r.featureKey),
    );
    const all: FeatureState[] = [];
    for (const key of [
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
    ]) {
      all.push({
        featureKey: key,
        core: isCoreFeature(key),
        enabled: isCoreFeature(key) ? true : enabledAddons.has(key),
      });
    }
    return all;
  }

  async setFeature(
    tenantId: string,
    key: string,
    enabled: boolean,
  ): Promise<void> {
    if (!isFeatureKey(key)) throw new UnknownFeatureError(key);
    if (isCoreFeature(key)) {
      // core 常开；平台开关仅允许管理 addon
      throw new UnknownFeatureError(key);
    }
    await this.repository.set(tenantId, key, enabled);
  }

  async ensureAddonEnabled(tenantId: string, key: string): Promise<FeatureKey> {
    if (!isFeatureKey(key)) throw new UnknownFeatureError(key);
    if (isCoreFeature(key)) return key;
    const rows = await this.repository.list(tenantId);
    const enabled = rows.find((r) => r.featureKey === key)?.enabled ?? false;
    if (!enabled) throw new FeatureDisabledError(key);
    return key;
  }

  async getSubscription(
    tenantId: string,
  ): Promise<TenantSubscriptionView | null> {
    return this.repository.getSubscription(tenantId);
  }
}

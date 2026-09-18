import {
  FEATURE_KEYS,
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
  getSubscription(tenantId: string): Promise<TenantSubscriptionView | null>;
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
    // 以 features.ts 的目录为单一事实源：新增 addon 时不再需要改这里。
    for (const key of FEATURE_KEYS) {
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

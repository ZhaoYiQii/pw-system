import type { PrismaClient } from "@pw/database";
import type {
  EntitlementRepository,
  FeatureRow,
  TenantSubscriptionView,
} from "../application/entitlements.service.js";

export class PrismaEntitlementRepository implements EntitlementRepository {
  constructor(private readonly client: PrismaClient) {}

  async list(tenantId: string): Promise<FeatureRow[]> {
    const rows = await this.client.tenantEntitlement.findMany({
      where: { tenantId },
    });
    return rows.map((r) => ({ featureKey: r.featureKey, enabled: r.enabled }));
  }

  async set(
    tenantId: string,
    featureKey: string,
    enabled: boolean,
  ): Promise<void> {
    await this.client.tenantEntitlement.upsert({
      where: { tenantId_featureKey: { tenantId, featureKey } },
      update: { enabled },
      create: { tenantId, featureKey, enabled, source: "platform" },
    });
  }

  async getSubscription(
    tenantId: string,
  ): Promise<TenantSubscriptionView | null> {
    const row = await this.client.tenantSubscription.findFirst({
      where: { tenantId, status: "ACTIVE" },
      orderBy: { startsAt: "desc" },
    });
    if (!row) return null;
    return {
      id: row.id,
      packageCode: row.packageCode,
      status: row.status,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
    };
  }
}

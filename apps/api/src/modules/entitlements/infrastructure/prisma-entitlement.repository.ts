import type { PrismaClient } from "@pw/database";
import type { EntitlementRepository, FeatureRow } from "../application/entitlements.service.js";

export class PrismaEntitlementRepository implements EntitlementRepository {
  constructor(private readonly client: PrismaClient) {}

  async list(tenantId: string): Promise<FeatureRow[]> {
    const rows = await this.client.tenantEntitlement.findMany({ where: { tenantId } });
    return rows.map((r) => ({ featureKey: r.featureKey, enabled: r.enabled }));
  }

  async set(tenantId: string, featureKey: string, enabled: boolean): Promise<void> {
    await this.client.tenantEntitlement.upsert({
      where: { tenantId_featureKey: { tenantId, featureKey } },
      update: { enabled },
      create: { tenantId, featureKey, enabled, source: "platform" }
    });
  }
}

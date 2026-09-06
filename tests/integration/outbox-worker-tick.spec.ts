import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PlatformBillingService } from "../../apps/api/src/modules/platform-billing/platform-billing.service.js";
import { runBackgroundTick } from "../../apps/api/src/background/worker.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

const suffix = Date.now().toString(36);

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

describe("R4 worker tick（Outbox 消费 + 订阅到期回收）", () => {
  let client: PrismaClient;
  let tenantId: string;

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    const t = await client.tenant.create({
      data: { code: `wk_${suffix}`, name: "worker店" },
    });
    tenantId = t.id;
    await client.tenantSubscription.create({
      data: {
        tenantId,
        packageCode: "PRO",
        status: "ACTIVE",
        endsAt: new Date(Date.now() - 60_000),
      },
    });
    await client.tenantEntitlement.create({
      data: {
        tenantId,
        featureKey: "addon.customer_self_service",
        enabled: true,
        source: "package:PRO",
      },
    });
    await client.outboxEvent.create({
      data: {
        tenantId,
        aggregateType: "order",
        aggregateId: `wk-order-${suffix}`,
        eventType: "order.confirmed",
        payload: { orderNo: "WK1" },
      },
    });
  });

  afterAll(async () => {
    if (client) {
      await client.outboxEvent.deleteMany({ where: { tenantId } });
      await client.notificationDelivery.deleteMany({ where: { tenantId } });
      await client.tenantEntitlement.deleteMany({ where: { tenantId } });
      await client.tenantSubscription.deleteMany({ where: { tenantId } });
      await client.tenant.deleteMany({ where: { id: tenantId } });
      await client.$disconnect();
    }
  });

  it("一次 tick 同时完成订阅到期与 Outbox 通知投递", async () => {
    const billing = new PlatformBillingService(client);
    const result = await runBackgroundTick(client, billing, {
      batchSize: 20,
      tenantId,
    });
    expect(result).toEqual({
      subscriptionsExpired: 1,
      outboxProcessed: 1,
    });
    const sub = await client.tenantSubscription.findFirstOrThrow({
      where: { tenantId },
    });
    expect(sub.status).toBe("EXPIRED");
    expect(await client.tenantEntitlement.count({ where: { tenantId } })).toBe(
      0,
    );
    const outbox = await client.outboxEvent.findFirstOrThrow({
      where: { tenantId },
    });
    expect(outbox.status).toBe("PROCESSED");
    expect(
      await client.notificationDelivery.count({ where: { tenantId } }),
    ).toBe(1);
  });
});

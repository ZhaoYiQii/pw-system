import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LedgerService } from "../../apps/api/src/modules/ledger/application/ledger.service.js";
import { PrismaLedgerRepository } from "../../apps/api/src/modules/ledger/infrastructure/prisma-ledger.repository.js";
import { PlatformBillingService } from "../../apps/api/src/modules/platform-billing/platform-billing.service.js";
import {
  runBackgroundTick,
  type BackgroundTickOptions,
} from "../../apps/api/src/background/worker.js";
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
      const orders = await client.order.findMany({
        where: { tenantId },
        select: { id: true },
      });
      for (const o of orders) {
        await client.earning.deleteMany({ where: { tenantId, orderId: o.id } });
        await client.orderEvent.deleteMany({
          where: { tenantId, orderId: o.id },
        });
        await client.orderPriceSnapshot.deleteMany({
          where: { tenantId, orderId: o.id },
        });
        const sessions = await client.serviceSession.findMany({
          where: { tenantId, orderId: o.id },
          select: { id: true },
        });
        for (const session of sessions) {
          await client.sessionEvent.deleteMany({
            where: { tenantId, sessionId: session.id },
          });
          await client.sessionAdjustment.deleteMany({
            where: { tenantId, sessionId: session.id },
          });
          await client.evidenceAsset.deleteMany({
            where: { tenantId, sessionId: session.id },
          });
        }
        await client.serviceSession.deleteMany({
          where: { tenantId, orderId: o.id },
        });
        await client.assignment.deleteMany({
          where: { tenantId, orderId: o.id },
        });
      }
      await client.order.deleteMany({ where: { tenantId } });
      await client.ledgerEntry.deleteMany({
        where: { tenantId },
      });
      await client.ledgerTransaction.deleteMany({ where: { tenantId } });
      await client.ledgerAccount.deleteMany({ where: { tenantId } });
      await client.customerProfile.deleteMany({ where: { tenantId } });
      await client.playerProfile.deleteMany({ where: { tenantId } });
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
      autoConfirmed: 0,
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

  it("PENDING_CONFIRMATION 超时后 tick 自动完成核算（system actor）", async () => {
    const customer = await client.customerProfile.create({
      data: { tenantId, name: "自动确认客户" },
    });
    const player = await client.playerProfile.create({
      data: { tenantId, name: "自动确认陪玩" },
    });
    const order = await client.order.create({
      data: {
        tenantId,
        orderNo: `wk_ac_${suffix}`,
        customerProfileId: customer.id,
        status: "PENDING_CONFIRMATION",
        updatedAt: new Date(Date.now() - 2 * 60 * 1000),
      },
    });
    await client.assignment.create({
      data: { tenantId, orderId: order.id, playerId: player.id },
    });
    await client.serviceSession.create({
      data: {
        tenantId,
        orderId: order.id,
        playerId: player.id,
        status: "ENDED",
        endedAt: new Date(Date.now() - 60 * 1000),
      },
    });
    await client.orderPriceSnapshot.create({
      data: {
        tenantId,
        orderId: order.id,
        snapshotVersion: 1,
        productName: "自动确认产品",
        durationSeconds: 3600,
        unitPriceFen: 10_000n,
        playerCostFen: 7_000n,
        quantity: 1,
        lineTotalFen: 10_000n,
      },
    });
    const ledger = new LedgerService(new PrismaLedgerRepository(client));
    const billing = new PlatformBillingService(client);
    const tickOptions: BackgroundTickOptions = {
      batchSize: 20,
      tenantId,
      ledger,
      confirmTimeoutMs: 60_000,
    };
    const result = await runBackgroundTick(client, billing, tickOptions);
    expect(result.autoConfirmed).toBe(1);
    const after = await client.order.findFirstOrThrow({
      where: { id: order.id },
    });
    expect(after.status).toBe("COMPLETED");
    const event = await client.orderEvent.findFirstOrThrow({
      where: { tenantId, orderId: order.id, eventType: "ORDER_ACCOUNTED" },
    });
    expect(event.actorType).toBe("system");
    expect(
      await client.earning.count({ where: { tenantId, orderId: order.id } }),
    ).toBe(1);
  });
});

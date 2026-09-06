import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, withTenantContext } from "@pw/database";
import type { PrismaClient } from "@pw/database";
function envOrThrow(name: string): string { const v = process.env[name]; if (!v) throw new Error(`missing env ${name}`); return v; }

describe("tenant isolation for Slice 8 ledger/settlement", () => {
  const suffix = Date.now().toString(36);
  let owner: PrismaClient;
  let runtime: PrismaClient;
  let tenantAId: string;
  let tenantBId: string;
  let earningBId: string;

  beforeAll(async () => {
    owner = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    runtime = createDatabaseClient(envOrThrow("PW_TEST_RUNTIME_URL"));
    const a = await owner.tenant.create({ data: { code: `l8_a_${suffix}`, name: "A 店" } });
    const b = await owner.tenant.create({ data: { code: `l8_b_${suffix}`, name: "B 店" } });
    tenantAId = a.id;
    tenantBId = b.id;
    const pb = await owner.playerProfile.create({ data: { tenantId: b.id, name: "B玩" } });
    const cb = await owner.customerProfile.create({ data: { tenantId: b.id, name: "B客" } });
    const orderB = await owner.order.create({ data: { tenantId: b.id, orderNo: `l8o-${suffix}`, customerProfileId: cb.id } });
    const earningB = await owner.earning.create({ data: { tenantId: b.id, playerId: pb.id, orderId: orderB.id, amountFen: BigInt(2000) } });
    earningBId = earningB.id;
  });

  afterAll(async () => {
    if (owner) {
      const tids = [tenantAId, tenantBId];
      await owner.manualPaymentRecord.deleteMany({ where: { tenantId: { in: tids } } });
      await owner.settlementItem.deleteMany({ where: { tenantId: { in: tids } } });
      await owner.settlementBatch.deleteMany({ where: { tenantId: { in: tids } } });
      await owner.ledgerEntry.deleteMany({ where: { tenantId: { in: tids } } });
      await owner.ledgerTransaction.deleteMany({ where: { tenantId: { in: tids } } });
      await owner.ledgerAccount.deleteMany({ where: { tenantId: { in: tids } } });
      await owner.earning.deleteMany({ where: { tenantId: { in: tids } } });
      const orders = await owner.order.findMany({ where: { tenantId: { in: tids } } });
      for (const o of orders) await owner.orderEvent.deleteMany({ where: { orderId: o.id } });
      await owner.order.deleteMany({ where: { tenantId: { in: tids } } });
      await owner.playerProfile.deleteMany({ where: { tenantId: { in: tids } } });
      await owner.customerProfile.deleteMany({ where: { tenantId: { in: tids } } });
      await owner.tenant.deleteMany({ where: { id: { in: tids } } });
      await owner.$disconnect();
    }
    if (runtime) await runtime.$disconnect();
  });

  it("SELECT：A 店读不到 B 店 earning；DELETE 被拒；INSERT tenant_id=B 被拒", async () => {
    await withTenantContext(runtime, tenantAId, async (tx) => {
      expect((await tx.earning.findMany()).map((e) => e.id)).not.toContain(earningBId);
      await expect(tx.earning.delete({ where: { id: earningBId } })).rejects.toThrow();
    });
    await withTenantContext(runtime, tenantAId, async (tx) => {
      await expect(
        tx.earning.create({
          data: { tenantId: tenantBId, playerId: "00000000-0000-0000-0000-000000000001", orderId: "00000000-0000-0000-0000-000000000002", amountFen: BigInt(1) }
        })
      ).rejects.toThrow();
    });
  });
});
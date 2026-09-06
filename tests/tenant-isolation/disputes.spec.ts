import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, withTenantContext } from "@pw/database";
import type { PrismaClient } from "@pw/database";
function envOrThrow(name: string): string { const v = process.env[name]; if (!v) throw new Error(`missing env ${name}`); return v; }

describe("tenant isolation for Slice 9 dispute/audit", () => {
  const suffix = Date.now().toString(36);
  let owner: PrismaClient;
  let runtime: PrismaClient;
  let tenantAId: string;
  let tenantBId: string;
  let disputeBId: string;

  beforeAll(async () => {
    owner = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    runtime = createDatabaseClient(envOrThrow("PW_TEST_RUNTIME_URL"));
    const a = await owner.tenant.create({ data: { code: `d9_a_${suffix}`, name: "A 店" } });
    const b = await owner.tenant.create({ data: { code: `d9_b_${suffix}`, name: "B 店" } });
    tenantAId = a.id;
    tenantBId = b.id;
    const cb = await owner.customerProfile.create({ data: { tenantId: b.id, name: "B客" } });
    const orderB = await owner.order.create({ data: { tenantId: b.id, orderNo: `d9o-${suffix}`, customerProfileId: cb.id } });
    const pb = await owner.playerProfile.create({ data: { tenantId: b.id, name: "B玩" } });
    const d = await owner.dispute.create({ data: { tenantId: b.id, orderId: orderB.id, playerId: pb.id, customerProfileId: cb.id, reason: "体验差" } });
    disputeBId = d.id;
  });

  afterAll(async () => {
    if (owner) {
      const tids = [tenantAId, tenantBId];
      await owner.disputeEvent.deleteMany({ where: { tenantId: { in: tids } } });
      await owner.dispute.deleteMany({ where: { tenantId: { in: tids } } });
      await owner.auditLog.deleteMany({ where: { tenantId: { in: tids } } });
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

  it("A 店读不到 B 店 dispute/audit；删除被拒；本店插入被拒(tenant=B)", async () => {
    await withTenantContext(runtime, tenantAId, async (tx) => {
      expect((await tx.dispute.findMany()).map((x) => x.id)).not.toContain(disputeBId);
      expect((await tx.auditLog.findMany()).length).toBe(0);
      await expect(tx.dispute.delete({ where: { id: disputeBId } })).rejects.toThrow();
    });
    await withTenantContext(runtime, tenantAId, async (tx) => {
      await expect(
        tx.dispute.create({
          data: {
            tenantId: tenantBId,
            orderId: "00000000-0000-0000-0000-000000000001",
            playerId: "00000000-0000-0000-0000-000000000002",
            customerProfileId: "00000000-0000-0000-0000-000000000003",
            reason: "x"
          }
        })
      ).rejects.toThrow();
    });
  });
});
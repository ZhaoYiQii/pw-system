import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, withTenantContext } from "@pw/database";
import type { PrismaClient } from "@pw/database";

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

describe("tenant isolation for Slice 5 order tables", () => {
  const suffix = Date.now().toString(36);
  let owner: PrismaClient;
  let runtime: PrismaClient;
  let tenantAId: string;
  let tenantBId: string;
  let orderBId: string;
  let customerAId: string;

  beforeAll(async () => {
    owner = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    runtime = createDatabaseClient(envOrThrow("PW_TEST_RUNTIME_URL"));
    const a = await owner.tenant.create({
      data: { code: `o5_a_${suffix}`, name: "A 店" },
    });
    const b = await owner.tenant.create({
      data: { code: `o5_b_${suffix}`, name: "B 店" },
    });
    tenantAId = a.id;
    tenantBId = b.id;
    const customerA = await owner.customerProfile.create({
      data: { tenantId: a.id, name: "A客" },
    });
    customerAId = customerA.id;
    const customerB = await owner.customerProfile.create({
      data: { tenantId: b.id, name: "B客" },
    });
    const orderB = await owner.order.create({
      data: {
        tenantId: b.id,
        orderNo: `o-${suffix}`,
        customerProfileId: customerB.id,
      },
    });
    orderBId = orderB.id;
    await owner.orderRequirement.create({
      data: { tenantId: b.id, orderId: orderB.id, description: "B需求" },
    });
    await owner.orderEvent.create({
      data: {
        tenantId: b.id,
        orderId: orderB.id,
        eventType: "ORDER_CREATED",
        fromStatus: null,
        toStatus: "DRAFT",
      },
    });
  });

  afterAll(async () => {
    if (owner) {
      const tids = [tenantAId, tenantBId];
      await owner.orderEvent.deleteMany({ where: { tenantId: { in: tids } } });
      await owner.orderPriceSnapshot.deleteMany({
        where: { tenantId: { in: tids } },
      });
      await owner.orderRequirement.deleteMany({
        where: { tenantId: { in: tids } },
      });
      await owner.order.deleteMany({ where: { tenantId: { in: tids } } });
      await owner.customerProfile.deleteMany({
        where: { tenantId: { in: tids } },
      });
      await owner.tenant.deleteMany({ where: { id: { in: tids } } });
      await owner.$disconnect();
    }
    if (runtime) await runtime.$disconnect();
  });

  it("SELECT：A 店上下文读不到 B 店订单/需求/事件", async () => {
    await withTenantContext(runtime, tenantAId, async (tx) => {
      const orders = await tx.order.findMany();
      expect(orders.map((o) => o.id)).not.toContain(orderBId);
      const reqs = await tx.orderRequirement.findMany();
      expect(reqs.length).toBe(0);
      const events = await tx.orderEvent.findMany();
      expect(events.length).toBe(0);
    });
  });

  it("INSERT：A 店上下文写入 tenant_id=B 的订单被拒", async () => {
    await withTenantContext(runtime, tenantAId, async (tx) => {
      await expect(
        tx.order.create({
          data: {
            tenantId: tenantBId,
            orderNo: "x",
            customerProfileId: customerAId,
          },
        }),
      ).rejects.toThrow();
    });
  });

  it("合法写入：A 店上下文可创建本店订单并可见", async () => {
    await withTenantContext(runtime, tenantAId, async (tx) => {
      const created = await tx.order.create({
        data: {
          tenantId: tenantAId,
          orderNo: `oa-${suffix}`,
          customerProfileId: customerAId,
        },
      });
      const seen = await tx.order.findUnique({ where: { id: created.id } });
      expect(seen?.tenantId).toBe(tenantAId);
      await tx.order.delete({ where: { id: created.id } });
    });
  });

  it("DELETE：A 店上下文无法删除 B 店订单", async () => {
    await withTenantContext(runtime, tenantAId, async (tx) => {
      await expect(
        tx.order.delete({ where: { id: orderBId } }),
      ).rejects.toThrow();
    });
  });
});

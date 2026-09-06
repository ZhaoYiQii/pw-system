import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, withTenantContext } from "@pw/database";
import type { PrismaClient } from "@pw/database";

function envOrThrow(name: string): string { const v = process.env[name]; if (!v) throw new Error(`missing env ${name}`); return v; }

describe("tenant isolation for Slice 6 dispatch tables", () => {
  const suffix = Date.now().toString(36);
  let owner: PrismaClient;
  let runtime: PrismaClient;
  let tenantAId: string;
  let tenantBId: string;
  let pubBId: string;

  beforeAll(async () => {
    owner = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    runtime = createDatabaseClient(envOrThrow("PW_TEST_RUNTIME_URL"));
    const a = await owner.tenant.create({ data: { code: `d6_a_${suffix}`, name: "A 店" } });
    const b = await owner.tenant.create({ data: { code: `d6_b_${suffix}`, name: "B 店" } });
    tenantAId = a.id;
    tenantBId = b.id;
    const cb = await owner.customerProfile.create({ data: { tenantId: b.id, name: "B客" } });
    const orderB = await owner.order.create({ data: { tenantId: b.id, orderNo: `d6o-${suffix}`, customerProfileId: cb.id } });
    const pubB = await owner.dispatchPublication.create({ data: { tenantId: b.id, orderId: orderB.id } });
    pubBId = pubB.id;
  });

  afterAll(async () => {
    if (owner) {
      const tids = [tenantAId, tenantBId];
      await owner.assignment.deleteMany({ where: { tenantId: { in: tids } } });
      await owner.application.deleteMany({ where: { tenantId: { in: tids } } });
      await owner.dispatchPublication.deleteMany({ where: { tenantId: { in: tids } } });
      const ordersB = await owner.order.findMany({ where: { tenantId: { in: tids } } });
      for (const o of ordersB) { await owner.orderEvent.deleteMany({ where: { orderId: o.id } }); }
      await owner.order.deleteMany({ where: { tenantId: { in: tids } } });
      await owner.customerProfile.deleteMany({ where: { tenantId: { in: tids } } });
      await owner.tenant.deleteMany({ where: { id: { in: tids } } });
      await owner.$disconnect();
    }
    if (runtime) await runtime.$disconnect();
  });

  it("SELECT：A 店上下文读不到 B 店发布/报名/指派", async () => {
    await withTenantContext(runtime, tenantAId, async (tx) => {
      const pubs = await tx.dispatchPublication.findMany();
      expect(pubs.map((p) => p.id)).not.toContain(pubBId);
      expect((await tx.application.findMany()).length).toBe(0);
      expect((await tx.assignment.findMany()).length).toBe(0);
    });
  });

  it("INSERT：A 店上下文写入 tenant_id=B 的发布被拒", async () => {
    await withTenantContext(runtime, tenantAId, async (tx) => {
      const ob = await owner.order.findFirst({ where: { tenantId: tenantBId } });
      await expect(tx.dispatchPublication.create({ data: { tenantId: tenantBId, orderId: ob?.id as string } })).rejects.toThrow();
    });
  });

  it("DELETE：A 店上下文无法删除 B 店发布", async () => {
    await withTenantContext(runtime, tenantAId, async (tx) => {
      await expect(tx.dispatchPublication.delete({ where: { id: pubBId } })).rejects.toThrow();
    });
  });
});
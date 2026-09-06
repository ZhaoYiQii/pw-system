import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, withTenantContext } from "@pw/database";
import type { PrismaClient } from "@pw/database";
function envOrThrow(name: string): string { const v = process.env[name]; if (!v) throw new Error(`missing env ${name}`); return v; }

describe("tenant isolation for Slice 10 AI tables", () => {
  const suffix = Date.now().toString(36);
  let owner: PrismaClient;
  let runtime: PrismaClient;
  let tenantAId: string;
  let tenantBId: string;
  let runBId: string;

  beforeAll(async () => {
    owner = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    runtime = createDatabaseClient(envOrThrow("PW_TEST_RUNTIME_URL"));
    const a = await owner.tenant.create({ data: { code: `a10_a_${suffix}`, name: "A" } });
    const b = await owner.tenant.create({ data: { code: `a10_b_${suffix}`, name: "B" } });
    tenantAId = a.id;
    tenantBId = b.id;
    const runB = await owner.aiRun.create({ data: { tenantId: b.id, runType: "PARSE_REQUIREMENT", modelVersion: "v1", promptVersion: "v1" } });
    runBId = runB.id;
  });

  afterAll(async () => {
    if (owner) {
      const tids = [tenantAId, tenantBId];
      await owner.aiSuggestion.deleteMany({ where: { tenantId: { in: tids } } });
      await owner.aiRun.deleteMany({ where: { tenantId: { in: tids } } });
      await owner.tenant.deleteMany({ where: { id: { in: tids } } });
      await owner.$disconnect();
    }
    if (runtime) await runtime.$disconnect();
  });

  it("A 店读不到 B 店 aiRun；删除被拒；跨租户插入被拒", async () => {
    await withTenantContext(runtime, tenantAId, async (tx) => {
      expect((await tx.aiRun.findMany()).map((x) => x.id)).not.toContain(runBId);
      await expect(tx.aiRun.delete({ where: { id: runBId } })).rejects.toThrow();
    });
    await withTenantContext(runtime, tenantAId, async (tx) => {
      await expect(
        tx.aiRun.create({ data: { tenantId: tenantBId, runType: "RECOMMEND_PLAYERS", modelVersion: "v1", promptVersion: "v1" } })
      ).rejects.toThrow();
    });
  });
});
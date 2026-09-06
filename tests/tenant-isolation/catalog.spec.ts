import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, withTenantContext } from "@pw/database";
import type { PrismaClient } from "@pw/database";

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

describe("tenant isolation for Slice 4 tables (games/customers/players)", () => {
  const suffix = Date.now().toString(36);
  let owner: PrismaClient;
  let runtime: PrismaClient;
  let tenantAId: string;
  let tenantBId: string;
  let gameBId: string;
  let customerBId: string;
  let playerBId: string;

  beforeAll(async () => {
    owner = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    runtime = createDatabaseClient(envOrThrow("PW_TEST_RUNTIME_URL"));
    const a = await owner.tenant.create({ data: { code: `c4_a_${suffix}`, name: "A 店" } });
    const b = await owner.tenant.create({ data: { code: `c4_b_${suffix}`, name: "B 店" } });
    tenantAId = a.id;
    tenantBId = b.id;
    const gameB = await owner.game.create({ data: { tenantId: b.id, name: "B服王者" } });
    gameBId = gameB.id;
    const customerB = await owner.customerProfile.create({ data: { tenantId: b.id, name: "B客户" } });
    customerBId = customerB.id;
    const playerB = await owner.playerProfile.create({ data: { tenantId: b.id, name: "B陪玩" } });
    playerBId = playerB.id;
  });

  afterAll(async () => {
    if (owner) {
      const tids = [tenantAId, tenantBId];
      await owner.playerAvailability.deleteMany({ where: { tenantId: { in: tids } } });
      await owner.playerSkill.deleteMany({ where: { tenantId: { in: tids } } });
      await owner.pricingRule.deleteMany({ where: { tenantId: { in: tids } } });
      await owner.serviceProduct.deleteMany({ where: { tenantId: { in: tids } } });
      await owner.gameRegion.deleteMany({ where: { tenantId: { in: tids } } });
      await owner.game.deleteMany({ where: { tenantId: { in: tids } } });
      await owner.customerProfile.deleteMany({ where: { tenantId: { in: tids } } });
      await owner.playerProfile.deleteMany({ where: { tenantId: { in: tids } } });
      await owner.tenant.deleteMany({ where: { id: { in: tids } } });
      await owner.$disconnect();
    }
    if (runtime) await runtime.$disconnect();
  });

  it("SELECT: A 店上下文读不到 B 店的游戏/客户/陪玩", async () => {
    await withTenantContext(runtime, tenantAId, async (tx) => {
      const games = await tx.game.findMany();
      expect(games.map((g) => g.id)).not.toContain(gameBId);
      const customers = await tx.customerProfile.findMany();
      expect(customers.map((c) => c.id)).not.toContain(customerBId);
      const players = await tx.playerProfile.findMany();
      expect(players.map((p) => p.id)).not.toContain(playerBId);
    });
  });

  it("INSERT: A 店上下文写入 tenant_id=B 的游戏被 RLS 拒绝", async () => {
    await withTenantContext(runtime, tenantAId, async (tx) => {
      await expect(
        tx.game.create({ data: { tenantId: tenantBId, name: "越权游戏" } })
      ).rejects.toThrow();
    });
  });

  it("UPDATE/DELETE: A 店上下文无法改/删 B 店游戏", async () => {
    await withTenantContext(runtime, tenantAId, async (tx) => {
      await expect(
        tx.game.update({ where: { id: gameBId }, data: { name: "hacked" } })
      ).rejects.toThrow();
      await expect(tx.game.delete({ where: { id: gameBId } })).rejects.toThrow();
    });
  });

  it("合法写入：A 店上下文可在本店创建游戏并可见", async () => {
    await withTenantContext(runtime, tenantAId, async (tx) => {
      const created = await tx.game.create({ data: { tenantId: tenantAId, name: "A服LOL" } });
      expect(created.tenantId).toBe(tenantAId);
      const rows = await tx.game.findMany({ where: { tenantId: tenantAId } });
      expect(rows.some((g) => g.id === created.id)).toBe(true);
      await tx.game.delete({ where: { id: created.id } });
    });
  });
});
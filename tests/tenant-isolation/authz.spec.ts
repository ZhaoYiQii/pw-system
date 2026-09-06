import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, withTenantContext } from "@pw/database";
import type { PrismaClient } from "@pw/database";
import { hashPassword } from "../../apps/api/src/modules/identity-access/infrastructure/password.js";

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

describe("tenant isolation for auth tables (tenant_accounts/roles)", () => {
  const suffix = Date.now().toString(36);
  let owner: PrismaClient;
  let runtime: PrismaClient;
  let tenantAId: string;
  let tenantBId: string;
  let accountBId: string;

  beforeAll(async () => {
    owner = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    runtime = createDatabaseClient(envOrThrow("PW_TEST_RUNTIME_URL"));
    const pw = await hashPassword("x");
    const a = await owner.tenant.create({ data: { code: `az_a_${suffix}`, name: "A" } });
    const b = await owner.tenant.create({ data: { code: `az_b_${suffix}`, name: "B" } });
    tenantAId = a.id;
    tenantBId = b.id;
    const accB = await owner.tenantAccount.create({ data: { tenantId: b.id, username: "boss", passwordHash: pw } });
    accountBId = accB.id;
    await owner.tenantAccountRole.create({ data: { tenantId: b.id, tenantAccountId: accB.id, role: "TENANT_OWNER" } });
  });

  afterAll(async () => {
    if (owner) {
      await owner.tenantAccountRole.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
      await owner.tenantAccount.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
      await owner.tenant.deleteMany({ where: { id: { in: [tenantAId, tenantBId] } } });
      await owner.$disconnect();
    }
    if (runtime) await runtime.$disconnect();
  });

  it("SELECT: A 店上下文看不到 B 店账号", async () => {
    await withTenantContext(runtime, tenantAId, async (tx) => {
      const rows = await tx.tenantAccount.findMany();
      expect(rows.map((r) => r.id)).not.toContain(accountBId);
    });
  });

  it("UPDATE/DELETE: A 店上下文无法改/删 B 店账号", async () => {
    await withTenantContext(runtime, tenantAId, async (tx) => {
      await expect(
        tx.tenantAccount.update({ where: { id: accountBId }, data: { username: "hacked" } })
      ).rejects.toThrow();
      await expect(tx.tenantAccount.delete({ where: { id: accountBId } })).rejects.toThrow();
    });
  });

  it("INSERT: A 店上下文写入 tenant_id=B 的账号被 RLS 拒绝", async () => {
    await withTenantContext(runtime, tenantAId, async (tx) => {
      await expect(
        tx.tenantAccount.create({ data: { tenantId: tenantBId, username: "x", passwordHash: "h" } })
      ).rejects.toThrow();
    });
  });
});

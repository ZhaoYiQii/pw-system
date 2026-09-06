import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, withTenantContext } from "@pw/database";
import type { PrismaClient } from "@pw/database";

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

const migrationUrl = envOrThrow("PW_TEST_MIGRATION_URL");
const runtimeUrl = envOrThrow("PW_TEST_RUNTIME_URL");

describe("tenant isolation (RLS, five operation classes)", () => {
  let owner: PrismaClient;
  let runtime: PrismaClient;
  let tenantAId: string;
  let tenantBId: string;
  let domainBId: string;
  const createdIds: string[] = [];

  const hostSuffix = Date.now().toString(36);

  beforeAll(async () => {
    owner = createDatabaseClient(migrationUrl);
    runtime = createDatabaseClient(runtimeUrl);
    const a = await owner.tenant.create({
      data: { code: `it_a_${hostSuffix}`, name: "A 店" },
    });
    const b = await owner.tenant.create({
      data: { code: `it_b_${hostSuffix}`, name: "B 店" },
    });
    tenantAId = a.id;
    tenantBId = b.id;
    const db = await owner.tenantDomain.create({
      data: {
        tenantId: b.id,
        host: `b-${hostSuffix}.example.com`,
        isPrimary: true,
      },
    });
    domainBId = db.id;
  });

  afterAll(async () => {
    if (owner) {
      for (const id of createdIds) {
        await owner.tenantDomain
          .delete({ where: { id } })
          .catch(() => undefined);
      }
      await owner.tenantDomain.deleteMany({
        where: { tenantId: { in: [tenantAId, tenantBId] } },
      });
      await owner.tenant.deleteMany({
        where: { id: { in: [tenantAId, tenantBId] } },
      });
      await owner.$disconnect();
    }
    if (runtime) await runtime.$disconnect();
  });

  it("SELECT: A 店上下文读不到 B 店域名", async () => {
    await withTenantContext(runtime, tenantAId, async (tx) => {
      const rows = await tx.tenantDomain.findMany();
      expect(rows.map((r) => r.id)).not.toContain(domainBId);
      expect(rows.every((r) => r.tenantId === tenantAId)).toBe(true);
    });
  });

  it("INSERT: A 店上下文可写自己域名并读回", async () => {
    const host = `a-own-${hostSuffix}.example.com`;
    await withTenantContext(runtime, tenantAId, async (tx) => {
      const created = await tx.tenantDomain.create({
        data: { tenantId: tenantAId, host },
      });
      createdIds.push(created.id);
      const found = await tx.tenantDomain.findUnique({
        where: { id: created.id },
      });
      expect(found?.tenantId).toBe(tenantAId);
    });
  });

  it("INSERT: A 店上下文写入 tenant_id=B 的域名被 RLS 拒绝", async () => {
    await withTenantContext(runtime, tenantAId, async (tx) => {
      await expect(
        tx.tenantDomain.create({
          data: { tenantId: tenantBId, host: `x-${hostSuffix}.example.com` },
        }),
      ).rejects.toThrow();
    });
  });

  it("UPDATE: A 店上下文更新 B 店域名失败（不可见）", async () => {
    await withTenantContext(runtime, tenantAId, async (tx) => {
      await expect(
        tx.tenantDomain.update({
          where: { id: domainBId },
          data: { isPrimary: false },
        }),
      ).rejects.toThrow();
    });
  });

  it("DELETE: A 店上下文删除 B 店域名失败（不可见）", async () => {
    await withTenantContext(runtime, tenantAId, async (tx) => {
      await expect(
        tx.tenantDomain.delete({ where: { id: domainBId } }),
      ).rejects.toThrow();
    });
  });

  it("FK: 引用不存在租户的域名创建被外键拒绝（owner 视角）", async () => {
    await expect(
      owner.tenantDomain.create({
        data: {
          tenantId: "00000000-0000-4000-8000-000000000000",
          host: `fk-${hostSuffix}.example.com`,
        },
      }),
    ).rejects.toThrow();
  });
});

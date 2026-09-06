import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

const migrationUrl = envOrThrow("PW_TEST_MIGRATION_URL");

describe("tenancy: create + resolve tenant (integration)", () => {
  let owner: PrismaClient;
  let tenantId: string | undefined;
  const suffix = Date.now().toString(36);

  beforeAll(async () => {
    owner = createDatabaseClient(migrationUrl);
  });

  afterAll(async () => {
    if (owner) {
      if (tenantId) {
        await owner.tenantDomain.deleteMany({ where: { tenantId } });
        await owner.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
      }
      await owner.$disconnect();
    }
  });

  it("平台创建租户并通过域名解析回租户", async () => {
    const host = `resolve-${suffix}.example.com`;
    const tenant = await owner.tenant.create({
      data: { code: `res_${suffix}`, name: "解析测试店" }
    });
    tenantId = tenant.id;
    await owner.tenantDomain.create({
      data: { tenantId: tenant.id, host, isPrimary: true }
    });
    const resolved = await owner.tenantDomain.findFirst({
      where: { host },
      include: { tenant: true }
    });
    expect(resolved?.tenant.id).toBe(tenant.id);
    expect(resolved?.tenant.status).toBe("ACTIVE");
  });

  it("重复租户编码被唯一约束拒绝", async () => {
    const code = `dup_${suffix}`;
    await owner.tenant.create({ data: { code, name: "首次" } });
    await expect(
      owner.tenant.create({ data: { code, name: "重复" } })
    ).rejects.toThrow();
    await owner.tenant.deleteMany({ where: { code } });
  });
});

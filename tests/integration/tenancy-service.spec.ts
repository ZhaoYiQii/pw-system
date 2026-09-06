import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenancyService } from "../../apps/api/src/modules/tenancy/application/tenancy.service.js";
import { PrismaTenantRepository } from "../../apps/api/src/modules/tenancy/infrastructure/prisma-tenant.repository.js";
import {
  ClientSuppliedTenantIdError,
  DuplicateTenantCodeError,
  InvalidTenantCodeError,
  TenantNotFoundError,
} from "../../apps/api/src/modules/tenancy/domain/errors.js";
import { createDatabaseClient } from "@pw/database";
import type { PrismaClient } from "@pw/database";

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

describe("tenancy service (application + repository)", () => {
  const suffix = Date.now().toString(36);
  const codes: string[] = [];
  let client: PrismaClient;
  let service: TenancyService;

  beforeAll(async () => {
    client = createDatabaseClient(envOrThrow("PW_TEST_MIGRATION_URL"));
    service = new TenancyService(new PrismaTenantRepository(client));
  });

  afterAll(async () => {
    if (client) {
      await client.tenantDomain.deleteMany({
        where: { tenant: { code: { in: codes } } },
      });
      await client.tenant.deleteMany({ where: { code: { in: codes } } });
      await client.$disconnect();
    }
  });

  it("创建租户（含主域名）后可按域名解析为 ACTIVE", async () => {
    const code = `svc_a_${suffix}`;
    codes.push(code);
    const host = `a-${suffix}.example.com`;
    const created = await service.createTenant({
      code,
      name: "服务测试店",
      primaryHost: host,
    });
    expect(created.status).toBe("ACTIVE");
    const resolved = await service.resolveByHost(host);
    expect(resolved.id).toBe(created.id);
    expect(resolved.status).toBe("ACTIVE");
  });

  it("重复 code 抛 DuplicateTenantCodeError", async () => {
    const code = `svc_dup_${suffix}`;
    codes.push(code);
    await service.createTenant({ code, name: "首次" });
    await expect(
      service.createTenant({ code, name: "重复" }),
    ).rejects.toBeInstanceOf(DuplicateTenantCodeError);
  });

  it("非法 code 抛 InvalidTenantCodeError", async () => {
    await expect(
      service.createTenant({ code: "BAD CODE!", name: "x" }),
    ).rejects.toBeInstanceOf(InvalidTenantCodeError);
  });

  it("停用后状态为 INACTIVE（H5 据此显示不可用）", async () => {
    const code = `svc_deact_${suffix}`;
    codes.push(code);
    const host = `deact-${suffix}.example.com`;
    const created = await service.createTenant({
      code,
      name: "待停用",
      primaryHost: host,
    });
    const deactivated = await service.deactivateTenant(created.id);
    expect(deactivated.status).toBe("INACTIVE");
    const resolved = await service.resolveByHost(host);
    expect(resolved.status).toBe("INACTIVE");
  });

  it("停用不存在的租户抛 TenantNotFoundError", async () => {
    await expect(
      service.deactivateTenant("00000000-0000-4000-8000-000000000000"),
    ).rejects.toBeInstanceOf(TenantNotFoundError);
  });

  it("拒绝客户端自报 tenantId（主规格 8.1）", () => {
    expect(() =>
      service.assertNoClientTenantId({ code: "ok", name: "x" }),
    ).not.toThrow();
    expect(() =>
      service.assertNoClientTenantId({
        tenantId: "00000000-0000-4000-8000-000000000000",
      }),
    ).toThrow(ClientSuppliedTenantIdError);
    expect(() => service.assertNoClientTenantId(null)).not.toThrow();
  });
});

import type { PrismaClient } from "@pw/database";
import { DuplicateTenantCodeError } from "../domain/errors.js";
import type { CreateTenantInput, ResolvedTenant, TenantView } from "../domain/tenant.js";
import type { TenantRepository } from "../application/tenancy-ports.js";

function mapTenant(row: {
  id: string;
  code: string;
  name: string;
  status: string;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}): TenantView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status as TenantView["status"],
    timezone: row.timezone,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version
  };
}

export class PrismaTenantRepository implements TenantRepository {
  constructor(private readonly client: PrismaClient) {}

  async createTenant(input: CreateTenantInput): Promise<TenantView> {
    try {
      const tenant = await this.client.tenant.create({
        data: {
          code: input.code,
          name: input.name,
          timezone: input.timezone ?? "Asia/Shanghai"
        }
      });
      if (input.primaryHost) {
        await this.client.tenantDomain.create({
          data: { tenantId: tenant.id, host: input.primaryHost, isPrimary: true }
        });
      }
      return mapTenant(tenant);
    } catch (error) {
      if (
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      ) {
        throw new DuplicateTenantCodeError(input.code);
      }
      throw error;
    }
  }

  async listTenants(): Promise<TenantView[]> {
    const rows = await this.client.tenant.findMany({ orderBy: { createdAt: "asc" } });
    return rows.map(mapTenant);
  }

  async findById(id: string): Promise<TenantView | null> {
    const row = await this.client.tenant.findUnique({ where: { id } });
    return row ? mapTenant(row) : null;
  }

  async findByHost(host: string): Promise<ResolvedTenant | null> {
    const row = await this.client.tenantDomain.findFirst({
      where: { host },
      include: { tenant: true }
    });
    if (!row) return null;
    return {
      id: row.tenant.id,
      code: row.tenant.code,
      name: row.tenant.name,
      status: row.tenant.status as ResolvedTenant["status"]
    };
  }

  async deactivate(id: string): Promise<TenantView> {
    const row = await this.client.tenant.update({
      where: { id },
      data: { status: "INACTIVE" }
    });
    return mapTenant(row);
  }
}

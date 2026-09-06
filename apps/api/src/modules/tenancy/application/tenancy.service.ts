import type { ResolvedTenant, TenantView } from "../domain/tenant.js";
import {
  ClientSuppliedTenantIdError,
  DuplicateTenantCodeError,
  InvalidTenantCodeError,
  TenantNotFoundError,
} from "../domain/errors.js";
import type { CreateTenantInput } from "../domain/tenant.js";
import type { TenantRepository } from "./tenancy-ports.js";

const CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{1,31}$/;

export class TenancyService {
  constructor(private readonly repository: TenantRepository) {}

  async createTenant(input: CreateTenantInput): Promise<TenantView> {
    const code = input.code.trim();
    if (!CODE_PATTERN.test(code)) {
      throw new InvalidTenantCodeError(code);
    }
    try {
      const primaryHost = input.primaryHost?.trim();
      return await this.repository.createTenant({
        code,
        name: input.name.trim(),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        ...(primaryHost !== undefined && primaryHost !== ""
          ? { primaryHost }
          : {}),
      });
    } catch (error) {
      if (error instanceof DuplicateTenantCodeError) throw error;
      throw error;
    }
  }

  listTenants(): Promise<TenantView[]> {
    return this.repository.listTenants();
  }

  async deactivateTenant(id: string): Promise<TenantView> {
    const existing = await this.repository.findById(id);
    if (!existing) throw new TenantNotFoundError(id);
    return this.repository.deactivate(id);
  }

  async resolveByHost(host: string): Promise<ResolvedTenant> {
    const resolved = await this.repository.findByHost(host);
    if (!resolved) throw new TenantNotFoundError(host);
    return resolved;
  }

  /**
   * 主规格 8.1：请求 Body/Query/Header 中客户端自由传入的 tenantId 不能决定租户。
   * 服务端必须根据可信来源（host/短码/会话）生成 TenantContext。
   */
  assertNoClientTenantId(payload: unknown): void {
    if (
      payload !== null &&
      typeof payload === "object" &&
      "tenantId" in payload
    ) {
      throw new ClientSuppliedTenantIdError();
    }
  }
}

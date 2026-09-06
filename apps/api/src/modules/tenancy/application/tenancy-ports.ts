import type { CreateTenantInput, ResolvedTenant, TenantView } from "../domain/tenant.js";

export interface TenantRepository {
  createTenant(input: CreateTenantInput): Promise<TenantView>;
  listTenants(): Promise<TenantView[]>;
  findById(id: string): Promise<TenantView | null>;
  findByHost(host: string): Promise<ResolvedTenant | null>;
  deactivate(id: string): Promise<TenantView>;
}

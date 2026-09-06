// 领域层：不得依赖 NestJS / Prisma（主规格 6/18）。
export type TenantStatus = "ACTIVE" | "INACTIVE" | "CONFIG_ERROR";

export interface TenantView {
  id: string;
  code: string;
  name: string;
  status: TenantStatus;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface ResolvedTenant {
  id: string;
  code: string;
  name: string;
  status: TenantStatus;
}

export interface CreateTenantInput {
  code: string;
  name: string;
  timezone?: string;
  primaryHost?: string;
}

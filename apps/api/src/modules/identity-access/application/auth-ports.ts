export interface PlatformAccountRecord {
  id: string;
  username: string;
  passwordHash: string;
  status: "ACTIVE" | "DISABLED";
  role: string;
}

export interface TenantAccountRecord {
  id: string;
  tenantId: string;
  tenantStatus: "ACTIVE" | "INACTIVE" | "CONFIG_ERROR";
  username: string;
  passwordHash: string;
  status: "ACTIVE" | "DISABLED";
  roles: readonly string[];
}

export interface RefreshSessionRecord {
  id: string;
  subjectType: string;
  accountId: string;
  tenantId: string | null;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface NewRefreshSession {
  subjectType: "platform" | "tenant";
  accountId: string;
  tenantId?: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface AuthAuditEntry {
  tenantId: string;
  actorType?: string;
  actorId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  summary?: string;
}

export interface AuthRepository {
  findPlatformAccountByUsername(username: string): Promise<PlatformAccountRecord | null>;
  findPlatformAccountById(id: string): Promise<PlatformAccountRecord | null>;
  findTenantAccountByCodeAndUsername(
    tenantCode: string,
    username: string
  ): Promise<TenantAccountRecord | null>;
  findTenantAccountById(accountId: string, tenantId?: string | null): Promise<TenantAccountRecord | null>;
  createRefreshSession(session: NewRefreshSession): Promise<void>;
  findRefreshSessionByTokenHash(tokenHash: string): Promise<RefreshSessionRecord | null>;
  revokeRefreshSession(id: string): Promise<void>;
  recordAudit(entry: AuthAuditEntry): Promise<void>;
}

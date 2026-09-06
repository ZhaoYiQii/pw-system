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

export interface AuthRepository {
  findPlatformAccountByUsername(username: string): Promise<PlatformAccountRecord | null>;
  findPlatformAccountById(id: string): Promise<PlatformAccountRecord | null>;
  findTenantAccountByCodeAndUsername(
    tenantCode: string,
    username: string
  ): Promise<TenantAccountRecord | null>;
  findTenantAccountById(accountId: string): Promise<TenantAccountRecord | null>;
  createRefreshSession(session: NewRefreshSession): Promise<void>;
  findRefreshSessionByTokenHash(tokenHash: string): Promise<RefreshSessionRecord | null>;
  revokeRefreshSession(id: string): Promise<void>;
}

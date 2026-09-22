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

export interface RegisterPhoneCustomerInput {
  username: string;
  passwordHash: string;
  phoneEnc: string;
  phoneHash: string;
  displayName: string;
}

/** S3：微信优先口径下建号只需要 openid（手机号后补）。 */
export interface RegisterWechatCustomerInput {
  username: string;
  passwordHash: string;
  wechatOpenid: string;
  displayName: string;
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
  findPlatformAccountByUsername(
    username: string,
  ): Promise<PlatformAccountRecord | null>;
  findPlatformAccountById(id: string): Promise<PlatformAccountRecord | null>;
  findTenantAccountByCodeAndUsername(
    tenantCode: string,
    username: string,
  ): Promise<TenantAccountRecord | null>;
  findTenantIdByCode(tenantCode: string): Promise<string | null>;
  findTenantAccountByPhoneHash(
    tenantId: string,
    phoneHash: string,
  ): Promise<TenantAccountRecord | null>;
  registerPhoneCustomer(
    tenantId: string,
    input: RegisterPhoneCustomerInput,
  ): Promise<TenantAccountRecord>;
  findTenantAccountByOpenid(
    tenantId: string,
    openid: string,
  ): Promise<TenantAccountRecord | null>;
  registerWechatCustomer(
    tenantId: string,
    input: RegisterWechatCustomerInput,
  ): Promise<TenantAccountRecord>;
  findTenantAccountById(
    accountId: string,
    tenantId?: string | null,
  ): Promise<TenantAccountRecord | null>;
  createRefreshSession(session: NewRefreshSession): Promise<void>;
  findRefreshSessionByTokenHash(
    tokenHash: string,
  ): Promise<RefreshSessionRecord | null>;
  revokeRefreshSession(id: string): Promise<void>;
  recordAudit(entry: AuthAuditEntry): Promise<void>;
}

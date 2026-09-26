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
  /**
   * SP2 §5.2：密码是否由用户本人设置过。
   * false = 系统生成（存量随机密码账号 / 手机与微信自动建号 / 管理员建号）→ 改密免验原密码；
   * true  = 用户本人设过 → 改密必须校验原密码。
   */
  passwordSetByUser: boolean;
  status: "ACTIVE" | "DISABLED";
  roles: readonly string[];
  /** S3c-2：补绑/合并需要知道当前账号是否已经绑了微信。 */
  wechatOpenid?: string | null;
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

/** SP2 §5.1：自助注册只建 CUSTOMER；手机号可选，给了就必须带 phoneEnc/phoneHash 一并落库。 */
export interface RegisterTenantCustomerInput {
  username: string;
  passwordHash: string;
  displayName: string;
  phoneEnc?: string;
  phoneHash?: string;
}

/** S3c-1：微信授权 state 的服务端记录（预认证表，不启用 RLS）。 */
export interface WechatLoginStateRecord {
  id: string;
  tenantId: string;
  returnTo: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface BindPhoneInput {
  phoneEnc: string;
  phoneHash: string;
}

export interface NewWechatLoginState {
  tenantId: string;
  stateHash: string;
  returnTo: string;
  expiresAt: Date;
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
  /** SP2 §5.1：注册必须在建号前读到租户状态（停用门店不建号）。 */
  findTenantByCode(
    tenantCode: string,
  ): Promise<{ id: string; status: string } | null>;
  /** SP2 §5.1：单事务写 tenant_accounts + tenant_account_roles(CUSTOMER) + customer_profiles。 */
  registerTenantCustomer(
    tenantId: string,
    input: RegisterTenantCustomerInput,
  ): Promise<TenantAccountRecord>;
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
  setAccountPhone(
    tenantId: string,
    accountId: string,
    input: BindPhoneInput,
  ): Promise<void>;
  /** 把 openid 从 from 迁到 to，并清空 from（(tenantId, wechatOpenid) 唯一约束要求）。 */
  transferWechatOpenid(
    tenantId: string,
    input: { fromAccountId: string; toAccountId: string },
  ): Promise<void>;
  createWechatLoginState(input: NewWechatLoginState): Promise<void>;
  consumeWechatLoginState(
    stateHash: string,
  ): Promise<WechatLoginStateRecord | null>;
  findTenantAccountById(
    accountId: string,
    tenantId?: string | null,
  ): Promise<TenantAccountRecord | null>;
  /** SP2 §5.2：改密写入口，成功后同时把 password_set_by_user 置 true。 */
  updateTenantAccountPassword(
    tenantId: string,
    accountId: string,
    passwordHash: string,
  ): Promise<void>;
  /** SP2 §5.2：平台账号改密（platform_accounts 无 password_set_by_user 列）。 */
  updatePlatformAccountPassword(
    accountId: string,
    passwordHash: string,
  ): Promise<void>;
  createRefreshSession(session: NewRefreshSession): Promise<void>;
  findRefreshSessionByTokenHash(
    tokenHash: string,
  ): Promise<RefreshSessionRecord | null>;
  revokeRefreshSession(id: string): Promise<void>;
  recordAudit(entry: AuthAuditEntry): Promise<void>;
}

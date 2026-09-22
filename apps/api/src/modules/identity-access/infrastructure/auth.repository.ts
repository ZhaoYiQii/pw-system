import type { DbTransaction, PrismaClient } from "@pw/database";
import { withTenantContext } from "@pw/database";
import type {
  AuthAuditEntry,
  AuthRepository,
  NewRefreshSession,
  PlatformAccountRecord,
  RefreshSessionRecord,
  BindPhoneInput,
  NewWechatLoginState,
  RegisterPhoneCustomerInput,
  RegisterWechatCustomerInput,
  TenantAccountRecord,
  WechatLoginStateRecord,
} from "../application/auth-ports.js";

function mapPlatform(row: {
  id: string;
  username: string;
  passwordHash: string;
  status: string;
  role: string;
}): PlatformAccountRecord {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.passwordHash,
    status: row.status as PlatformAccountRecord["status"],
    role: row.role,
  };
}

function mapTenant(row: {
  id: string;
  tenantId: string;
  tenantStatus: string;
  username: string;
  passwordHash: string;
  status: string;
  roles: { role: string }[];
  wechatOpenid?: string | null;
}): TenantAccountRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    tenantStatus: row.tenantStatus as TenantAccountRecord["tenantStatus"],
    username: row.username,
    passwordHash: row.passwordHash,
    status: row.status as TenantAccountRecord["status"],
    roles: row.roles.map((r) => r.role),
    wechatOpenid: row.wechatOpenid ?? null,
  };
}

export class PrismaAuthRepository implements AuthRepository {
  constructor(
    private readonly client: PrismaClient,
    private readonly runtime: PrismaClient,
  ) {}

  async findPlatformAccountByUsername(
    username: string,
  ): Promise<PlatformAccountRecord | null> {
    const row = await this.client.platformAccount.findUnique({
      where: { username },
    });
    return row ? mapPlatform(row) : null;
  }

  async findPlatformAccountById(
    id: string,
  ): Promise<PlatformAccountRecord | null> {
    const row = await this.client.platformAccount.findUnique({ where: { id } });
    return row ? mapPlatform(row) : null;
  }

  async findTenantAccountByCodeAndUsername(
    tenantCode: string,
    username: string,
  ): Promise<TenantAccountRecord | null> {
    // 先经“平台注册表”（tenants 对 pw_runtime 开放 SELECT）解析租户 id/status，
    // 再在租户 GUC 内查询账号，避免运行时角色跨租户/无上下文读 tenant_accounts。
    const tenant = await this.runtime.tenant.findUnique({
      where: { code: tenantCode },
      select: { id: true, status: true },
    });
    if (!tenant) return null;
    return withTenantContext(
      this.runtime,
      tenant.id,
      async (tx: DbTransaction) => {
        const row = await tx.tenantAccount.findFirst({
          where: { tenantId: tenant.id, username },
          include: { roles: true },
        });
        if (!row) return null;
        return mapTenant({
          id: row.id,
          tenantId: row.tenantId,
          tenantStatus: tenant.status,
          username: row.username,
          passwordHash: row.passwordHash,
          status: row.status,
          roles: row.roles,
          wechatOpenid: row.wechatOpenid,
        });
      },
    );
  }

  async findTenantIdByCode(tenantCode: string): Promise<string | null> {
    const tenant = await this.runtime.tenant.findUnique({
      where: { code: tenantCode },
      select: { id: true },
    });
    return tenant?.id ?? null;
  }

  async findTenantAccountByPhoneHash(
    tenantId: string,
    phoneHashValue: string,
  ): Promise<TenantAccountRecord | null> {
    return withTenantContext(
      this.runtime,
      tenantId,
      async (tx: DbTransaction) => {
        const row = await tx.tenantAccount.findFirst({
          where: { tenantId, phoneHash: phoneHashValue },
          include: { roles: true, tenant: { select: { status: true } } },
        });
        if (!row) return null;
        return mapTenant({
          id: row.id,
          tenantId: row.tenantId,
          tenantStatus: row.tenant.status,
          username: row.username,
          passwordHash: row.passwordHash,
          status: row.status,
          roles: row.roles,
          // S3c-2：补绑/合并要看这个字段判断冲突，漏映射会让冲突规则失效（E2E 抓到过）
          wechatOpenid: row.wechatOpenid,
        });
      },
    );
  }

  async registerPhoneCustomer(
    tenantId: string,
    input: RegisterPhoneCustomerInput,
  ): Promise<TenantAccountRecord> {
    return withTenantContext(
      this.runtime,
      tenantId,
      async (tx: DbTransaction) => {
        const account = await tx.tenantAccount.create({
          data: {
            tenantId,
            username: input.username,
            passwordHash: input.passwordHash,
            phoneEnc: input.phoneEnc,
            phoneHash: input.phoneHash,
            roles: { create: [{ tenantId, role: "CUSTOMER" }] },
          },
          include: { roles: true },
        });
        await tx.customerProfile.create({
          data: {
            tenantId,
            tenantAccountId: account.id,
            name: input.displayName,
            mobileEnc: input.phoneEnc,
            mobileHash: input.phoneHash,
          },
        });
        const tenant = await tx.tenant.findUnique({
          where: { id: tenantId },
          select: { status: true },
        });
        return mapTenant({
          id: account.id,
          tenantId: account.tenantId,
          tenantStatus: tenant?.status ?? "ACTIVE",
          username: account.username,
          passwordHash: account.passwordHash,
          status: account.status,
          roles: account.roles,
          wechatOpenid: account.wechatOpenid,
        });
      },
    );
  }

  async findTenantAccountByOpenid(
    tenantId: string,
    openid: string,
  ): Promise<TenantAccountRecord | null> {
    return withTenantContext(
      this.runtime,
      tenantId,
      async (tx: DbTransaction) => {
        const row = await tx.tenantAccount.findFirst({
          where: { tenantId, wechatOpenid: openid },
          include: { roles: true, tenant: { select: { status: true } } },
        });
        if (!row) return null;
        return mapTenant({
          id: row.id,
          tenantId: row.tenantId,
          tenantStatus: row.tenant.status,
          username: row.username,
          passwordHash: row.passwordHash,
          status: row.status,
          roles: row.roles,
          wechatOpenid: row.wechatOpenid,
        });
      },
    );
  }

  async registerWechatCustomer(
    tenantId: string,
    input: RegisterWechatCustomerInput,
  ): Promise<TenantAccountRecord> {
    return withTenantContext(
      this.runtime,
      tenantId,
      async (tx: DbTransaction) => {
        const account = await tx.tenantAccount.create({
          data: {
            tenantId,
            username: input.username,
            passwordHash: input.passwordHash,
            wechatOpenid: input.wechatOpenid,
            roles: { create: [{ tenantId, role: "CUSTOMER" }] },
          },
          include: { roles: true },
        });
        await tx.customerProfile.create({
          data: {
            tenantId,
            tenantAccountId: account.id,
            name: input.displayName,
          },
        });
        const tenant = await tx.tenant.findUnique({
          where: { id: tenantId },
          select: { status: true },
        });
        return mapTenant({
          id: account.id,
          tenantId: account.tenantId,
          tenantStatus: tenant?.status ?? "ACTIVE",
          username: account.username,
          passwordHash: account.passwordHash,
          status: account.status,
          roles: account.roles,
          wechatOpenid: account.wechatOpenid,
        });
      },
    );
  }

  /** 补绑手机号：账号表与客户档案一起改，避免后台看到两处号码不一致。 */
  async setAccountPhone(
    tenantId: string,
    accountId: string,
    input: BindPhoneInput,
  ): Promise<void> {
    await withTenantContext(
      this.runtime,
      tenantId,
      async (tx: DbTransaction) => {
        await tx.tenantAccount.update({
          where: { id: accountId },
          data: { phoneEnc: input.phoneEnc, phoneHash: input.phoneHash },
        });
        await tx.customerProfile.updateMany({
          where: { tenantId, tenantAccountId: accountId },
          data: { mobileEnc: input.phoneEnc, mobileHash: input.phoneHash },
        });
      },
    );
  }

  /**
   * 迁移 openid：先清源、后写目标（同一事务）。
   * 顺序不能反——(tenant_id, wechat_openid) 是唯一索引，先写目标会撞上源那一行。
   */
  async transferWechatOpenid(
    tenantId: string,
    input: { fromAccountId: string; toAccountId: string },
  ): Promise<void> {
    await withTenantContext(
      this.runtime,
      tenantId,
      async (tx: DbTransaction) => {
        const from = await tx.tenantAccount.findUnique({
          where: { id: input.fromAccountId },
          select: { wechatOpenid: true },
        });
        if (!from?.wechatOpenid) {
          throw new Error("source account has no wechat openid to transfer");
        }
        await tx.tenantAccount.update({
          where: { id: input.fromAccountId },
          data: { wechatOpenid: null },
        });
        await tx.tenantAccount.update({
          where: { id: input.toAccountId },
          data: { wechatOpenid: from.wechatOpenid },
        });
      },
    );
  }

  /** 预认证表：不带租户上下文写入（此时还没有会话），靠行内 tenant_id 做后续校验。 */
  async createWechatLoginState(input: NewWechatLoginState): Promise<void> {
    await this.runtime.wechatLoginState.create({
      data: {
        tenantId: input.tenantId,
        stateHash: input.stateHash,
        returnTo: input.returnTo,
        expiresAt: input.expiresAt,
      },
    });
  }

  /**
   * 单次消费：先看是否存在/过期，再用 updateMany 抢一次。
   * 并发下只有一个请求能把 consumed_at 从 NULL 改成时间戳，其余返回 null。
   */
  async consumeWechatLoginState(
    stateHash: string,
  ): Promise<WechatLoginStateRecord | null> {
    const row = await this.runtime.wechatLoginState.findUnique({
      where: { stateHash },
    });
    if (!row) return null;
    if (row.consumedAt !== null || row.expiresAt.getTime() <= Date.now()) {
      return null;
    }
    const consumedAt = new Date();
    const updated = await this.runtime.wechatLoginState.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt },
    });
    if (updated.count !== 1) return null;
    return {
      id: row.id,
      tenantId: row.tenantId,
      returnTo: row.returnTo,
      expiresAt: row.expiresAt,
      consumedAt,
    };
  }

  async findTenantAccountById(
    accountId: string,
    tenantId?: string | null,
  ): Promise<TenantAccountRecord | null> {
    if (!tenantId) return null;
    return withTenantContext(
      this.runtime,
      tenantId,
      async (tx: DbTransaction) => {
        const row = await tx.tenantAccount.findUnique({
          where: { id: accountId },
          include: { roles: true, tenant: { select: { status: true } } },
        });
        if (!row) return null;
        return mapTenant({
          id: row.id,
          tenantId: row.tenantId,
          tenantStatus: row.tenant.status,
          username: row.username,
          passwordHash: row.passwordHash,
          status: row.status,
          roles: row.roles,
          wechatOpenid: row.wechatOpenid,
        });
      },
    );
  }

  async createRefreshSession(session: NewRefreshSession): Promise<void> {
    await this.client.refreshSession.create({
      data: {
        subjectType: session.subjectType,
        accountId: session.accountId,
        tokenHash: session.tokenHash,
        expiresAt: session.expiresAt,
        ...(session.tenantId !== undefined
          ? { tenantId: session.tenantId }
          : {}),
      },
    });
  }

  async findRefreshSessionByTokenHash(
    tokenHash: string,
  ): Promise<RefreshSessionRecord | null> {
    const row = await this.client.refreshSession.findUnique({
      where: { tokenHash },
    });
    if (!row) return null;
    return {
      id: row.id,
      subjectType: row.subjectType,
      accountId: row.accountId,
      tenantId: row.tenantId,
      tokenHash: row.tokenHash,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
    };
  }

  async revokeRefreshSession(id: string): Promise<void> {
    await this.client.refreshSession.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async recordAudit(entry: AuthAuditEntry): Promise<void> {
    await this.client.auditLog.create({
      data: {
        tenantId: entry.tenantId,
        actorType: entry.actorType ?? "system",
        actorId: entry.actorId ?? null,
        action: entry.action,
        resourceType: entry.resourceType ?? null,
        resourceId: entry.resourceId ?? null,
        summary: entry.summary ? entry.summary.slice(0, 500) : null,
      },
    });
  }
}

import type { DbTransaction, PrismaClient } from "@pw/database";
import { withTenantContext } from "@pw/database";
import type {
  AuthAuditEntry,
  AuthRepository,
  NewRefreshSession,
  PlatformAccountRecord,
  RefreshSessionRecord,
  TenantAccountRecord
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
    role: row.role
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
}): TenantAccountRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    tenantStatus: row.tenantStatus as TenantAccountRecord["tenantStatus"],
    username: row.username,
    passwordHash: row.passwordHash,
    status: row.status as TenantAccountRecord["status"],
    roles: row.roles.map((r) => r.role)
  };
}

export class PrismaAuthRepository implements AuthRepository {
  constructor(
    private readonly client: PrismaClient,
    private readonly runtime: PrismaClient
  ) {}

  async findPlatformAccountByUsername(username: string): Promise<PlatformAccountRecord | null> {
    const row = await this.client.platformAccount.findUnique({ where: { username } });
    return row ? mapPlatform(row) : null;
  }

  async findPlatformAccountById(id: string): Promise<PlatformAccountRecord | null> {
    const row = await this.client.platformAccount.findUnique({ where: { id } });
    return row ? mapPlatform(row) : null;
  }

  async findTenantAccountByCodeAndUsername(
    tenantCode: string,
    username: string
  ): Promise<TenantAccountRecord | null> {
    // 先经“平台注册表”（tenants 对 pw_runtime 开放 SELECT）解析租户 id/status，
    // 再在租户 GUC 内查询账号，避免运行时角色跨租户/无上下文读 tenant_accounts。
    const tenant = await this.runtime.tenant.findUnique({
      where: { code: tenantCode },
      select: { id: true, status: true }
    });
    if (!tenant) return null;
    return withTenantContext(this.runtime, tenant.id, async (tx: DbTransaction) => {
      const row = await tx.tenantAccount.findFirst({
        where: { tenantId: tenant.id, username },
        include: { roles: true }
      });
      if (!row) return null;
      return mapTenant({
        id: row.id,
        tenantId: row.tenantId,
        tenantStatus: tenant.status,
        username: row.username,
        passwordHash: row.passwordHash,
        status: row.status,
        roles: row.roles
      });
    });
  }

  async findTenantAccountById(accountId: string, tenantId?: string | null): Promise<TenantAccountRecord | null> {
    if (!tenantId) return null;
    return withTenantContext(this.runtime, tenantId, async (tx: DbTransaction) => {
      const row = await tx.tenantAccount.findUnique({
        where: { id: accountId },
        include: { roles: true, tenant: { select: { status: true } } }
      });
      if (!row) return null;
      return mapTenant({
        id: row.id,
        tenantId: row.tenantId,
        tenantStatus: row.tenant.status,
        username: row.username,
        passwordHash: row.passwordHash,
        status: row.status,
        roles: row.roles
      });
    });
  }

  async createRefreshSession(session: NewRefreshSession): Promise<void> {
    await this.client.refreshSession.create({
      data: {
        subjectType: session.subjectType,
        accountId: session.accountId,
        tokenHash: session.tokenHash,
        expiresAt: session.expiresAt,
        ...(session.tenantId !== undefined ? { tenantId: session.tenantId } : {})
      }
    });
  }

  async findRefreshSessionByTokenHash(tokenHash: string): Promise<RefreshSessionRecord | null> {
    const row = await this.client.refreshSession.findUnique({ where: { tokenHash } });
    if (!row) return null;
    return {
      id: row.id,
      subjectType: row.subjectType,
      accountId: row.accountId,
      tenantId: row.tenantId,
      tokenHash: row.tokenHash,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt
    };
  }

  async revokeRefreshSession(id: string): Promise<void> {
    await this.client.refreshSession.update({
      where: { id },
      data: { revokedAt: new Date() }
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
        summary: entry.summary ? entry.summary.slice(0, 500) : null
      }
    });
  }
}
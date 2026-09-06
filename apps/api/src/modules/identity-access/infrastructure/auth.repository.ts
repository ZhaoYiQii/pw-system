import type { PrismaClient } from "@pw/database";
import type {
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
  username: string;
  passwordHash: string;
  status: string;
  roles: { role: string }[];
}): TenantAccountRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    username: row.username,
    passwordHash: row.passwordHash,
    status: row.status as TenantAccountRecord["status"],
    roles: row.roles.map((r) => r.role)
  };
}

export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly client: PrismaClient) {}

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
    const row = await this.client.tenantAccount.findFirst({
      where: { username, tenant: { code: tenantCode } },
      include: { roles: true }
    });
    return row ? mapTenant(row) : null;
  }

  async findTenantAccountById(accountId: string): Promise<TenantAccountRecord | null> {
    const row = await this.client.tenantAccount.findUnique({
      where: { id: accountId },
      include: { roles: true }
    });
    return row ? mapTenant(row) : null;
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
}

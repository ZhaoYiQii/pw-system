import type { DbTransaction, PrismaClient } from "@pw/database";
import { withTenantContext } from "@pw/database";
import { hashPassword } from "../infrastructure/password.js";
import { ROLE_KEYS, type RoleKey } from "../domain/roles.js";

export const TENANT_ACCOUNT_ROLES = ROLE_KEYS.filter(
  (role) => role !== "PLATFORM_SUPER_ADMIN" && role !== "PLATFORM_SUPPORT",
) as readonly RoleKey[];

export type TenantAccountRoleKey = (typeof TENANT_ACCOUNT_ROLES)[number];

export interface TenantAccountInput {
  username: string;
  password?: string;
  roles: string[];
}

export interface TenantAccountView {
  id: string;
  tenantId: string;
  username: string;
  status: "ACTIVE" | "DISABLED";
  roles: TenantAccountRoleKey[];
  createdAt: Date;
  updatedAt: Date;
}

export class TenantAccountValidationError extends Error {}
export class TenantAccountNotFoundError extends Error {}
export class TenantAccountConflictError extends Error {}

function normalizeRoles(roles: unknown[]): TenantAccountRoleKey[] {
  const seen = new Set<TenantAccountRoleKey>();
  for (const raw of roles) {
    const role = String(raw);
    if (!(TENANT_ACCOUNT_ROLES as readonly string[]).includes(role)) {
      throw new TenantAccountValidationError(`非法角色：${role}`);
    }
    seen.add(role as TenantAccountRoleKey);
  }
  return Array.from(seen);
}

function assertUsername(username: string): string {
  const name = username.trim();
  if (!/^[a-zA-Z0-9_-]{2,64}$/.test(name)) {
    throw new TenantAccountValidationError(
      "用户名需为 2-64 位字母/数字/_/-",
    );
  }
  return name;
}

function assertPassword(password: string | undefined): string {
  if (password === undefined) {
    throw new TenantAccountValidationError("新账号必须设置密码");
  }
  if (password.length < 8 || password.length > 128) {
    throw new TenantAccountValidationError("密码长度需为 8-128 字符");
  }
  return password;
}

export class TenantAccountsService {
  constructor(private readonly client: PrismaClient) {}

  async list(tenantId: string, keyword?: string): Promise<TenantAccountView[]> {
    return withTenantContext(
      this.client,
      tenantId,
      async (tx: DbTransaction) => {
        const rows = await tx.tenantAccount.findMany({
          where: {
            tenantId,
            ...(keyword && keyword.trim()
              ? { username: { contains: keyword.trim(), mode: "insensitive" } }
              : {}),
          },
          include: { roles: { select: { role: true } } },
          orderBy: { createdAt: "asc" },
        });
        return rows.map(mapRow);
      },
    );
  }

  async create(
    tenantId: string,
    input: TenantAccountInput,
  ): Promise<TenantAccountView> {
    const username = assertUsername(input.username);
    const password = assertPassword(input.password);
    const roles = normalizeRoles(input.roles);
    if (roles.length === 0) {
      throw new TenantAccountValidationError("至少需要一个角色");
    }
    return withTenantContext(
      this.client,
      tenantId,
      async (tx: DbTransaction) => {
        const dup = await tx.tenantAccount.findFirst({
          where: { tenantId, username },
          select: { id: true },
        });
        if (dup) {
          throw new TenantAccountConflictError("同门店下用户名已存在");
        }
        await this.assertOwnerSlot(tx, tenantId, roles);
        const passwordHash = await hashPassword(password);
        const created = await tx.tenantAccount.create({
          data: {
            tenantId,
            username,
            passwordHash,
            roles: {
              create: roles.map((role) => ({ tenantId, role })),
            },
          },
          include: { roles: { select: { role: true } } },
        });
        return mapRow(created);
      },
    );
  }

  async setStatus(
    tenantId: string,
    accountId: string,
    status: "ACTIVE" | "DISABLED",
    actorAccountId: string,
  ): Promise<TenantAccountView> {
    if (accountId === actorAccountId) {
      throw new TenantAccountConflictError("不能停用/启用当前登录账号");
    }
    return withTenantContext(
      this.client,
      tenantId,
      async (tx: DbTransaction) => {
        await this.findTx(tx, tenantId, accountId);
        const updated = await tx.tenantAccount.update({
          where: { id: accountId },
          data: { status },
          include: { roles: { select: { role: true } } },
        });
        return mapRow(updated);
      },
    );
  }

  async setRoles(
    tenantId: string,
    accountId: string,
    rolesInput: unknown[],
    actorAccountId: string,
  ): Promise<TenantAccountView> {
    if (accountId === actorAccountId) {
      throw new TenantAccountConflictError("不能修改当前登录账号的角色");
    }
    const roles = normalizeRoles(rolesInput);
    if (roles.length === 0) {
      throw new TenantAccountValidationError("至少保留一个角色");
    }
    return withTenantContext(
      this.client,
      tenantId,
      async (tx: DbTransaction) => {
        await this.findTx(tx, tenantId, accountId);
        await this.assertOwnerSlot(tx, tenantId, roles, accountId);
        await tx.tenantAccountRole.deleteMany({
          where: { tenantId, tenantAccountId: accountId },
        });
        await tx.tenantAccountRole.createMany({
          data: roles.map((role) => ({
            tenantId,
            tenantAccountId: accountId,
            role,
          })),
        });
        const updated = await tx.tenantAccount.findUniqueOrThrow({
          where: { id: accountId },
          include: { roles: { select: { role: true } } },
        });
        return mapRow(updated);
      },
    );
  }

  private async findTx(
    tx: DbTransaction,
    tenantId: string,
    accountId: string,
  ) {
    const row = await tx.tenantAccount.findFirst({
      where: { tenantId, id: accountId },
      include: { roles: { select: { role: true } } },
    });
    if (!row) throw new TenantAccountNotFoundError("账号不存在");
    return row;
  }

  private async assertOwnerSlot(
    tx: DbTransaction,
    tenantId: string,
    roles: TenantAccountRoleKey[],
    excludeAccountId?: string,
  ): Promise<void> {
    if (!roles.includes("TENANT_OWNER")) return;
    const existing = await tx.tenantAccount.findFirst({
      where: {
        tenantId,
        status: "ACTIVE",
        ...(excludeAccountId ? { id: { not: excludeAccountId } } : {}),
        roles: { some: { role: "TENANT_OWNER" } },
      },
      select: { id: true, username: true },
    });
    if (existing) {
      throw new TenantAccountConflictError(
        `门店已存在店主账号 ${existing.username}，请先调整后再变更`,
      );
    }
  }
}

function mapRow(row: {
  id: string;
  tenantId: string;
  username: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  roles: Array<{ role: string }>;
}): TenantAccountView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    username: row.username,
    status: row.status as TenantAccountView["status"],
    roles: row.roles.map(
      (r) => r.role as TenantAccountRoleKey,
    ),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

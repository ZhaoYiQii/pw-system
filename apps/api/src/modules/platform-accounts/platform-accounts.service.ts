import type { PrismaClient } from "@pw/database";
import { hashPassword } from "../identity-access/infrastructure/password.js";

const PLATFORM_ROLE_VALUES = [
  "PLATFORM_SUPER_ADMIN",
  "PLATFORM_SUPPORT",
] as const;
type PlatformRole = (typeof PLATFORM_ROLE_VALUES)[number];
const PLATFORM_ROLES = new Set<string>(PLATFORM_ROLE_VALUES);
const ACCOUNT_STATUSES = new Set<string>(["ACTIVE", "DISABLED"]);
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{2,31}$/;

export interface PlatformAccountView {
  id: string;
  username: string;
  role: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export class PlatformAccountsService {
  constructor(private readonly client: PrismaClient) {}

  async list(): Promise<PlatformAccountView[]> {
    const rows = await this.client.platformAccount.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        username: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return rows;
  }

  async create(
    actorId: string,
    input: { username: unknown; password: unknown; role: unknown },
  ): Promise<PlatformAccountView> {
    const username =
      typeof input.username === "string" ? input.username.trim() : "";
    const password =
      typeof input.password === "string" ? input.password : "";
    const role = this.platformRole(input.role, "role");
    if (!USERNAME_PATTERN.test(username))
      throw new Error(
        "账号需为 3-32 位小写字母/数字开头，可用 _ 或 -",
      );
    if (password.length < 8 || password.length > 128)
      throw new Error("初始密码长度需为 8-128 位");

    const passwordHash = await hashPassword(password);
    try {
      const created = await this.client.platformAccount.create({
        data: {
          username,
          passwordHash,
          role,
          status: "ACTIVE",
        },
      });
      await this.recordAudit(
        actorId,
        "platform.account.create",
        `创建平台账号 ${created.username}（${created.role}）`,
      );
      return this.view(created);
    } catch (error) {
      if (this.isUniqueViolation(error))
        throw new Error(`账号 ${username} 已存在`);
      throw error;
    }
  }

  async setStatus(
    actorId: string,
    accountId: string,
    status: unknown,
  ): Promise<PlatformAccountView> {
    if (typeof status !== "string" || !ACCOUNT_STATUSES.has(status))
      throw new Error("status 需为 ACTIVE 或 DISABLED");
    const account = await this.client.platformAccount.findUnique({
      where: { id: accountId },
    });
    if (!account) throw new NotFoundError("平台账号不存在");
    if (accountId === actorId && status === "DISABLED")
      throw new Error("不能停用自己的账号");
    if (account.status === "ACTIVE" && status === "DISABLED") {
      await this.assertNotLastActiveSuperAdmin(accountId);
    }
    const updated = await this.client.platformAccount.update({
      where: { id: accountId },
      data: { status: status as "ACTIVE" | "DISABLED" },
    });
    await this.recordAudit(
      actorId,
      "platform.account.status",
      `${status === "ACTIVE" ? "启用" : "停用"}平台账号 ${updated.username}`,
    );
    return this.view(updated);
  }

  async setRole(
    actorId: string,
    accountId: string,
    role: unknown,
  ): Promise<PlatformAccountView> {
    const nextRole = this.platformRole(role, "role");
    const account = await this.client.platformAccount.findUnique({
      where: { id: accountId },
    });
    if (!account) throw new NotFoundError("平台账号不存在");
    if (accountId === actorId)
      throw new Error("不能修改自己的角色");
    if (
      account.role === "PLATFORM_SUPER_ADMIN" &&
      nextRole !== "PLATFORM_SUPER_ADMIN"
    ) {
      await this.assertNotLastActiveSuperAdmin(accountId);
    }
    const updated = await this.client.platformAccount.update({
      where: { id: accountId },
      data: { role: nextRole },
    });
    await this.recordAudit(
      actorId,
      "platform.account.role",
      `变更平台账号 ${updated.username} 角色为 ${updated.role}`,
    );
    return this.view(updated);
  }

  private async assertNotLastActiveSuperAdmin(accountId: string) {
    const activeSuperAdmins = await this.client.platformAccount.count({
      where: { role: "PLATFORM_SUPER_ADMIN", status: "ACTIVE" },
    });
    if (activeSuperAdmins <= 1) {
      const target = await this.client.platformAccount.findUnique({
        where: { id: accountId },
      });
      if (target?.role === "PLATFORM_SUPER_ADMIN") {
        throw new Error("必须保留至少一个启用的超级管理员");
      }
    }
  }

  private platformRole(role: unknown, label: string): PlatformRole {
    if (typeof role !== "string" || !PLATFORM_ROLES.has(role)) {
      throw new Error(`${label} 需为 PLATFORM_SUPER_ADMIN 或 PLATFORM_SUPPORT`);
    }
    return role as PlatformRole;
  }

  private async recordAudit(
    actorId: string,
    action: string,
    summary: string,
  ): Promise<void> {
    await this.client.platformAuditEvent.create({
      data: {
        actorPlatformAccountId: actorId,
        action,
        summary,
      },
    });
  }

  private view(
    row: {
      id: string;
      username: string;
      role: string;
      status: string;
      createdAt: Date;
      updatedAt: Date;
    },
  ): PlatformAccountView {
    return {
      id: row.id,
      username: row.username,
      role: row.role,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    );
  }
}

export class NotFoundError extends Error {}

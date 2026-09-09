import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { PrismaClient } from "@pw/database";
import type { AccessPrincipal } from "../identity-access/domain/principal.js";

const GRANT_MINUTES = new Set<number>([30, 120, 480, 1440]);

export interface PlatformGrantView {
  id: string;
  grantorUsername: string | null;
  granteeId: string;
  granteeUsername: string;
  tenantId: string;
  tenantCode: string | null;
  tenantName: string;
  reason: string;
  scope: string;
  status: string;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedBy: string | null;
  createdAt: Date;
}

export class PlatformGrantsService {
  constructor(private readonly client: PrismaClient) {}

  async list(): Promise<PlatformGrantView[]> {
    const grants = await this.client.platformAccessGrant.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    if (grants.length === 0) return [];
    const accountIds = new Set<string>();
    const tenantIds = new Set<string>();
    for (const grant of grants) {
      accountIds.add(grant.grantorPlatformAccountId);
      accountIds.add(grant.granteePlatformAccountId);
      if (grant.revokedBy) accountIds.add(grant.revokedBy);
      tenantIds.add(grant.tenantId);
    }
    const [accounts, tenants] = await Promise.all([
      this.client.platformAccount.findMany({
        where: { id: { in: [...accountIds] } },
        select: { id: true, username: true },
      }),
      this.client.tenant.findMany({
        where: { id: { in: [...tenantIds] } },
        select: { id: true, code: true, name: true },
      }),
    ]);
    const accountMap = new Map(
      accounts.map((account) => [account.id, account]),
    );
    const tenantMap = new Map(tenants.map((tenant) => [tenant.id, tenant]));
    return grants.map((grant) => ({
      id: grant.id,
      grantorUsername:
        accountMap.get(grant.grantorPlatformAccountId)?.username ?? null,
      granteeId: grant.granteePlatformAccountId,
      granteeUsername:
        accountMap.get(grant.granteePlatformAccountId)?.username ??
        grant.granteePlatformAccountId,
      tenantId: grant.tenantId,
      tenantCode: tenantMap.get(grant.tenantId)?.code ?? null,
      tenantName: tenantMap.get(grant.tenantId)?.name ?? "未知门店",
      reason: grant.reason,
      scope: grant.scope,
      status: grant.status,
      expiresAt: grant.expiresAt,
      revokedAt: grant.revokedAt,
      revokedBy: grant.revokedBy
        ? (accountMap.get(grant.revokedBy)?.username ?? grant.revokedBy)
        : null,
      createdAt: grant.createdAt,
    }));
  }

  async create(
    actorId: string,
    input: {
      granteeAccountId: unknown;
      tenantId: unknown;
      reason: unknown;
      durationMinutes: unknown;
    },
  ): Promise<PlatformGrantView> {
    const granteeAccountId = String(input.granteeAccountId ?? "");
    const tenantId = String(input.tenantId ?? "");
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    const durationMinutes = Number(input.durationMinutes);
    if (!/^[0-9a-fA-F-]{36}$/.test(granteeAccountId))
      throw new Error("授权账号不合法");
    if (!/^[0-9a-fA-F-]{36}$/.test(tenantId)) throw new Error("目标门店不合法");
    if (reason.length < 4 || reason.length > 200)
      throw new Error("授权原因需为 4-200 字符");
    if (
      !Number.isInteger(durationMinutes) ||
      !GRANT_MINUTES.has(durationMinutes)
    )
      throw new Error("有效时长仅支持 30 分钟/2 小时/8 小时/24 小时");

    const [grantee, tenant] = await Promise.all([
      this.client.platformAccount.findUnique({
        where: { id: granteeAccountId },
      }),
      this.client.tenant.findUnique({ where: { id: tenantId } }),
    ]);
    if (!grantee) throw new Error("被授权平台账号不存在");
    if (grantee.role !== "PLATFORM_SUPPORT")
      throw new Error("仅可向平台运营角色授予跨租户访问");
    if (grantee.status !== "ACTIVE") throw new Error("被授权账号已停用");
    if (!tenant) throw new Error("目标门店不存在");

    const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000);
    const created = await this.client.platformAccessGrant.create({
      data: {
        grantorPlatformAccountId: actorId,
        granteePlatformAccountId: grantee.id,
        tenantId: tenant.id,
        reason,
        scope: "read",
        status: "ACTIVE",
        expiresAt,
      },
    });
    await this.client.platformAuditEvent.create({
      data: {
        actorPlatformAccountId: actorId,
        action: "access-grant.create",
        summary: `创建 ${grantee.username} → ${tenant.name}(${tenant.code}) ${durationMinutes} 分钟只读临时授权：${reason.slice(0, 160)}`,
      },
    });
    const view = await this.list();
    return (
      view.find((item) => item.id === created.id) ??
      this.toSingleView(created, grantee, tenant)
    );
  }

  async revoke(actorId: string, grantId: string): Promise<PlatformGrantView> {
    const grant = await this.client.platformAccessGrant.findUnique({
      where: { id: grantId },
    });
    if (!grant) throw new Error("临时授权不存在");
    if (grant.status === "REVOKED") throw new Error("该授权已撤销");
    const updated = await this.client.platformAccessGrant.update({
      where: { id: grant.id },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
        revokedBy: actorId,
      },
    });
    const [grantee, tenant] = await Promise.all([
      this.client.platformAccount.findUnique({
        where: { id: updated.granteePlatformAccountId },
      }),
      this.client.tenant.findUnique({ where: { id: updated.tenantId } }),
    ]);
    await this.client.platformAuditEvent.create({
      data: {
        actorPlatformAccountId: actorId,
        action: "access-grant.revoke",
        summary: `撤销 ${grantee?.username ?? updated.granteePlatformAccountId} → ${tenant?.name ?? updated.tenantId} 临时授权`,
      },
    });
    const view = await this.list();
    return (
      view.find((item) => item.id === updated.id) ??
      this.toSingleView(updated, grantee ?? null, tenant ?? null)
    );
  }

  /** 平台运营读取目标门店明细/审计前必须存在未过期、未撤销的临时授权；超管直接放行。 */
  async assertTenantReadAllowed(
    principal: AccessPrincipal | undefined,
    tenantId: string,
  ): Promise<void> {
    if (!principal) throw new UnauthorizedException();
    if (principal.scope !== "platform")
      throw new ForbiddenException("仅平台账号可执行该操作");
    if (principal.role === "PLATFORM_SUPER_ADMIN") return;
    if (principal.role !== "PLATFORM_SUPPORT")
      throw new ForbiddenException("当前角色无跨租户访问权限");
    const grant = await this.client.platformAccessGrant.findFirst({
      where: {
        granteePlatformAccountId: principal.sub,
        tenantId,
        status: "ACTIVE",
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!grant)
      throw new ForbiddenException(
        "该运营账号没有目标门店的生效临时授权，请先由超级管理员创建授权",
      );
  }

  private toSingleView(
    row: {
      id: string;
      grantorPlatformAccountId: string;
      granteePlatformAccountId: string;
      tenantId: string;
      reason: string;
      scope: string;
      status: string;
      expiresAt: Date;
      revokedAt: Date | null;
      revokedBy: string | null;
      createdAt: Date;
    },
    grantee: { id: string; username: string } | null,
    tenant: { id: string; code: string; name: string } | null,
  ): PlatformGrantView {
    return {
      id: row.id,
      grantorUsername: null,
      granteeId: row.granteePlatformAccountId,
      granteeUsername: grantee?.username ?? row.granteePlatformAccountId,
      tenantId: row.tenantId,
      tenantCode: tenant?.code ?? null,
      tenantName: tenant?.name ?? "未知门店",
      reason: row.reason,
      scope: row.scope,
      status: row.status,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      revokedBy: row.revokedBy,
      createdAt: row.createdAt,
    };
  }
}

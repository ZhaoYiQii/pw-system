import { safeParseTenantConfig } from "@pw/config-schema";
import type { PrismaClient } from "@pw/database";
import { packageByCode } from "../platform-billing/packages.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PlatformOverviewResult {
  tenants: {
    total: number;
    active: number;
    configError: number;
    inactive: number;
    monthNew: number;
  };
  expiringSoon: number;
  health: {
    outboxPending: number;
    outboxFailed: number;
    storageBytes: number | null;
  };
}

export interface PlatformSubscriptionRow {
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  tenantStatus: string;
  subscriptionId: string | null;
  packageCode: string | null;
  packageName: string | null;
  subscriptionStatus: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  orderCount: number;
  storageBytes: number | null;
}

export interface PlatformTenantDetail {
  id: string;
  code: string;
  name: string;
  status: string;
  timezone: string;
  createdAt: Date;
  primaryHost: string | null;
  ownerUsername: string | null;
  packageCode: string | null;
  packageName: string | null;
  subscriptionStatus: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  platformFeeBp: number | null;
  storeCutBp: number | null;
  brandPrimary: string | null;
  brandAccent: string | null;
  logoText: string | null;
}

function inCurrentMonth(value: Date): boolean {
  const now = new Date();
  return (
    value.getFullYear() === now.getFullYear() &&
    value.getMonth() === now.getMonth()
  );
}

export class PlatformOpsService {
  constructor(private readonly client: PrismaClient) {}

  async overview(): Promise<PlatformOverviewResult> {
    const [tenants, expiringSoon, outboxPending, outboxFailed, storage] =
      await Promise.all([
        this.client.tenant.findMany({
          select: { status: true, createdAt: true },
        }),
        this.client.tenantSubscription.count({
          where: {
            status: "ACTIVE",
            endsAt: {
              gt: new Date(),
              lte: new Date(Date.now() + 7 * DAY_MS),
            },
          },
        }),
        this.client.outboxEvent.count({ where: { status: "PENDING" } }),
        this.client.outboxEvent.count({ where: { status: "FAILED" } }),
        this.client.evidenceAsset.aggregate({
          _sum: { sizeBytes: true },
        }),
      ]);

    return {
      tenants: {
        total: tenants.length,
        active: tenants.filter((t) => t.status === "ACTIVE").length,
        configError: tenants.filter((t) => t.status === "CONFIG_ERROR").length,
        inactive: tenants.filter((t) => t.status === "INACTIVE").length,
        monthNew: tenants.filter((t) => inCurrentMonth(t.createdAt)).length,
      },
      expiringSoon,
      health: {
        outboxPending,
        outboxFailed,
        storageBytes: storage._sum.sizeBytes ?? null,
      },
    };
  }

  async subscriptions(): Promise<PlatformSubscriptionRow[]> {
    const [tenants, subscriptions, orderGroups, storageGroups] =
      await Promise.all([
        this.client.tenant.findMany({
          orderBy: { createdAt: "asc" },
          select: { id: true, code: true, name: true, status: true },
        }),
        this.client.tenantSubscription.findMany({
          where: { status: "ACTIVE" },
          orderBy: { createdAt: "desc" },
        }),
        this.client.order.groupBy({
          by: ["tenantId"],
          _count: { _all: true },
        }),
        this.client.evidenceAsset.groupBy({
          by: ["tenantId"],
          _sum: { sizeBytes: true },
        }),
      ]);

    const subByTenant = new Map(
      subscriptions.map((sub) => [sub.tenantId, sub]),
    );
    const orderMap = new Map(
      orderGroups.map((row) => [row.tenantId, row._count._all]),
    );
    const storageMap = new Map(
      storageGroups.map((row) => [row.tenantId, row._sum.sizeBytes]),
    );

    return tenants.map((tenant) => {
      const sub = subByTenant.get(tenant.id) ?? null;
      const pkg = sub ? packageByCode(sub.packageCode) : undefined;
      return {
        tenantId: tenant.id,
        tenantCode: tenant.code,
        tenantName: tenant.name,
        tenantStatus: tenant.status,
        subscriptionId: sub?.id ?? null,
        packageCode: sub?.packageCode ?? null,
        packageName: pkg?.name ?? null,
        subscriptionStatus: sub?.status ?? null,
        startsAt: sub?.startsAt ?? null,
        endsAt: sub?.endsAt ?? null,
        orderCount: orderMap.get(tenant.id) ?? 0,
        storageBytes: storageMap.get(tenant.id) ?? null,
      };
    });
  }

  async tenantDetail(tenantId: string): Promise<PlatformTenantDetail | null> {
    const tenant = await this.client.tenant.findUnique({
      where: { id: tenantId },
      include: {
        domains: { orderBy: { createdAt: "asc" } },
        accounts: {
          include: { roles: true },
        },
      },
    });
    if (!tenant) return null;

    const [subscription, config, rule] = await Promise.all([
      this.client.tenantSubscription.findFirst({
        where: { tenantId, status: "ACTIVE" },
        orderBy: { createdAt: "desc" },
      }),
      this.client.tenantConfigVersion.findFirst({
        where: { tenantId, status: "ACTIVE" },
        orderBy: { version: "desc" },
      }),
      this.client.financeRateRule.findFirst({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const primaryDomain =
      tenant.domains.find((d) => d.isPrimary) ?? tenant.domains[0] ?? null;
    const owner =
      tenant.accounts.find((account) =>
        account.roles.some((role) => role.role === "TENANT_OWNER"),
      ) ?? null;
    const parsedConfig = config ? safeParseTenantConfig(config.config) : null;
    const pkg = subscription ? packageByCode(subscription.packageCode) : undefined;

    return {
      id: tenant.id,
      code: tenant.code,
      name: tenant.name,
      status: tenant.status,
      timezone: tenant.timezone,
      createdAt: tenant.createdAt,
      primaryHost: primaryDomain?.host ?? null,
      ownerUsername: owner?.username ?? null,
      packageCode: subscription?.packageCode ?? null,
      packageName: pkg?.name ?? null,
      subscriptionStatus: subscription?.status ?? null,
      startsAt: subscription?.startsAt ?? null,
      endsAt: subscription?.endsAt ?? null,
      platformFeeBp: rule?.platformFeeBp ?? null,
      storeCutBp: rule?.storeCutBp ?? null,
      brandPrimary: parsedConfig?.success ? parsedConfig.data.brand.primaryColor : null,
      brandAccent: parsedConfig?.success ? parsedConfig.data.brand.accentColor : null,
      logoText: parsedConfig?.success ? parsedConfig.data.brand.logoText : null,
    };
  }
}

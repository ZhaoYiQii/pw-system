import type { Prisma, PrismaClient } from "@pw/database";

const MOBILE = /(1[3-9][0-9]{9})/g;
const SECRET_VALUE = /(password|secret|token)(["'\s:=]+)([^\s,;]+)/gi;

function redactSummary(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .replace(MOBILE, (m) => m.slice(0, 3) + "****" + m.slice(-4))
    .replace(SECRET_VALUE, "$1$2***");
}

export interface AuditInput {
  tenantId: string;
  actorType: string | null | undefined;
  actorId: string | null | undefined;
  action: string;
  resourceType?: string;
  resourceId?: string;
  summary?: string;
}

export interface PlatformAuditAggregateRow {
  id: string;
  source: "platform" | "tenant";
  createdAt: Date;
  actorId: string | null;
  actorName: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  tenantId: string | null;
  tenantName: string | null;
  summary: string | null;
}

export interface PlatformAuditAggregateResult {
  rows: PlatformAuditAggregateRow[];
  metrics: {
    todayPlatformEvents: number;
    todayCrossTenantReads: number;
    activeGrants: number;
  };
}

export interface AuditListOptions {
  limit?: number;
  offset?: number;
  action?: string;
  actorType?: string;
  keyword?: string;
  from?: string;
  to?: string;
}

export class AuditService {
  constructor(private readonly client: PrismaClient) {}

  async record(input: AuditInput): Promise<void> {
    await this.client.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorType: input.actorType ?? "system",
        actorId: input.actorId ?? null,
        action: input.action,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        summary: redactSummary(input.summary)?.slice(0, 500) ?? null,
      },
    });
  }

  async list(
    tenantId: string,
    limitOrOptions?: number | AuditListOptions,
  ): Promise<unknown[]> {
    const options: AuditListOptions =
      typeof limitOrOptions === "number"
        ? { limit: limitOrOptions }
        : (limitOrOptions ?? {});
    const limit = Math.min(Math.max(options.limit || 50, 1), 500);
    const fromDate = options.from ? new Date(options.from) : null;
    const toDate = options.to ? new Date(options.to) : null;
    const hasFrom = fromDate !== null && !Number.isNaN(fromDate.getTime());
    const hasTo = toDate !== null && !Number.isNaN(toDate.getTime());
    const where: Prisma.AuditLogWhereInput = {
      tenantId,
      ...(options.action ? { action: options.action } : {}),
      ...(options.actorType ? { actorType: options.actorType } : {}),
      ...(hasFrom || hasTo
        ? {
            createdAt: {
              ...(hasFrom ? { gte: fromDate as Date } : {}),
              ...(hasTo ? { lte: toDate as Date } : {}),
            },
          }
        : {}),
      ...(options.keyword
        ? {
            OR: [
              { summary: { contains: options.keyword, mode: "insensitive" } },
              { action: { contains: options.keyword, mode: "insensitive" } },
              {
                resourceType: {
                  contains: options.keyword,
                  mode: "insensitive",
                },
              },
            ],
          }
        : {}),
    };
    const rows = await this.client.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: Math.max(0, Math.floor(options.offset || 0)),
      take: limit,
    });
    return rows.map((row) => ({
      ...row,
      summary: redactSummary(row.summary),
    }));
  }

  async exportCsv(
    tenantId: string,
    options: AuditListOptions = {},
  ): Promise<string> {
    const rows = (await this.list(tenantId, {
      ...options,
      limit: Math.min(options.limit ?? 2000, 5000),
      offset: 0,
    })) as Array<Record<string, unknown>>;
    const escape = (value: unknown): string => {
      const text = value === null || value === undefined ? "" : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const head = [
      "id",
      "createdAt",
      "actorType",
      "actorId",
      "action",
      "resourceType",
      "resourceId",
      "summary",
    ];
    const lines = [
      head.map(escape).join(","),
      ...rows.map((row) =>
        head
          .map((key) => escape((row as Record<string, unknown>)[key]))
          .join(","),
      ),
    ];
    return lines.join("\n");
  }

  /** 平台级审计汇总：平台账号事件 + 平台跨租户读取事件，供超管审计台/导出使用。 */
  async aggregatePlatform(
    limit: number,
  ): Promise<PlatformAuditAggregateResult> {
    const safeLimit = Math.min(Math.max(limit || 100, 1), 500);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [
      platformEvents,
      tenantLogs,
      accounts,
      tenants,
      todayPlatformEvents,
      todayCrossTenantReads,
      activeGrants,
    ] = await Promise.all([
      this.client.platformAuditEvent.findMany({
        orderBy: { createdAt: "desc" },
        take: safeLimit,
      }),
      this.client.auditLog.findMany({
        where: { actorType: "platform_account" },
        orderBy: { createdAt: "desc" },
        take: safeLimit,
      }),
      this.client.platformAccount.findMany({
        select: { id: true, username: true },
      }),
      this.client.tenant.findMany({
        select: { id: true, name: true, code: true },
      }),
      this.client.platformAuditEvent.count({
        where: { createdAt: { gte: today } },
      }),
      this.client.auditLog.count({
        where: {
          actorType: "platform_account",
          action: "platform.audit.read",
          createdAt: { gte: today },
        },
      }),
      this.client.platformAccessGrant.count({
        where: { status: "ACTIVE", expiresAt: { gt: new Date() } },
      }),
    ]);
    const accountMap = new Map(
      accounts.map((account) => [account.id, account.username]),
    );
    const tenantMap = new Map(tenants.map((tenant) => [tenant.id, tenant]));

    const rows: PlatformAuditAggregateRow[] = [
      ...platformEvents.map((event) => ({
        id: `p-${event.id}`,
        source: "platform" as const,
        createdAt: event.createdAt,
        actorId: event.actorPlatformAccountId,
        actorName:
          accountMap.get(event.actorPlatformAccountId) ??
          event.actorPlatformAccountId,
        action: event.action,
        resourceType: "platform" as const,
        resourceId: null,
        tenantId: null,
        tenantName: null,
        summary: redactSummary(event.summary),
      })),
      ...tenantLogs.map((row) => {
        const tenant = row.tenantId
          ? (tenantMap.get(row.tenantId) ?? null)
          : null;
        const actorId = row.actorId;
        const actorName =
          actorId && accountMap.has(actorId)
            ? (accountMap.get(actorId) ?? actorId)
            : (actorId ?? "system");
        return {
          id: `t-${row.id}`,
          source: "tenant" as const,
          createdAt: row.createdAt,
          actorId,
          actorName,
          action: row.action,
          resourceType: row.resourceType,
          resourceId: row.resourceId,
          tenantId: row.tenantId,
          tenantName: tenant ? `${tenant.name}(${tenant.code})` : null,
          summary: redactSummary(row.summary),
        };
      }),
    ];
    rows.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return {
      rows: rows.slice(0, safeLimit),
      metrics: {
        todayPlatformEvents,
        todayCrossTenantReads,
        activeGrants,
      },
    };
  }
}

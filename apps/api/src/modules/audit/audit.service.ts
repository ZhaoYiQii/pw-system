import type { PrismaClient } from "@pw/database";

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

  async list(tenantId: string, limit: number): Promise<unknown[]> {
    const rows = await this.client.auditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit || 50, 200),
    });
    return rows.map((row) => ({
      ...row,
      summary: redactSummary(row.summary),
    }));
  }
}

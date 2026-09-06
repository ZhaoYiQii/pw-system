import type { PrismaClient } from "@pw/database";

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
        summary: input.summary ? input.summary.slice(0, 500) : null,
      },
    });
  }

  async list(tenantId: string, limit: number): Promise<unknown[]> {
    return this.client.auditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit || 50, 200),
    });
  }
}

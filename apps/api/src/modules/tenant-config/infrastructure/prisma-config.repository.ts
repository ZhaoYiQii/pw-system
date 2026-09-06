import type { PrismaClient } from "@pw/database";
import type { ConfigRepository, ConfigVersionRow } from "../application/config.service.js";
import { NoVersionToRollbackError } from "../domain/errors.js";

export class PrismaConfigRepository implements ConfigRepository {
  constructor(private readonly client: PrismaClient) {}

  async active(tenantId: string) {
    const row = await this.client.tenantConfigVersion.findFirst({
      where: { tenantId, status: "ACTIVE" },
      orderBy: { version: "desc" }
    });
    return row ? { id: row.id, version: row.version, status: row.status, config: row.config } : null;
  }

  async list(tenantId: string): Promise<ConfigVersionRow[]> {
    const rows = await this.client.tenantConfigVersion.findMany({
      where: { tenantId },
      orderBy: { version: "desc" }
    });
    return rows.map((r) => ({ id: r.id, version: r.version, status: r.status, createdAt: r.createdAt }));
  }

  async save(tenantId: string, config: unknown, actorId?: string): Promise<number> {
    return this.client.$transaction(async (tx) => {
      const last = await tx.tenantConfigVersion.findFirst({
        where: { tenantId },
        orderBy: { version: "desc" }
      });
      const next = (last?.version ?? 0) + 1;
      await tx.tenantConfigVersion.updateMany({
        where: { tenantId, status: "ACTIVE" },
        data: { status: "SUPERSEDED" }
      });
      await tx.tenantConfigVersion.create({
        data: {
          tenantId,
          version: next,
          config: config as object,
          ...(actorId !== undefined ? { createdBy: actorId } : {})
        }
      });
      return next;
    });
  }

  async markConfigError(tenantId: string, version: number): Promise<void> {
    await this.client.tenantConfigVersion.updateMany({
      where: { tenantId, version },
      data: { status: "CONFIG_ERROR" }
    });
  }

  async rollback(tenantId: string): Promise<number> {
    return this.client.$transaction(async (tx) => {
      // 生效版本可以是 ACTIVE；若损坏版本已被标记 CONFIG_ERROR（无 ACTIVE），也允许回滚。
      const current =
        (await tx.tenantConfigVersion.findFirst({
          where: { tenantId, status: "ACTIVE" },
          orderBy: { version: "desc" }
        })) ??
        (await tx.tenantConfigVersion.findFirst({
          where: { tenantId, status: "CONFIG_ERROR" },
          orderBy: { version: "desc" }
        }));
      const previous = await tx.tenantConfigVersion.findFirst({
        where: { tenantId, status: "SUPERSEDED" },
        orderBy: { version: "desc" }
      });
      if (!current || !previous) throw new NoVersionToRollbackError();
      await tx.tenantConfigVersion.updateMany({
        where: { tenantId, version: current.version },
        data: { status: "SUPERSEDED" }
      });
      await tx.tenantConfigVersion.updateMany({
        where: { tenantId, version: previous.version },
        data: { status: "ACTIVE" }
      });
      return previous.version;
    });
  }
}


import {
  DEFAULT_TENANT_CONFIG,
  mergeTenantConfig,
  parseTenantConfig,
  safeParseTenantConfig,
  type TenantConfigV1
} from "@pw/config-schema";
import { InvalidTenantConfigError, NoVersionToRollbackError } from "../domain/errors.js";

export interface ConfigVersionRow {
  id: string;
  version: number;
  status: string;
  createdAt: Date;
}

export interface EffectiveConfig {
  status: "ACTIVE" | "CONFIG_ERROR";
  version: number;
  config: TenantConfigV1 | null;
  hasSaved: boolean;
}

export interface ConfigRepository {
  active(tenantId: string): Promise<{ id: string; version: number; status: string; config: unknown } | null>;
  list(tenantId: string): Promise<ConfigVersionRow[]>;
  save(tenantId: string, config: unknown, actorId?: string): Promise<number>;
  markConfigError(tenantId: string, version: number): Promise<void>;
  rollback(tenantId: string): Promise<number>;
}

export class TenantConfigService {
  constructor(private readonly repository: ConfigRepository) {}

  async getEffective(tenantId: string): Promise<EffectiveConfig> {
    const active = await this.repository.active(tenantId);
    if (!active) {
      const rows = await this.repository.list(tenantId);
      if (rows.length > 0) {
        // 已保存过版本但当前无 ACTIVE（例如损坏版本被标记 CONFIG_ERROR 后）：
        // 持续保持 CONFIG_ERROR 而不是回落到默认值，直到修复保存或回滚。
        return { status: "CONFIG_ERROR", version: rows[0]!.version, config: null, hasSaved: true };
      }
      return { status: "ACTIVE", version: 0, config: DEFAULT_TENANT_CONFIG, hasSaved: false };
    }
    const parsed = safeParseTenantConfig(active.config);
    if (!parsed.success) {
      await this.repository.markConfigError(tenantId, active.version);
      return { status: "CONFIG_ERROR", version: active.version, config: null, hasSaved: true };
    }
    return {
      status: "ACTIVE",
      version: active.version,
      config: mergeTenantConfig(DEFAULT_TENANT_CONFIG, parsed.data),
      hasSaved: true
    };
  }

  async save(tenantId: string, raw: unknown, actorId?: string): Promise<EffectiveConfig> {
    let parsed: TenantConfigV1;
    try {
      parsed = parseTenantConfig(raw);
    } catch (error) {
      throw new InvalidTenantConfigError(error instanceof Error ? error.message : "invalid tenant config");
    }
    await this.repository.save(tenantId, parsed, actorId);
    return this.getEffective(tenantId);
  }

  async rollback(tenantId: string): Promise<EffectiveConfig> {
    try {
      await this.repository.rollback(tenantId);
    } catch (error) {
      if (error instanceof NoVersionToRollbackError) throw error;
      throw error;
    }
    return this.getEffective(tenantId);
  }

  async listVersions(tenantId: string): Promise<ConfigVersionRow[]> {
    return this.repository.list(tenantId);
  }
}


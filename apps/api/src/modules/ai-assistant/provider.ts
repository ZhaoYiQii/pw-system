export interface AiCapabilities {
  supported: boolean;
  provider: string;
  reason?: string;
}

export interface RequirementFields {
  description?: string;
  gameId?: string | null;
  serviceProductId?: string | null;
  durationSeconds?: number | null;
  desiredStartAt?: string | null;
  minBudgetFen?: number | null;
  maxBudgetFen?: number | null;
}

export interface ParseResult {
  missing: string[];
  confidenceBp: number;
  note: string;
}

/** AiProviderPort：外部 LLM 接入点。未授权时仅确定性实现，生产能力必须标记 unavailable。 */
export interface AiProviderPort {
  capabilities(): AiCapabilities;
  parseRequirement(input: RequirementFields): Promise<ParseResult>;
}

export function isFieldMissing(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (typeof v === "number" && !Number.isFinite(v));
}

/** 确定性实现：只做结构化缺失检查，不调用外部模型；生产能力由 capabilities()=false 表明不可用。 */
export class DeterministicAiProvider implements AiProviderPort {
  capabilities(): AiCapabilities {
    return { supported: false, provider: "deterministic", reason: "AI_PROVIDER_NOT_CONFIGURED" };
  }

  async parseRequirement(input: RequirementFields): Promise<ParseResult> {
    const missing: string[] = [];
    if (isFieldMissing(input.description)) missing.push("description");
    if (isFieldMissing(input.serviceProductId)) missing.push("serviceProductId");
    if (isFieldMissing(input.durationSeconds)) missing.push("durationSeconds");
    if (isFieldMissing(input.desiredStartAt)) missing.push("desiredStartAt");
    const confidenceBp = missing.length === 0 ? 9000 : Math.max(1000, 9000 - missing.length * 2000);
    return {
      missing,
      confidenceBp,
      note: missing.length === 0 ? "需求字段完整，可进入确认" : `缺少必要需求：${missing.join(", ")}（请补充后确认）`
    };
  }
}
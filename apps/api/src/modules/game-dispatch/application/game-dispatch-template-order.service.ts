/**
 * S4 创建派单的应用服务与持久化端口。
 *
 * 职责边界：
 * - 服务只做无副作用的准备（请求身份哈希）并把领域编排交给仓储；
 * - 仓储在单个事务内完成幂等声明、版本锁定、快照写入、审计与 lastUsedAt 更新。
 */
import { createHash } from "node:crypto";
import type { PublishedConfigV2 } from "../domain/game-template-config-v2.js";
import type { DispatchDocumentV1 } from "../domain/game-template-document.js";
import {
  buildTemplateOrderDraft,
  type TemplateOrderDraft,
} from "../domain/game-template-order-draft.js";

/** 未指定服务时长时的默认值（分钟）。 */
export const DEFAULT_TEMPLATE_ORDER_DURATION_MINUTES = 60;

export interface CreateTemplateOrderInput {
  gameId: string;
  templateId: string;
  templateVersionId: string;
  customerProfileId: string;
  values: Record<string, unknown>;
  desiredStartAt?: string | null;
  durationMinutes?: number;
}

/** 一次创建派单的完整请求身份：幂等键来自 Idempotency-Key 请求头。 */
export interface CreateTemplateOrderCommand {
  tenantId: string;
  actorId: string;
  idempotencyKey: string;
  input: CreateTemplateOrderInput;
  requestHash: string;
}

export interface CreateTemplateOrderResult {
  orderId: string;
  dispatchOrderId: string;
  templateVersionId: string;
  staffingSummary: {
    total: number;
    rows: { label: string; count: number }[];
  };
  priceAdjustmentFen: string;
  document: DispatchDocumentV1;
}

export interface CreateTemplateOrderOutput {
  result: CreateTemplateOrderResult;
  /** true 表示命中同一幂等键并回放首次结果。 */
  duplicate: boolean;
}

export interface GameDispatchTemplateOrderRepository {
  createFromPublishedVersion(
    command: CreateTemplateOrderCommand,
    buildDraft: (
      config: PublishedConfigV2,
      values: Record<string, unknown>,
    ) => TemplateOrderDraft,
  ): Promise<CreateTemplateOrderOutput>;
}

/** 键序无关的规范化 JSON：保证「同一意图」重试得到同一哈希。 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(",")}}`;
}

/** 请求身份：同一幂等键下请求体必须一致，否则 422。 */
export function templateOrderRequestHash(
  input: CreateTemplateOrderInput,
): string {
  const identity = {
    gameId: input.gameId,
    templateId: input.templateId,
    templateVersionId: input.templateVersionId,
    customerProfileId: input.customerProfileId,
    values: input.values,
    desiredStartAt: input.desiredStartAt ?? null,
    durationMinutes:
      input.durationMinutes ?? DEFAULT_TEMPLATE_ORDER_DURATION_MINUTES,
  };
  return createHash("sha256")
    .update(stableStringify(identity), "utf8")
    .digest("hex");
}

export class GameDispatchTemplateOrderService {
  constructor(
    private readonly repository: GameDispatchTemplateOrderRepository,
  ) {}

  /** 锁定发布版本创建派单；人数与价格一律由服务端按快照计算。 */
  async create(
    tenantId: string,
    actorId: string,
    idempotencyKey: string,
    input: CreateTemplateOrderInput,
  ): Promise<CreateTemplateOrderOutput> {
    return this.repository.createFromPublishedVersion(
      {
        tenantId,
        actorId,
        idempotencyKey,
        input,
        requestHash: templateOrderRequestHash(input),
      },
      buildTemplateOrderDraft,
    );
  }
}

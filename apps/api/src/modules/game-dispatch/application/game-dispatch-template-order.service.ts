/**
 * S4 创建派单的应用服务与持久化端口。
 *
 * 职责边界：
 * - 服务只做无副作用的准备（请求身份哈希）并把领域编排交给仓储；
 * - 仓储在单个事务内完成幂等声明、版本锁定、快照写入、审计与 lastUsedAt 更新。
 */
import { createHash } from "node:crypto";
import {
  TEMPLATE_EVENTS,
  emitTemplateEvent,
} from "./game-template-observability.js";
import type { PublishedConfigV2 } from "../domain/game-template-config-v2.js";
import type { DispatchDocumentV1 } from "../domain/game-template-document.js";
import {
  buildTemplateOrderDraftForAudience,
  type TemplateOrderDraftOutcome,
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
    ) => TemplateOrderDraftOutcome,
  ): Promise<CreateTemplateOrderOutput>;
}

/**
 * 端口可见性的写入方端口：当前唯一的下单入口是客服端 `POST template-orders`。
 * 客户自助的 v2 下单面尚不存在；一旦出现，它必须按 CUSTOMER 调用并各自校验必填（V-10）。
 */
export const TEMPLATE_ORDER_WRITER_AUDIENCE = "CS";

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
    // 端口过滤发生在这条回调里（配置只在事务内可见），把被丢弃的键带出来记一条受控事件。
    let droppedKeys: string[] = [];
    try {
      const output = await this.repository.createFromPublishedVersion(
        {
          tenantId,
          actorId,
          idempotencyKey,
          input,
          requestHash: templateOrderRequestHash(input),
        },
        (config, values) => {
          const outcome = buildTemplateOrderDraftForAudience(
            config,
            values,
            TEMPLATE_ORDER_WRITER_AUDIENCE,
          );
          droppedKeys = outcome.droppedKeys;
          return outcome;
        },
      );
      if (droppedKeys.length > 0) {
        emitTemplateEvent(TEMPLATE_EVENTS.FIELD_VALUES_DROPPED, {
          tenantId,
          actorId,
          templateId: input.templateId,
          versionId: input.templateVersionId,
          // 只记录条数：被丢弃的键与值都可能带业务含义，事件白名单不放业务数据。
          count: droppedKeys.length,
          outcome: "ok",
        });
      }
      return output;
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      emitTemplateEvent(TEMPLATE_EVENTS.ORDER_CREATE_FAILED, {
        tenantId,
        actorId,
        templateId: input.templateId,
        versionId: input.templateVersionId,
        ...(typeof code === "string" ? { code } : {}),
        outcome: "failed",
      });
      if (code === "TEMPLATE_VERSION_UNAVAILABLE") {
        emitTemplateEvent(TEMPLATE_EVENTS.VERSION_MISMATCH, {
          tenantId,
          templateId: input.templateId,
          versionId: input.templateVersionId,
          outcome: "failed",
        });
      }
      throw error;
    }
  }
}

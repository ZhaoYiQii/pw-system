/**
 * S4 创建派单的持久化实现。
 *
 * 事务内顺序：幂等声明 → 模板行锁 → 版本/模板归属与归档校验 → 发布配置读取
 * → 领域编排（人数 / 价格 / 文案）→ 订单 + 派单 + 快照 + 幂等结果 + 审计 → lastUsedAt。
 *
 * 幂等语义（api-and-interface-design）：
 * - 唯一索引 [tenantId, idempotencyKey, operation] 才是机制，不做「先查后写」的竞态判断；
 * - 同键同哈希 → 回放首次结果；同键不同哈希 → 422；读到未写入结果的记录 → 409（防御分支）；
 * - 并发同键的第二个请求会在唯一索引上等待先到者提交，随后回放到同一结果（等待而非放行）。
 */
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@pw/database";
import {
  DEFAULT_TEMPLATE_ORDER_DURATION_MINUTES,
  type CreateTemplateOrderCommand,
  type CreateTemplateOrderOutput,
  type CreateTemplateOrderResult,
  type GameDispatchTemplateOrderRepository,
} from "../application/game-dispatch-template-order.service.js";
import { DispatchInputError } from "../domain/dispatch-errors.js";
import { GenericTemplateError } from "../domain/errors.js";
import type { PublishedConfigV2 } from "../domain/game-template-config-v2.js";
import type { TemplateOrderDraft } from "../domain/game-template-order-draft.js";
import { readPublishedConfig } from "../domain/game-template-published-read.js";

const IDEMPOTENCY_OPERATION = "game_dispatch.template_order.create";

function isP2002(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function code(): string {
  return `${Date.now().toString(36).toUpperCase()}${randomBytes(4)
    .toString("hex")
    .toUpperCase()}`;
}

function versionUnavailable(versionId: string): GenericTemplateError {
  return new GenericTemplateError(
    "TEMPLATE_VERSION_UNAVAILABLE",
    "发布版本不存在、不属于该模板或不受支持",
    { versionId },
  );
}

/** 命中幂等记录时回放或拒绝；未写入结果时按处理中拒绝。 */
function replayOrReject(
  row: { responseJson: unknown } | null,
  command: CreateTemplateOrderCommand,
): CreateTemplateOrderOutput | null {
  if (!row) return null;
  const stored = isRecord(row.responseJson) ? row.responseJson : null;
  if (stored === null) {
    throw new GenericTemplateError(
      "TEMPLATE_IDEMPOTENCY_IN_FLIGHT",
      "同一幂等键的请求正在处理中，请稍后重试",
      { idempotencyKey: command.idempotencyKey },
    );
  }
  if (stored.requestHash !== command.requestHash) {
    throw new GenericTemplateError(
      "TEMPLATE_IDEMPOTENCY_MISMATCH",
      "同一幂等键不能用于不同的请求内容",
      { idempotencyKey: command.idempotencyKey },
    );
  }
  return {
    result: stored.result as CreateTemplateOrderResult,
    duplicate: true,
  };
}

export class PrismaGameDispatchTemplateOrderRepository implements GameDispatchTemplateOrderRepository {
  constructor(private readonly client: PrismaClient) {}

  private idempotencyWhere(command: CreateTemplateOrderCommand) {
    return {
      tenantId_idempotencyKey_operation: {
        tenantId: command.tenantId,
        idempotencyKey: command.idempotencyKey,
        operation: IDEMPOTENCY_OPERATION,
      },
    };
  }

  async createFromPublishedVersion(
    command: CreateTemplateOrderCommand,
    buildDraft: (
      config: PublishedConfigV2,
      values: Record<string, unknown>,
    ) => TemplateOrderDraft,
  ): Promise<CreateTemplateOrderOutput> {
    try {
      return await this.client.$transaction(async (tx) => {
        const existing = await tx.idempotencyRecord.findUnique({
          where: this.idempotencyWhere(command),
        });
        const replayed = replayOrReject(existing, command);
        if (replayed) return replayed;

        // 行锁：与发布/归档并发时保持一致的模板状态视图。
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id
          FROM game_dispatch_templates
          WHERE tenant_id = ${command.tenantId}::uuid
            AND id = ${command.input.templateId}::uuid
          FOR UPDATE`;
        if (locked.length === 0) {
          throw new GenericTemplateError("TEMPLATE_NOT_FOUND", "模板不存在", {
            templateId: command.input.templateId,
          });
        }

        const template = await tx.gameDispatchTemplate.findFirst({
          where: { tenantId: command.tenantId, id: command.input.templateId },
        });
        const version = await tx.gameDispatchTemplateVersion.findFirst({
          where: {
            tenantId: command.tenantId,
            id: command.input.templateVersionId,
          },
        });
        if (!template || !version || version.templateId !== template.id) {
          throw versionUnavailable(command.input.templateVersionId);
        }
        // 游戏归属必须一致，禁止把 A 游戏的版本挂到 B 游戏。
        if (template.gameId !== command.input.gameId) {
          throw versionUnavailable(version.id);
        }
        if (template.archivedAt !== null || template.status === "ARCHIVED") {
          throw new GenericTemplateError(
            "TEMPLATE_ARCHIVED",
            "模板已归档，不能再创建派单",
            { templateId: template.id },
          );
        }
        const config = readPublishedConfig(version.configJson);
        if (config === null) throw versionUnavailable(version.id);

        const customer = await tx.customerProfile.findFirst({
          where: {
            tenantId: command.tenantId,
            id: command.input.customerProfileId,
          },
        });
        if (!customer) throw new DispatchInputError("客户不存在");

        // 人数、价格与文案只由发布快照计算；客户端多传的键会在领域层被拒。
        const draft = buildDraft(config, command.input.values);
        const durationMinutes =
          command.input.durationMinutes ??
          DEFAULT_TEMPLATE_ORDER_DURATION_MINUTES;
        const desiredStartAt = command.input.desiredStartAt
          ? new Date(command.input.desiredStartAt)
          : null;

        const order = await tx.order.create({
          data: {
            tenantId: command.tenantId,
            orderNo: `GDOR${code()}`,
            customerProfileId: customer.id,
            status: "DRAFT",
            processType: "GAME_DISPATCH",
            ...(desiredStartAt ? { scheduledStartAt: desiredStartAt } : {}),
          },
        });
        const dispatchOrder = await tx.gameDispatchOrder.create({
          data: {
            tenantId: command.tenantId,
            orderId: order.id,
            gameId: command.input.gameId,
            templateVersionId: version.id,
            dispatchNo: `GD${code()}`,
            formValuesJson: command.input.values as never,
            durationMinutes,
            desiredStartAt,
          },
        });
        const snapshot = await tx.gameDispatchTemplateSnapshot.create({
          data: {
            tenantId: command.tenantId,
            orderId: order.id,
            gameId: command.input.gameId,
            templateId: template.id,
            templateVersionId: version.id,
            templateName: template.name,
            // v2 不再使用旧列，但表结构要求非空，写入空数组保持快照自描述。
            fieldsJson: [] as never,
            sectionsJson: [] as never,
            positionsJson: [] as never,
            rankRulesJson: [] as never,
            copyLinesJson: [] as never,
            configJson: config as never,
            schemaVersion: 2,
          },
        });
        await tx.gameDispatchOrder.update({
          where: { id: dispatchOrder.id },
          data: { snapshotId: snapshot.id },
        });
        await tx.gameDispatchTemplate.update({
          where: { id: template.id },
          data: { lastUsedAt: new Date() },
        });
        await tx.auditLog.create({
          data: {
            tenantId: command.tenantId,
            actorType: "tenant_account",
            actorId: command.actorId,
            action: IDEMPOTENCY_OPERATION,
            resourceType: "game_dispatch_order",
            resourceId: dispatchOrder.id,
            summary: `按模板「${template.name}」v${version.versionNo} 创建派单`,
          },
        });

        const result: CreateTemplateOrderResult = {
          orderId: order.id,
          dispatchOrderId: dispatchOrder.id,
          templateVersionId: version.id,
          staffingSummary: draft.staffing,
          priceAdjustmentFen: draft.priceAdjustmentFen,
          document: draft.document,
        };
        await tx.idempotencyRecord.create({
          data: {
            tenantId: command.tenantId,
            idempotencyKey: command.idempotencyKey,
            operation: IDEMPOTENCY_OPERATION,
            entityType: "game_dispatch_order",
            entityId: dispatchOrder.id,
            responseJson: {
              requestHash: command.requestHash,
              result,
            } as never,
          },
        });

        return { result, duplicate: false };
      });
    } catch (error) {
      if (isP2002(error)) {
        const existing = await this.client.idempotencyRecord.findUnique({
          where: this.idempotencyWhere(command),
        });
        const replayed = replayOrReject(existing, command);
        if (replayed) return replayed;
      }
      throw error;
    }
  }
}

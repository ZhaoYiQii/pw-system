/**
 * 算价模型 Task 4（设计规格 §3.5 / §5 / §9 第 3 条）：陪玩放鸽子/未到场的人工违约记录。
 *
 * - 只增不改：写入 `player_breach_records` 与 `audit_logs`（action = game_dispatch.player_breach）；
 * - 通知老板：复用既有 Outbox → 站内通知链路（`player.breach.recorded`），客户按订单可见；
 * - 租户：所有读写带服务端 TenantContext，传入的档位必须属于该订单与陪玩。
 */
import type { PrismaClient } from "@pw/database";
import type { PlayerBreachView } from "../domain/dispatch.js";
import {
  DispatchInputError,
  DispatchNotFoundError,
} from "../domain/dispatch-errors.js";

export interface PlayerBreachInput {
  orderId: string;
  playerId: string;
  orderSlotId?: string;
  reason: string;
}

export interface PlayerBreachListQuery {
  orderId?: string;
  playerId?: string;
  /** P3 / D3：按 createdAt 的时间范围（含边界），由校验层保证 from <= to。 */
  from?: Date;
  to?: Date;
  /** P3 / D3：分页偏移；limit 默认 20、上限 100。 */
  offset?: number;
  limit?: number;
}

export class PlayerBreachService {
  constructor(private readonly client: PrismaClient) {}

  /** 违约记录台账（Task 5a + P3 / D3）：按订单/陪玩/时间范围过滤，默认最近 20 条。 */
  async list(
    tenantId: string,
    query: PlayerBreachListQuery = {},
  ): Promise<PlayerBreachView[]> {
    const rows = await this.client.playerBreachRecord.findMany({
      where: {
        tenantId,
        ...(query.orderId ? { orderId: query.orderId } : {}),
        ...(query.playerId ? { playerId: query.playerId } : {}),
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: query.from } : {}),
                ...(query.to ? { lte: query.to } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      skip: Math.max(query.offset ?? 0, 0),
      take: Math.min(Math.max(query.limit ?? 20, 1), 100),
    });
    const playerIds = Array.from(new Set(rows.map((r) => r.playerId)));
    const players = playerIds.length
      ? await this.client.playerProfile.findMany({
          where: { tenantId, id: { in: playerIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(players.map((p) => [p.id, p.name]));
    return rows.map((row) => ({
      id: row.id,
      playerId: row.playerId,
      playerName: nameById.get(row.playerId) ?? "未知陪玩",
      orderId: row.orderId,
      orderSlotId: row.orderSlotId ?? null,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async record(
    tenantId: string,
    actorId: string,
    input: PlayerBreachInput,
  ): Promise<PlayerBreachView> {
    const reason = input.reason.trim();
    if (reason.length === 0) throw new DispatchInputError("请填写违约事由");
    return this.client.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { tenantId, id: input.orderId },
        select: { id: true, orderNo: true },
      });
      if (!order) throw new DispatchNotFoundError("订单不存在");
      const player = await tx.playerProfile.findFirst({
        where: { tenantId, id: input.playerId },
        select: { id: true, name: true },
      });
      if (!player) throw new DispatchNotFoundError("陪玩不存在");
      const orderSlotId = input.orderSlotId ?? null;
      if (orderSlotId !== null) {
        const slot = await tx.orderSlot.findFirst({
          where: {
            tenantId,
            id: orderSlotId,
            orderId: order.id,
            playerId: player.id,
          },
          select: { id: true },
        });
        if (!slot) throw new DispatchInputError("档位与该订单/陪玩不匹配");
      }
      const row = await tx.playerBreachRecord.create({
        data: {
          tenantId,
          playerId: player.id,
          orderId: order.id,
          orderSlotId,
          reason,
          recordedBy: actorId,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: "tenant_account",
          actorId,
          action: "game_dispatch.player_breach",
          resourceType: "player",
          resourceId: player.id,
          summary: `记录违约（订单 ${order.orderNo}，陪玩 ${player.name}）：${reason}`,
        },
      });
      // 通知老板：与业务写入同事务进 Outbox，由后台 worker 投递站内通知。
      await tx.outboxEvent.create({
        data: {
          tenantId,
          aggregateType: "order",
          aggregateId: order.id,
          eventType: "player.breach.recorded",
          payload: {
            orderId: order.id,
            orderNo: order.orderNo,
            playerId: player.id,
            playerName: player.name,
            reason,
          },
        },
      });
      return {
        id: row.id,
        playerId: player.id,
        playerName: player.name,
        orderId: order.id,
        orderSlotId,
        reason,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }
}

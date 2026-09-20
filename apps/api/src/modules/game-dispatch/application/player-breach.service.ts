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

export class PlayerBreachService {
  constructor(private readonly client: PrismaClient) {}

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

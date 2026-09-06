import type { PrismaClient } from "@pw/database";

const MAX_ATTEMPTS = 10;
const TITLE_BY_EVENT: Record<string, string> = {
  "order.created": "订单已创建",
  "order.confirmed": "订单已确认",
  "order.published": "订单正在选人",
  "order.assigned": "已为您选定陪玩",
  "order.accounted": "订单已完成核算",
  "order.cancelled": "订单已取消",
  "session.ended": "场次已结束"
};

/** 拉取 Outbox PENDING 事件并投递站内通知；以 outbox_event_id 唯一去重，崩溃重放不重复。 */
export async function drainOutbox(client: PrismaClient, batchSize = 20): Promise<number> {
  const pending = await client.outboxEvent.findMany({
    where: { status: "PENDING", availableAt: { lte: new Date() }, attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: "asc" },
    take: batchSize,
    select: { id: true }
  });
  if (pending.length === 0) return 0;
  const ids = pending.map((p) => p.id);
  const claimed = await client.outboxEvent.updateMany({
    where: { id: { in: ids }, status: "PENDING" },
    data: { status: "PROCESSING", attempts: { increment: 1 } }
  });
  if (claimed.count === 0) return 0;
  const rows = await client.outboxEvent.findMany({ where: { id: { in: ids }, status: "PROCESSING" } });
  let done = 0;
  for (const row of rows) {
    try {
      const title = TITLE_BY_EVENT[row.eventType] ?? "系统通知";
      const payload = row.payload as Record<string, unknown>;
      const content = `订单状态更新：${title}（${String(payload.orderNo ?? "")}）`;
      await client.notificationDelivery.upsert({
        where: { outboxEventId: row.id },
        create: {
          tenantId: row.tenantId,
          outboxEventId: row.id,
          channel: "INAPP",
          title,
          content,
          recipientType: "order",
          recipientId: row.aggregateId
        },
        update: {}
      });
      await client.outboxEvent.update({ where: { id: row.id }, data: { status: "PROCESSED", processedAt: new Date() } });
      done += 1;
    } catch (error) {
      await client.outboxEvent.update({
        where: { id: row.id },
        data: { status: "FAILED", lastError: error instanceof Error ? error.message.slice(0, 500) : String(error) }
      });
    }
  }
  return done;
}
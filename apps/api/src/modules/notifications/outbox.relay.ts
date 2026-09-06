import type { PrismaClient } from "@pw/database";

const MAX_ATTEMPTS = 10;
const PROCESSING_LEASE_MS = 5 * 60 * 1000;
const TITLE_BY_EVENT: Record<string, string> = {
  "order.created": "订单已创建",
  "order.confirmed": "订单已确认",
  "order.published": "订单正在选人",
  "order.assigned": "已为您选定陪玩",
  "order.accounted": "订单已完成核算",
  "order.cancelled": "订单已取消",
  "session.ended": "场次已结束"
};

/**
 * 拉取 Outbox PENDING 事件并投递站内通知；以 outbox_event_id 唯一去重，崩溃重放不重复。
 * - tenantId 可选：生产默认全局处理；测试可限定单租户避免历史残留干扰。
 * - claim 时写入 PROCESSING 租约到期时间（available_at = now + lease），
 *   下次 drain 回收已过期 PROCESSING（worker 崩溃后不会永久卡死）。
 */
export async function drainOutbox(client: PrismaClient, batchSize = 20, tenantId?: string): Promise<number> {
  const scope = tenantId ? { tenantId } : {};
  const now = new Date();
  const leaseCutoff = new Date(now.getTime() - PROCESSING_LEASE_MS);
  await client.outboxEvent.updateMany({
    where: { ...scope, status: "PROCESSING", availableAt: { lt: leaseCutoff } },
    data: { status: "PENDING", availableAt: now, lastError: null }
  });
  // 被回收的 PENDING 会随下面的批次重新消费（不单独计数，避免返回数语义混乱）。
  const pending = await client.outboxEvent.findMany({
    where: { ...scope, status: "PENDING", availableAt: { lte: now }, attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: "asc" },
    take: batchSize,
    select: { id: true }
  });
  if (pending.length === 0) return 0;
  const ids = pending.map((p) => p.id);
  const claimed = await client.outboxEvent.updateMany({
    where: { id: { in: ids }, status: "PENDING" },
    data: {
      status: "PROCESSING",
      attempts: { increment: 1 },
      availableAt: new Date(now.getTime() + PROCESSING_LEASE_MS)
    }
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

/**
 * 人工重放 FAILED 事件：重置为 PENDING（attempts 清零），由下一次 drain 重新消费。
 * 只接受 FAILED，避免误重置正在处理的事件。
 */
export async function requeueFailedOutboxEvent(client: PrismaClient, eventId: string): Promise<boolean> {
  const res = await client.outboxEvent.updateMany({
    where: { id: eventId, status: "FAILED" },
    data: { status: "PENDING", attempts: 0, lastError: null, availableAt: new Date() }
  });
  return res.count > 0;
}

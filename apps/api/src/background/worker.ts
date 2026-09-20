import type { PrismaClient } from "@pw/database";
import { drainOutbox } from "../modules/notifications/outbox.relay.js";
import { LedgerService } from "../modules/ledger/application/ledger.service.js";
import { PlatformBillingService } from "../modules/platform-billing/platform-billing.service.js";
import { assertOrderTransition } from "../modules/orders/domain/order-state-machine.js";

export interface BackgroundTickOptions {
  batchSize?: number;
  /** 测试可限定单租户，避免历史残留跨租户串扰；生产缺省全局。 */
  tenantId?: string;
  /** 传入后在单个 tick 内先执行“超时自动确认完成核算”。 */
  ledger?: LedgerService;
  confirmTimeoutMs?: number;
  /**
   * 报名窗口内无人报名的自动关单窗口（毫秒，默认 5 分钟）。
   * 传 0 或负数即关闭该规则；不传表示不启用（由 bootstrap 显式注入默认值）。
   */
  noApplicationTimeoutMs?: number;
}

export interface BackgroundTickResult {
  subscriptionsExpired: number;
  outboxProcessed: number;
  autoConfirmed: number;
  /** 本次 tick 因「无人报名超时」自动关闭的订单数。 */
  autoClosed: number;
}

/** 单个后台 tick：订阅到期回收 + Outbox 定时消费（含租约回收/退避/死信）。 */
export async function runBackgroundTick(
  client: PrismaClient,
  billing: PlatformBillingService,
  options: BackgroundTickOptions = {},
): Promise<BackgroundTickResult> {
  // 先跑自动关单：它只用订单行锁，与陪玩报名串行化，且不依赖账本上下文。
  const autoClosed = await autoCloseUnstaffedOrders(
    client,
    options.noApplicationTimeoutMs,
    options.tenantId,
  );
  const autoConfirmed = await autoConfirmDueOrders(
    client,
    options.ledger,
    options.confirmTimeoutMs,
    options.tenantId,
  );
  const subscriptionsExpired = await billing.expireDueSubscriptions();
  const outboxProcessed = await drainOutbox(
    client,
    options.batchSize ?? 50,
    options.tenantId,
  );
  return { subscriptionsExpired, outboxProcessed, autoConfirmed, autoClosed };
}

/** 系统自动确认的固定 actor（表 actor_id 为 UUID 列，不能用文字串）。 */
export const SYSTEM_ACTOR_ID = "00000000-0000-4000-8000-000000000001";

/**
 * 报名窗口内无人报名 → 自动关单（设计规格 §3.5 / §6 / §9 第 3 条，默认窗口 5 分钟、可配置）。
 *
 * - 只处理仍在 DISPATCHING、且最新一轮报名已开出 `timeoutMs` 的订单；
 * - 「无人报名」= 该单不存在 APPLIED/SELECTED 报名（报名后取消/被释放也会回到该状态）；
 * - 关单动作在一个事务内完成：订单行锁 → 复核状态与报名 → 订单 CANCELLED → 轮次 CLOSED
 *   → order_events（system actor）→ audit_logs → Outbox（通知老板）。
 */
export async function autoCloseUnstaffedOrders(
  client: PrismaClient,
  timeoutMs: number | undefined,
  tenantId?: string,
): Promise<number> {
  if (!timeoutMs || timeoutMs <= 0) return 0;
  const now = new Date();
  const cutoff = new Date(now.getTime() - timeoutMs);
  const candidates = await client.order.findMany({
    where: {
      ...(tenantId ? { tenantId } : {}),
      status: "DISPATCHING",
    },
    select: { id: true, tenantId: true, orderNo: true },
    take: 100,
  });
  let closed = 0;
  for (const candidate of candidates) {
    const done = await client.$transaction(async (tx) => {
      // 订单行锁：与陪玩报名串行化（报名在同一把锁内复核订单状态）。
      await tx.$queryRaw`
        SELECT id FROM orders
        WHERE id = ${candidate.id}::uuid AND tenant_id = ${candidate.tenantId}::uuid
        FOR UPDATE`;
      const current = await tx.order.findFirst({
        where: { tenantId: candidate.tenantId, id: candidate.id },
        select: { status: true },
      });
      if (!current || current.status !== "DISPATCHING") return false;
      const round = await tx.gameDispatchRound.findFirst({
        where: { tenantId: candidate.tenantId, orderId: candidate.id },
        orderBy: { roundNo: "desc" },
      });
      if (!round || round.opensAt.getTime() > cutoff.getTime()) return false;
      const engaged = await tx.gameDispatchApplication.count({
        where: {
          tenantId: candidate.tenantId,
          orderId: candidate.id,
          status: { in: ["APPLIED", "SELECTED"] },
        },
      });
      if (engaged > 0) return false;
      const updated = await tx.order.updateMany({
        where: {
          tenantId: candidate.tenantId,
          id: candidate.id,
          status: "DISPATCHING",
        },
        data: { status: "CANCELLED" },
      });
      if (updated.count === 0) return false;
      // ADR-0005：这次迁移（DISPATCHING → CANCELLED）必须在集中表内；
      // 上面的条件更新已保证起点状态，这里是表级兜底。
      assertOrderTransition(candidate.id, "DISPATCHING", "CANCELLED");
      await tx.gameDispatchRound.updateMany({
        where: {
          tenantId: candidate.tenantId,
          orderId: candidate.id,
          status: "OPEN",
        },
        data: { status: "CLOSED" },
      });
      await tx.orderEvent.create({
        data: {
          tenantId: candidate.tenantId,
          orderId: candidate.id,
          eventType: "GAME_DISPATCH_AUTO_CLOSED",
          fromStatus: "DISPATCHING",
          toStatus: "CANCELLED",
          actorType: "system",
          actorId: SYSTEM_ACTOR_ID,
          payload: { reason: "NO_APPLICATION", roundNo: round.roundNo },
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: candidate.tenantId,
          actorType: "system",
          actorId: SYSTEM_ACTOR_ID,
          action: "game_dispatch.auto_close",
          resourceType: "order",
          resourceId: candidate.id,
          summary: `无人报名自动关单（第 ${round.roundNo} 轮报名窗口内无有效报名）`,
        },
      });
      await tx.outboxEvent.create({
        data: {
          tenantId: candidate.tenantId,
          aggregateType: "order",
          aggregateId: candidate.id,
          eventType: "order.auto_closed",
          payload: { orderId: candidate.id, orderNo: candidate.orderNo },
        },
      });
      return true;
    });
    if (done) closed += 1;
  }
  return closed;
}

/** 找到 PENDING_CONFIRMATION 且超时未确认的订单，逐个走核算闭环完成（幂等）。 */
export async function autoConfirmDueOrders(
  client: PrismaClient,
  ledger: LedgerService | undefined,
  confirmTimeoutMs: number | undefined,
  tenantId?: string,
): Promise<number> {
  if (!ledger || !confirmTimeoutMs) return 0;
  const cutoff = new Date(Date.now() - confirmTimeoutMs);
  const tenantScope = tenantId ? { tenantId } : {};
  const due = await client.order.findMany({
    where: {
      ...tenantScope,
      status: "PENDING_CONFIRMATION",
      updatedAt: { lt: cutoff },
    },
    select: { tenantId: true, id: true },
    take: 100,
  });
  if (due.length === 0) return 0;
  /**
   * 经典核算闭环只处理「经典场次流程」的订单：game-dispatch 订单没有 service_session，
   * 由报单审批 + confirmSettlement 结算（算价模型 Task 3/4），不属于这里。
   * 先按是否存在经典场次筛掉，避免这类订单让整次 tick 中断——否则同一 tick 的
   * Outbox 投递与订阅到期回收会被它持续饿死。
   */
  const sessions = await client.serviceSession.findMany({
    where: { ...tenantScope, orderId: { in: due.map((o) => o.id) } },
    select: { orderId: true },
  });
  const classics = new Set(sessions.map((s) => s.orderId));
  let done = 0;
  for (const order of due) {
    if (!classics.has(order.id)) continue;
    try {
      const result = await ledger.completeAccounting(
        order.tenantId,
        order.id,
        SYSTEM_ACTOR_ID,
        "system",
      );
      if (result) done += 1;
    } catch (error) {
      // 单笔失败（并发下状态已变化、缺少快照等）只记录并跳过，不阻断同一 tick 的其它步骤。
      console.error(
        JSON.stringify({
          level: "error",
          message: "auto confirm skipped",
          orderId: order.id,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  return done;
}

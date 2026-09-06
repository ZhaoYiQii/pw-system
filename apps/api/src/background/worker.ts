import type { PrismaClient } from "@pw/database";
import { drainOutbox } from "../modules/notifications/outbox.relay.js";
import { LedgerService } from "../modules/ledger/application/ledger.service.js";
import { PlatformBillingService } from "../modules/platform-billing/platform-billing.service.js";

export interface BackgroundTickOptions {
  batchSize?: number;
  /** 测试可限定单租户，避免历史残留跨租户串扰；生产缺省全局。 */
  tenantId?: string;
  /** 传入后在单个 tick 内先执行“超时自动确认完成核算”。 */
  ledger?: LedgerService;
  confirmTimeoutMs?: number;
}

export interface BackgroundTickResult {
  subscriptionsExpired: number;
  outboxProcessed: number;
  autoConfirmed: number;
}

/** 单个后台 tick：订阅到期回收 + Outbox 定时消费（含租约回收/退避/死信）。 */
export async function runBackgroundTick(
  client: PrismaClient,
  billing: PlatformBillingService,
  options: BackgroundTickOptions = {},
): Promise<BackgroundTickResult> {
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
  return { subscriptionsExpired, outboxProcessed, autoConfirmed };
}

/** 系统自动确认的固定 actor（表 actor_id 为 UUID 列，不能用文字串）。 */
export const SYSTEM_ACTOR_ID = "00000000-0000-4000-8000-000000000001";

/** 找到 PENDING_CONFIRMATION 且超时未确认的订单，逐个走核算闭环完成（幂等）。 */
export async function autoConfirmDueOrders(
  client: PrismaClient,
  ledger: LedgerService | undefined,
  confirmTimeoutMs: number | undefined,
  tenantId?: string,
): Promise<number> {
  if (!ledger || !confirmTimeoutMs) return 0;
  const cutoff = new Date(Date.now() - confirmTimeoutMs);
  const due = await client.order.findMany({
    where: {
      ...(tenantId ? { tenantId } : {}),
      status: "PENDING_CONFIRMATION",
      updatedAt: { lt: cutoff },
    },
    select: { tenantId: true, id: true },
    take: 100,
  });
  let done = 0;
  for (const order of due) {
    const result = await ledger.completeAccounting(
      order.tenantId,
      order.id,
      SYSTEM_ACTOR_ID,
      "system",
    );
    if (result) done += 1;
  }
  return done;
}

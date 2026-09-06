import type { PrismaClient } from "@pw/database";
import { drainOutbox } from "../modules/notifications/outbox.relay.js";
import { PlatformBillingService } from "../modules/platform-billing/platform-billing.service.js";

export interface BackgroundTickOptions {
  batchSize?: number;
  /** 测试可限定单租户，避免历史残留跨租户串扰；生产缺省全局。 */
  tenantId?: string;
}

export interface BackgroundTickResult {
  subscriptionsExpired: number;
  outboxProcessed: number;
}

/** 单个后台 tick：订阅到期回收 + Outbox 定时消费（含租约回收/退避/死信）。 */
export async function runBackgroundTick(
  client: PrismaClient,
  billing: PlatformBillingService,
  options: BackgroundTickOptions = {},
): Promise<BackgroundTickResult> {
  const subscriptionsExpired = await billing.expireDueSubscriptions();
  const outboxProcessed = await drainOutbox(
    client,
    options.batchSize ?? 50,
    options.tenantId,
  );
  return { subscriptionsExpired, outboxProcessed };
}

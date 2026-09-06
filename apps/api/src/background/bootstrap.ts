import { createDatabaseClient } from "@pw/database";
import { tenantGuarded } from "../common/database/tenant-guard.js";
import { LedgerService } from "../modules/ledger/application/ledger.service.js";
import { PrismaLedgerRepository } from "../modules/ledger/infrastructure/prisma-ledger.repository.js";
import { PlatformBillingService } from "../modules/platform-billing/platform-billing.service.js";
import { runBackgroundTick, type BackgroundTickOptions } from "./worker.js";

/**
 * 后台 worker 进程入口：轮询消费 Outbox 站内通知并回收到期订阅。
 * 运行方式：pnpm --filter @pw/api start:worker
 * 连接使用 PLATFORM_DATABASE_URL（表 owner 全量权限；runtime 角色有 RLS 无法全局扫描）。
 */
async function bootstrap(): Promise<void> {
  const url =
    process.env.PLATFORM_DATABASE_URL ??
    process.env.DATABASE_MIGRATION_URL ??
    process.env.DATABASE_URL;
  if (!url)
    throw new Error("worker requires PLATFORM_DATABASE_URL or DATABASE_URL");
  const client = createDatabaseClient(url);
  const billing = new PlatformBillingService(client);
  const runtimeUrl = process.env.DATABASE_URL;
  if (!runtimeUrl)
    throw new Error("worker requires DATABASE_URL (runtime RLS connection)");
  const runtimeClient = createDatabaseClient(runtimeUrl);
  const ledger = new LedgerService(
    tenantGuarded(runtimeClient, new PrismaLedgerRepository(runtimeClient)),
  );
  const pollMs = Number(process.env.OUTBOX_POLL_MS ?? 5_000);
  const intervalMs = Number.isFinite(pollMs) && pollMs >= 1000 ? pollMs : 5_000;
  const confirmTimeoutMs = Number(
    process.env.ORDER_CONFIRM_TIMEOUT_MS ?? 15 * 60 * 1000,
  );
  const tickOptions: BackgroundTickOptions = {
    ledger,
    confirmTimeoutMs: Number.isFinite(confirmTimeoutMs)
      ? confirmTimeoutMs
      : 15 * 60 * 1000,
  };
  let running = false;

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const result = await runBackgroundTick(client, billing, tickOptions);
      if (
        result.outboxProcessed > 0 ||
        result.subscriptionsExpired > 0 ||
        result.autoConfirmed > 0
      ) {
        console.log(
          JSON.stringify({
            level: "info",
            message: "worker tick done",
            outboxProcessed: result.outboxProcessed,
            subscriptionsExpired: result.subscriptionsExpired,
            autoConfirmed: result.autoConfirmed,
          }),
        );
      }
    } catch (error) {
      console.error(
        "worker tick failed",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      running = false;
    }
  }

  await tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  console.log(
    JSON.stringify({
      level: "info",
      message: "worker started",
      pollMs: intervalMs,
    }),
  );
}

void bootstrap();

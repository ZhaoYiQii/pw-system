import { createDatabaseClient } from "@pw/database";
import { readFileSync } from "node:fs";
import { WechatPayNotificationService } from "../modules/payments/application/wechatpay-notification.service.js";
import { WechatPayReconciliationService } from "../modules/payments/application/wechatpay-reconciliation.service.js";
import { PrismaReconciliationRepository } from "../modules/payments/infrastructure/prisma-reconciliation.repository.js";
import { PrismaPaymentsRepository } from "../modules/payments/infrastructure/prisma-payments.repository.js";
import {
  WechatPayPartnerClient,
  loadWechatPayPartnerConfig,
} from "../modules/payments/infrastructure/wechatpay-partner.client.js";
import { tenantGuarded } from "../common/database/tenant-guard.js";
import { LedgerService } from "../modules/ledger/application/ledger.service.js";
import { PrismaLedgerRepository } from "../modules/ledger/infrastructure/prisma-ledger.repository.js";
import { PlatformBillingService } from "../modules/platform-billing/platform-billing.service.js";
import {
  resolveNoApplicationTimeoutMs,
  resolveRoundWindowMs,
  roundWindowFallbackNotice,
} from "../modules/game-dispatch/domain/dispatch-window.js";
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
  // P3 / D4：无人报名自动关单窗口默认跟随报名窗口（默认 10 分钟）；显式 0 关闭该规则。
  const noApplicationTimeoutMs = resolveNoApplicationTimeoutMs(process.env);
  const roundWindowNotice = roundWindowFallbackNotice(process.env);
  if (roundWindowNotice) {
    console.warn(
      `[worker] ${roundWindowNotice.variable}="${roundWindowNotice.raw}" 非法或越界，` +
        `回退默认 ${roundWindowNotice.effective}ms`,
    );
  }
  console.log(
    `[worker] 报名窗口 ${resolveRoundWindowMs(process.env)}ms，无人报名关单窗口 ${noApplicationTimeoutMs}ms（0=关闭）`,
  );
  // S4-2b：微信支付回调消费者。默认关闭；开启时要求 WXPAY_* 齐全，缺项**直接抛错**
  // （与 api 侧同一门禁语义，避免「以为开了其实没配全」）。
  let notifications: BackgroundTickOptions["notifications"];
  let reconciliation: BackgroundTickOptions["reconciliation"];
  if (process.env.WXPAY_ENABLED === "true") {
    const partnerClient = new WechatPayPartnerClient(
      loadWechatPayPartnerConfig({
        readFile: (path) => readFileSync(path, "utf8"),
      }),
    );
    notifications = new WechatPayNotificationService(
      new PrismaPaymentsRepository(client, runtimeClient),
      partnerClient,
    );
    reconciliation = new WechatPayReconciliationService(
      new PrismaReconciliationRepository(client, runtimeClient),
      partnerClient,
    );
    console.log("[worker] 微信支付回调消费：已启用");
  } else {
    console.log("[worker] 微信支付回调消费：未启用（WXPAY_ENABLED != true）");
  }
  const tickOptions: BackgroundTickOptions = {
    ledger,
    confirmTimeoutMs: Number.isFinite(confirmTimeoutMs)
      ? confirmTimeoutMs
      : 15 * 60 * 1000,
    noApplicationTimeoutMs,
    ...(notifications ? { notifications } : {}),
    ...(reconciliation ? { reconciliation } : {}),
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
        result.autoConfirmed > 0 ||
        result.wechatPayProcessed > 0 ||
        result.wechatPayFailed > 0 ||
        result.reconciled > 0 ||
        result.reconcileFailed > 0
      ) {
        console.log(
          JSON.stringify({
            level: "info",
            message: "worker tick done",
            outboxProcessed: result.outboxProcessed,
            subscriptionsExpired: result.subscriptionsExpired,
            autoConfirmed: result.autoConfirmed,
            wechatPayProcessed: result.wechatPayProcessed,
            wechatPayFailed: result.wechatPayFailed,
            reconciled: result.reconciled,
            reconcileFailed: result.reconcileFailed,
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

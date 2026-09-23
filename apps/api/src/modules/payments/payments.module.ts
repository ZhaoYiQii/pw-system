import { Module } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { readFileSync } from "node:fs";
import { WechatPayNotificationService } from "./application/wechatpay-notification.service.js";
import {
  WechatPayPartnerClient,
  loadWechatPayPartnerConfig,
} from "./infrastructure/wechatpay-partner.client.js";
import { PrismaPaymentsRepository } from "./infrastructure/prisma-payments.repository.js";
import { WechatPayNotifyController } from "./interface/wechatpay-notify.controller.js";
import { WechatPayCheckoutController } from "./interface/wechatpay-checkout.controller.js";
import { WechatPayCheckoutService } from "./application/wechatpay-checkout.service.js";
import { ManualRefundService } from "./application/manual-refund.service.js";
import { PrismaRefundRepository } from "./infrastructure/prisma-refund.repository.js";
import { WechatPayRefundController } from "./interface/wechatpay-refund.controller.js";
import { TenantPaymentSetupService } from "./application/payment-setup.service.js";
import { PrismaPaymentSetupRepository } from "./infrastructure/prisma-payment-setup.repository.js";
import { TenantPaymentSetupController } from "./interface/tenant-payment-setup.controller.js";
import { TenantPaymentLedgerService } from "./application/payment-ledger.service.js";
import { PrismaPaymentLedgerRepository } from "./infrastructure/prisma-payment-ledger.repository.js";
import { TenantPaymentLedgerController } from "./interface/tenant-payment-ledger.controller.js";
import { TenantReconciliationService } from "./application/tenant-reconciliation.service.js";
import { PrismaTenantReconciliationRepository } from "./infrastructure/prisma-tenant-reconciliation.repository.js";
import { TenantReconciliationController } from "./interface/tenant-reconciliation.controller.js";

export const PAYMENTS_PLATFORM_CLIENT = "PAYMENTS_PLATFORM_CLIENT";
export const PAYMENTS_RUNTIME_CLIENT = "PAYMENTS_RUNTIME_CLIENT";
export const WECHATPAY_PARTNER_CLIENT = "WECHATPAY_PARTNER_CLIENT";

/**
 * 微信支付通道**默认关闭**：未显式 `WXPAY_ENABLED=true` 时回调端点返回 503、
 * 不加载任何凭证——这样没有服务商凭证的部署（包括现在的本机与 CI）不会被新门禁打崩；
 * 一旦开启就要求 `WXPAY_*` 齐全，缺项启动即失败并点名变量。
 */
export function resolveWechatPayClient(): WechatPayPartnerClient | null {
  if (process.env.WXPAY_ENABLED !== "true") return null;
  return new WechatPayPartnerClient(
    loadWechatPayPartnerConfig({
      readFile: (path) => readFileSync(path, "utf8"),
    }),
  );
}

@Module({
  controllers: [
    WechatPayNotifyController,
    WechatPayCheckoutController,
    WechatPayRefundController,
    TenantPaymentSetupController,
    TenantPaymentLedgerController,
    TenantReconciliationController,
  ],
  providers: [
    {
      provide: PAYMENTS_PLATFORM_CLIENT,
      useFactory: () => {
        const url = process.env.PLATFORM_DATABASE_URL;
        if (!url) throw new Error("PLATFORM_DATABASE_URL is not configured");
        return createDatabaseClient(url);
      },
    },
    {
      provide: PAYMENTS_RUNTIME_CLIENT,
      useFactory: () => {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error("DATABASE_URL (runtime) is not configured");
        return createDatabaseClient(url);
      },
    },
    { provide: WECHATPAY_PARTNER_CLIENT, useFactory: resolveWechatPayClient },
    {
      provide: PrismaPaymentsRepository,
      useFactory: (
        platform: ReturnType<typeof createDatabaseClient>,
        runtime: ReturnType<typeof createDatabaseClient>,
      ) => new PrismaPaymentsRepository(platform, runtime),
      inject: [PAYMENTS_PLATFORM_CLIENT, PAYMENTS_RUNTIME_CLIENT],
    },
    {
      provide: WechatPayNotificationService,
      useFactory: (
        repository: PrismaPaymentsRepository,
        client: WechatPayPartnerClient | null,
      ) => new WechatPayNotificationService(repository, client),
      inject: [PrismaPaymentsRepository, WECHATPAY_PARTNER_CLIENT],
    },
    {
      provide: WechatPayCheckoutService,
      useFactory: (
        repository: PrismaPaymentsRepository,
        client: WechatPayPartnerClient | null,
      ) => new WechatPayCheckoutService(repository, client),
      inject: [PrismaPaymentsRepository, WECHATPAY_PARTNER_CLIENT],
    },
    {
      provide: PrismaRefundRepository,
      useFactory: (runtime: ReturnType<typeof createDatabaseClient>) =>
        new PrismaRefundRepository(runtime),
      inject: [PAYMENTS_RUNTIME_CLIENT],
    },
    {
      provide: ManualRefundService,
      useFactory: (repository: PrismaRefundRepository) =>
        new ManualRefundService(repository),
      inject: [PrismaRefundRepository],
    },
    {
      provide: PrismaPaymentSetupRepository,
      useFactory: (runtime: ReturnType<typeof createDatabaseClient>) =>
        new PrismaPaymentSetupRepository(runtime),
      inject: [PAYMENTS_RUNTIME_CLIENT],
    },
    {
      provide: TenantPaymentSetupService,
      useFactory: (
        repository: PrismaPaymentSetupRepository,
        client: WechatPayPartnerClient | null,
      ) => new TenantPaymentSetupService(repository, client),
      inject: [PrismaPaymentSetupRepository, WECHATPAY_PARTNER_CLIENT],
    },
    {
      provide: PrismaPaymentLedgerRepository,
      useFactory: (runtime: ReturnType<typeof createDatabaseClient>) =>
        new PrismaPaymentLedgerRepository(runtime),
      inject: [PAYMENTS_RUNTIME_CLIENT],
    },
    {
      provide: TenantPaymentLedgerService,
      useFactory: (repository: PrismaPaymentLedgerRepository) =>
        new TenantPaymentLedgerService(repository),
      inject: [PrismaPaymentLedgerRepository],
    },
    {
      provide: PrismaTenantReconciliationRepository,
      useFactory: (runtime: ReturnType<typeof createDatabaseClient>) =>
        new PrismaTenantReconciliationRepository(runtime),
      inject: [PAYMENTS_RUNTIME_CLIENT],
    },
    {
      provide: TenantReconciliationService,
      useFactory: (repository: PrismaTenantReconciliationRepository) =>
        new TenantReconciliationService(repository),
      inject: [PrismaTenantReconciliationRepository],
    },
  ],
  exports: [
    WechatPayNotificationService,
    WechatPayCheckoutService,
    ManualRefundService,
    TenantPaymentSetupService,
    TenantPaymentLedgerService,
    TenantReconciliationService,
  ],
})
export class PaymentsModule {}

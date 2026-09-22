import { Module } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { tenantGuarded } from "../../common/database/tenant-guard.js";
import { WalletService } from "./application/wallet.service.js";
import type { PaymentProvider } from "./domain/payment-provider.js";
import { MockPaymentProvider } from "./infrastructure/mock-payment.provider.js";
import { WalletController } from "./interface/wallet.controller.js";

export const WALLET_DB_CLIENT = "WALLET_DB_CLIENT";

/**
 * 支付通道的 DI token。
 *
 * 此前这里直接用具体类 `MockPaymentProvider` 当 token，导致「换真实通道」必须改 DI 装配。
 * 现与短信模块（`SMS_PROVIDER`）统一范式：**字符串 token + 工厂返回接口类型**；
 * 接微信支付时只需在 resolvePaymentProvider 里按 `PAYMENT_PROVIDER` 分支返回新实现。
 */
export const PAYMENT_PROVIDER = "PAYMENT_PROVIDER";

export function resolvePaymentProvider(): PaymentProvider {
  const provider = process.env.PAYMENT_PROVIDER ?? "";
  if (provider !== "mock") {
    throw new Error(
      "PAYMENT_PROVIDER must be configured; only 'mock' is implemented so far",
    );
  }
  // 主规格 18：开发用 Fake Provider 生产默认硬失败，只有显式开启演示模式才放行。
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_MOCK_PAYMENT !== "true"
  ) {
    throw new Error(
      "mock payment is not allowed in production unless ALLOW_MOCK_PAYMENT=true (demo only)",
    );
  }
  return new MockPaymentProvider();
}

@Module({
  controllers: [WalletController],
  providers: [
    {
      provide: WALLET_DB_CLIENT,
      useFactory: () => {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error("DATABASE_URL (runtime) is not configured");
        return createDatabaseClient(url);
      },
    },
    {
      provide: PAYMENT_PROVIDER,
      useFactory: resolvePaymentProvider,
    },
    {
      provide: WalletService,
      useFactory: (
        client: ReturnType<typeof createDatabaseClient>,
        provider: PaymentProvider,
      ) => tenantGuarded(client, new WalletService(client, provider)),
      inject: [WALLET_DB_CLIENT, PAYMENT_PROVIDER],
    },
  ],
  exports: [WalletService],
})
export class WalletModule {}

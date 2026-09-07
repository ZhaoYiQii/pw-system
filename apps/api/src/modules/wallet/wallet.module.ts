import { Module } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { tenantGuarded } from "../../common/database/tenant-guard.js";
import { WalletService } from "./application/wallet.service.js";
import { MockPaymentProvider } from "./infrastructure/mock-payment.provider.js";
import { WalletController } from "./interface/wallet.controller.js";

export const WALLET_DB_CLIENT = "WALLET_DB_CLIENT";

function resolvePaymentProvider(): MockPaymentProvider {
  const provider = process.env.PAYMENT_PROVIDER ?? "";
  if (provider !== "mock") {
    throw new Error(
      "PAYMENT_PROVIDER must be configured; only 'mock' is implemented",
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
      provide: MockPaymentProvider,
      useFactory: resolvePaymentProvider,
    },
    {
      provide: WalletService,
      useFactory: (
        client: ReturnType<typeof createDatabaseClient>,
        provider: MockPaymentProvider,
      ) => tenantGuarded(client, new WalletService(client, provider)),
      inject: [WALLET_DB_CLIENT, MockPaymentProvider],
    },
  ],
  exports: [WalletService],
})
export class WalletModule {}

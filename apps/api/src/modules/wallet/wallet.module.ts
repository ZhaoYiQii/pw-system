import { Module } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { tenantGuarded } from "../../common/database/tenant-guard.js";
import { WalletService } from "./application/wallet.service.js";
import { MockPaymentProvider } from "./infrastructure/mock-payment.provider.js";
import { WalletController } from "./interface/wallet.controller.js";

export const WALLET_DB_CLIENT = "WALLET_DB_CLIENT";

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
      useFactory: () => new MockPaymentProvider(),
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

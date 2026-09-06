import { Module } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { PlatformBillingService } from "./platform-billing.service.js";
import { PlatformBillingController } from "./platform-billing.controller.js";

export const BILLING_DB_CLIENT = "BILLING_DB_CLIENT";

@Module({
  controllers: [PlatformBillingController],
  providers: [
    { provide: BILLING_DB_CLIENT, useFactory: () => { const url = process.env.PLATFORM_DATABASE_URL ?? process.env.DATABASE_URL; if (!url) throw new Error("db url missing"); return createDatabaseClient(url); } },
    { provide: PlatformBillingService, useFactory: (c: ReturnType<typeof createDatabaseClient>) => new PlatformBillingService(c), inject: [BILLING_DB_CLIENT] }
  ]
})
export class PlatformBillingModule {}
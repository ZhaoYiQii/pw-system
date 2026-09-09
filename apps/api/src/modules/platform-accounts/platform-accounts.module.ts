import { Module } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { PlatformAccountsController } from "./platform-accounts.controller.js";
import { PlatformAccountsService } from "./platform-accounts.service.js";
import { PlatformGrantsController } from "./platform-grants.controller.js";
import { PlatformGrantsService } from "./platform-grants.service.js";

export const PLATFORM_ACCOUNTS_DB_CLIENT = "PLATFORM_ACCOUNTS_DB_CLIENT";

@Module({
  controllers: [PlatformAccountsController, PlatformGrantsController],
  providers: [
    {
      provide: PLATFORM_ACCOUNTS_DB_CLIENT,
      useFactory: () => {
        const url = process.env.PLATFORM_DATABASE_URL;
        if (!url) throw new Error("PLATFORM_DATABASE_URL is not configured");
        return createDatabaseClient(url);
      },
    },
    {
      provide: PlatformAccountsService,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) =>
        new PlatformAccountsService(client),
      inject: [PLATFORM_ACCOUNTS_DB_CLIENT],
    },
    {
      provide: PlatformGrantsService,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) =>
        new PlatformGrantsService(client),
      inject: [PLATFORM_ACCOUNTS_DB_CLIENT],
    },
  ],
  exports: [PlatformGrantsService],
})
export class PlatformAccountsModule {}

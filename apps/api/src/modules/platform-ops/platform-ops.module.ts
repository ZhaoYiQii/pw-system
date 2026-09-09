import { Module } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { PlatformAccountsModule } from "../platform-accounts/platform-accounts.module.js";
import { PlatformOpsController } from "./platform-ops.controller.js";
import { PlatformOpsService } from "./platform-ops.service.js";

export const PLATFORM_OPS_DB_CLIENT = "PLATFORM_OPS_DB_CLIENT";

@Module({
  imports: [PlatformAccountsModule],
  controllers: [PlatformOpsController],
  providers: [
    {
      provide: PLATFORM_OPS_DB_CLIENT,
      useFactory: () => {
        const url = process.env.PLATFORM_DATABASE_URL;
        if (!url) throw new Error("PLATFORM_DATABASE_URL is not configured");
        return createDatabaseClient(url);
      },
    },
    {
      provide: PlatformOpsService,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) =>
        new PlatformOpsService(client),
      inject: [PLATFORM_OPS_DB_CLIENT],
    },
  ],
})
export class PlatformOpsModule {}

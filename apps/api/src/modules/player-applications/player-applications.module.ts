import { Module } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { PlayerApplicationsController } from "./player-applications.controller.js";
import { PlayerApplicationsService } from "./player-applications.service.js";

export const PLAYER_APPLICATIONS_DB_CLIENT =
  "PLAYER_APPLICATIONS_DB_CLIENT";

@Module({
  controllers: [PlayerApplicationsController],
  providers: [
    {
      provide: PLAYER_APPLICATIONS_DB_CLIENT,
      useFactory: () => {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error("DATABASE_URL (runtime) is not configured");
        return createDatabaseClient(url);
      },
    },
    {
      provide: PlayerApplicationsService,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) =>
        new PlayerApplicationsService(client),
      inject: [PLAYER_APPLICATIONS_DB_CLIENT],
    },
  ],
  exports: [PlayerApplicationsService],
})
export class PlayerApplicationsModule {}

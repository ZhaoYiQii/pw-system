import { Module } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { DispatchService } from "./application/dispatch.service.js";
import { PrismaDispatchRepository } from "./infrastructure/prisma-dispatch.repository.js";
import { DispatchAdminController } from "./interface/dispatch-admin.controller.js";
import { DispatchPlayerController } from "./interface/dispatch-player.controller.js";
import { PlayersModule } from "../players/players.module.js";

export const DISPATCH_DB_CLIENT = "DISPATCH_DB_CLIENT";

@Module({
  imports: [PlayersModule],
  controllers: [DispatchAdminController, DispatchPlayerController],
  providers: [
    {
      provide: DISPATCH_DB_CLIENT,
      useFactory: () => {
        const url = process.env.PLATFORM_DATABASE_URL ?? process.env.DATABASE_URL;
        if (!url) throw new Error("PLATFORM_DATABASE_URL/DATABASE_URL is not configured");
        return createDatabaseClient(url);
      }
    },
    {
      provide: PrismaDispatchRepository,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) => new PrismaDispatchRepository(client),
      inject: [DISPATCH_DB_CLIENT]
    },
    {
      provide: DispatchService,
      useFactory: (repo: PrismaDispatchRepository) => new DispatchService(repo),
      inject: [PrismaDispatchRepository]
    }
  ],
  exports: [DispatchService]
})
export class DispatchModule {}
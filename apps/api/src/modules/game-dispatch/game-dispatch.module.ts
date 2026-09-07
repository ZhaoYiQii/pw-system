import { Module } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { tenantGuarded } from "../../common/database/tenant-guard.js";
import { GameDispatchService } from "./application/game-dispatch.service.js";
import { GameTemplateService } from "./application/game-template.service.js";
import { PrismaGameTemplateRepository } from "./infrastructure/prisma-game-template.repository.js";
import { GameDispatchController } from "./interface/game-dispatch.controller.js";
import { SlotSessionController } from "./interface/slot-session.controller.js";
import { GameTemplateController } from "./interface/game-template.controller.js";

export const GAME_DISPATCH_DB_CLIENT = "GAME_DISPATCH_DB_CLIENT";

@Module({
  controllers: [
    GameTemplateController,
    GameDispatchController,
    SlotSessionController,
  ],
  providers: [
    {
      provide: GAME_DISPATCH_DB_CLIENT,
      useFactory: () => {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error("DATABASE_URL (runtime) is not configured");
        return createDatabaseClient(url);
      },
    },
    {
      provide: PrismaGameTemplateRepository,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) =>
        tenantGuarded(client, new PrismaGameTemplateRepository(client)),
      inject: [GAME_DISPATCH_DB_CLIENT],
    },
    {
      provide: GameTemplateService,
      useFactory: (repo: PrismaGameTemplateRepository) =>
        new GameTemplateService(repo),
      inject: [PrismaGameTemplateRepository],
    },
    {
      provide: GameDispatchService,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) =>
        tenantGuarded(client, new GameDispatchService(client)),
      inject: [GAME_DISPATCH_DB_CLIENT],
    },
  ],
  exports: [GameDispatchService],
})
export class GameDispatchModule {}

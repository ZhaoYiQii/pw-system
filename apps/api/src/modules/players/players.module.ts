import { Module } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { PlayersService } from "./application/players.service.js";
import { PrismaPlayerRepository } from "./infrastructure/prisma-players.repository.js";
import { PlayersController } from "./interface/players.controller.js";
import { PlayerSelfController } from "./interface/self.controller.js";

export const PLAYERS_DB_CLIENT = "PLAYERS_DB_CLIENT";

@Module({
  controllers: [PlayersController, PlayerSelfController],
  providers: [
    {
      provide: PLAYERS_DB_CLIENT,
      useFactory: () => {
        const url = process.env.PLATFORM_DATABASE_URL ?? process.env.DATABASE_URL;
        if (!url) throw new Error("PLATFORM_DATABASE_URL/DATABASE_URL is not configured");
        return createDatabaseClient(url);
      }
    },
    {
      provide: PrismaPlayerRepository,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) => new PrismaPlayerRepository(client),
      inject: [PLAYERS_DB_CLIENT]
    },
    {
      provide: PlayersService,
      useFactory: (repo: PrismaPlayerRepository) => new PlayersService(repo),
      inject: [PrismaPlayerRepository]
    }
  ],
  exports: [PlayersService]
})
export class PlayersModule {}
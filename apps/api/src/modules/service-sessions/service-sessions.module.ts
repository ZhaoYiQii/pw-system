import { Module } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { PrismaSessionsRepository } from "./infrastructure/prisma-sessions.repository.js";
import { SessionsController } from "./interface/sessions.controller.js";
import { PlayersModule } from "../players/players.module.js";

export const SESSIONS_DB_CLIENT = "SESSIONS_DB_CLIENT";

@Module({
  imports: [PlayersModule],
  controllers: [SessionsController],
  providers: [
    {
      provide: SESSIONS_DB_CLIENT,
      useFactory: () => {
        const url = process.env.PLATFORM_DATABASE_URL ?? process.env.DATABASE_URL;
        if (!url) throw new Error("PLATFORM_DATABASE_URL/DATABASE_URL is not configured");
        return createDatabaseClient(url);
      }
    },
    {
      provide: PrismaSessionsRepository,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) => new PrismaSessionsRepository(client),
      inject: [SESSIONS_DB_CLIENT]
    }
  ]
})
export class ServiceSessionsModule {}
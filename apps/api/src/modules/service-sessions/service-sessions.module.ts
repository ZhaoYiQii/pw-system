import { Module } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { tenantGuarded } from "../../common/database/tenant-guard.js";
import { PrismaSessionsRepository } from "./infrastructure/prisma-sessions.repository.js";
import { SessionsController } from "./interface/sessions.controller.js";
import { EvidenceController } from "./interface/evidence.controller.js";
import { PlayersModule } from "../players/players.module.js";

export const SESSIONS_DB_CLIENT = "SESSIONS_DB_CLIENT";

@Module({
  imports: [PlayersModule],
  controllers: [SessionsController, EvidenceController],
  providers: [
    {
      provide: SESSIONS_DB_CLIENT,
      useFactory: () => {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error("DATABASE_URL (runtime) is not configured");
        return createDatabaseClient(url);
      },
    },
    {
      provide: PrismaSessionsRepository,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) =>
        tenantGuarded(client, new PrismaSessionsRepository(client)),
      inject: [SESSIONS_DB_CLIENT],
    },
  ],
})
export class ServiceSessionsModule {}

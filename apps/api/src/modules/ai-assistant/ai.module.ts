import { Module } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { DeterministicAiProvider } from "./provider.js";
import { AiAssistantService } from "./ai.service.js";
import { AiController } from "./ai.controller.js";

export const AI_DB_CLIENT = "AI_DB_CLIENT";

@Module({
  controllers: [AiController],
  providers: [
    { provide: AI_DB_CLIENT, useFactory: () => { const url = process.env.DATABASE_URL; if (!url) throw new Error("db url missing"); return createDatabaseClient(url); } },
    { provide: DeterministicAiProvider, useFactory: () => new DeterministicAiProvider() },
    { provide: AiAssistantService, useFactory: (c: ReturnType<typeof createDatabaseClient>, p: DeterministicAiProvider) => new AiAssistantService(c, p), inject: [AI_DB_CLIENT, DeterministicAiProvider] }
  ]
})
export class AiAssistantModule {}
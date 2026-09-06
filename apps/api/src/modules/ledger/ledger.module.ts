import { Module } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { LedgerRulesRepository } from "./infrastructure/prisma-ledger-rules.repository.js";
import { LedgerRulesService } from "./application/ledger-rules.service.js";
import { PrismaLedgerRepository } from "./infrastructure/prisma-ledger.repository.js";
import { LedgerService } from "./application/ledger.service.js";
import { PlatformFinanceController } from "./interface/platform-finance.controller.js";
import { TenantFinanceController } from "./interface/tenant-finance.controller.js";
import { AccountingController, PlayerFinanceController } from "./interface/ledger.controller.js";
import { PlayersModule } from "../players/players.module.js";

export const LEDGER_DB_CLIENT = "LEDGER_DB_CLIENT";

@Module({
  imports: [PlayersModule],
  controllers: [
    PlatformFinanceController,
    TenantFinanceController,
    AccountingController,
    PlayerFinanceController
  ],
  providers: [
    {
      provide: LEDGER_DB_CLIENT,
      useFactory: () => {
        const url = process.env.PLATFORM_DATABASE_URL ?? process.env.DATABASE_URL;
        if (!url) throw new Error("PLATFORM_DATABASE_URL/DATABASE_URL is not configured");
        return createDatabaseClient(url);
      }
    },
    {
      provide: LedgerRulesRepository,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) => new LedgerRulesRepository(client),
      inject: [LEDGER_DB_CLIENT]
    },
    {
      provide: LedgerRulesService,
      useFactory: (repo: LedgerRulesRepository) => new LedgerRulesService(repo),
      inject: [LedgerRulesRepository]
    },
    {
      provide: PrismaLedgerRepository,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) => new PrismaLedgerRepository(client),
      inject: [LEDGER_DB_CLIENT]
    },
    {
      provide: LedgerService,
      useFactory: (repo: PrismaLedgerRepository) => new LedgerService(repo),
      inject: [PrismaLedgerRepository]
    }
  ]
})
export class LedgerModule {}
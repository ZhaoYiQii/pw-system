import { Module } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { tenantGuarded } from "../../common/database/tenant-guard.js";
import { LedgerRulesRepository } from "./infrastructure/prisma-ledger-rules.repository.js";
import { LedgerRulesService } from "./application/ledger-rules.service.js";
import { PrismaFundAccountsRepository } from "./infrastructure/prisma-fund-accounts.repository.js";
import { FundAccountsService } from "./application/fund-accounts.service.js";
import { PrismaLedgerRepository } from "./infrastructure/prisma-ledger.repository.js";
import { PrismaSettlementsRepository } from "./infrastructure/prisma-settlements.repository.js";
import { LedgerService } from "./application/ledger.service.js";
import { PlatformFinanceController } from "./interface/platform-finance.controller.js";
import { TenantFinanceController } from "./interface/tenant-finance.controller.js";
import {
  AccountingController,
  PlayerFinanceController,
} from "./interface/ledger.controller.js";
import { SettlementsController } from "./interface/settlements.controller.js";
import { FundAccountsController } from "./interface/fund-accounts.controller.js";
import { PrismaFundLedgerRepository } from "./infrastructure/prisma-fund-ledger.repository.js";
import { FundLedgerService } from "./application/fund-ledger.service.js";
import { TenantFundLedgerController } from "./interface/tenant-fund-ledger.controller.js";
import { PlayersModule } from "../players/players.module.js";

export const LEDGER_DB_CLIENT = "LEDGER_DB_CLIENT";

@Module({
  imports: [PlayersModule],
  controllers: [
    PlatformFinanceController,
    TenantFinanceController,
    AccountingController,
    PlayerFinanceController,
    SettlementsController,
    FundAccountsController,
    TenantFundLedgerController,
  ],
  providers: [
    {
      provide: LEDGER_DB_CLIENT,
      useFactory: () => {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error("DATABASE_URL (runtime) is not configured");
        return createDatabaseClient(url);
      },
    },
    {
      provide: LedgerRulesRepository,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) =>
        tenantGuarded(client, new LedgerRulesRepository(client)),
      inject: [LEDGER_DB_CLIENT],
    },
    {
      provide: LedgerRulesService,
      useFactory: (repo: LedgerRulesRepository) => new LedgerRulesService(repo),
      inject: [LedgerRulesRepository],
    },
    {
      provide: PrismaLedgerRepository,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) =>
        tenantGuarded(client, new PrismaLedgerRepository(client)),
      inject: [LEDGER_DB_CLIENT],
    },
    {
      provide: LedgerService,
      useFactory: (repo: PrismaLedgerRepository) => new LedgerService(repo),
      inject: [PrismaLedgerRepository],
    },
    {
      provide: PrismaSettlementsRepository,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) =>
        tenantGuarded(client, new PrismaSettlementsRepository(client)),
      inject: [LEDGER_DB_CLIENT],
    },
    {
      provide: PrismaFundAccountsRepository,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) =>
        tenantGuarded(client, new PrismaFundAccountsRepository(client)),
      inject: [LEDGER_DB_CLIENT],
    },
    {
      provide: FundAccountsService,
      useFactory: (repo: PrismaFundAccountsRepository) =>
        new FundAccountsService(repo),
      inject: [PrismaFundAccountsRepository],
    },
    {
      provide: PrismaFundLedgerRepository,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) =>
        tenantGuarded(client, new PrismaFundLedgerRepository(client)),
      inject: [LEDGER_DB_CLIENT],
    },
    {
      provide: FundLedgerService,
      useFactory: (repo: PrismaFundLedgerRepository) =>
        new FundLedgerService(repo),
      inject: [PrismaFundLedgerRepository],
    },
  ],
  exports: [LedgerService, LedgerRulesService],
})
export class LedgerModule {}

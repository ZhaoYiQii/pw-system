import { Module } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { tenantGuarded } from "../../common/database/tenant-guard.js";
import { GameDispatchService } from "./application/game-dispatch.service.js";
import { PlayerBreachService } from "./application/player-breach.service.js";
import { GameDispatchTemplateOrderService } from "./application/game-dispatch-template-order.service.js";
import { PricingRulesService } from "./application/pricing-rules.service.js";
import { GameTemplateService } from "./application/game-template.service.js";
import { GenericGameTemplateService } from "./application/generic-game-template.service.js";
import { PrismaGamePricingRepository } from "./infrastructure/prisma-game-pricing.repository.js";
import { PrismaGameTemplateRepository } from "./infrastructure/prisma-game-template.repository.js";
import { PrismaGenericGameTemplateRepository } from "./infrastructure/prisma-generic-game-template.repository.js";
import { PrismaGameDispatchTemplateOrderRepository } from "./infrastructure/prisma-game-dispatch-template-order.repository.js";
import { GameDispatchController } from "./interface/game-dispatch.controller.js";
import { GameDispatchTemplateOrderController } from "./interface/game-dispatch-template-order.controller.js";
import { PricingRulesController } from "./interface/pricing-rules.controller.js";
import { SlotReportController } from "./interface/slot-report.controller.js";
import { SlotSessionController } from "./interface/slot-session.controller.js";
import { GameTemplateController } from "./interface/game-template.controller.js";
import { GenericGameTemplateController } from "./interface/generic-game-template.controller.js";
import { CustomerGameTemplateController } from "./interface/customer-game-template.controller.js";

export const GAME_DISPATCH_DB_CLIENT = "GAME_DISPATCH_DB_CLIENT";

@Module({
  controllers: [
    GameTemplateController,
    GenericGameTemplateController,
    CustomerGameTemplateController,
    GameDispatchController,
    GameDispatchTemplateOrderController,
    PricingRulesController,
    SlotSessionController,
    SlotReportController,
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
      provide: PrismaGenericGameTemplateRepository,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) =>
        tenantGuarded(client, new PrismaGenericGameTemplateRepository(client)),
      inject: [GAME_DISPATCH_DB_CLIENT],
    },
    {
      provide: GenericGameTemplateService,
      useFactory: (repo: PrismaGenericGameTemplateRepository) =>
        new GenericGameTemplateService(repo),
      inject: [PrismaGenericGameTemplateRepository],
    },
    {
      provide: PrismaGameDispatchTemplateOrderRepository,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) =>
        tenantGuarded(
          client,
          new PrismaGameDispatchTemplateOrderRepository(client),
        ),
      inject: [GAME_DISPATCH_DB_CLIENT],
    },
    {
      provide: GameDispatchTemplateOrderService,
      useFactory: (repo: PrismaGameDispatchTemplateOrderRepository) =>
        new GameDispatchTemplateOrderService(repo),
      inject: [PrismaGameDispatchTemplateOrderRepository],
    },
    {
      provide: GameDispatchService,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) =>
        tenantGuarded(client, new GameDispatchService(client)),
      inject: [GAME_DISPATCH_DB_CLIENT],
    },
    {
      provide: PlayerBreachService,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) =>
        tenantGuarded(client, new PlayerBreachService(client)),
      inject: [GAME_DISPATCH_DB_CLIENT],
    },
    {
      provide: PrismaGamePricingRepository,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) =>
        tenantGuarded(client, new PrismaGamePricingRepository(client)),
      inject: [GAME_DISPATCH_DB_CLIENT],
    },
    {
      provide: PricingRulesService,
      useFactory: (repo: PrismaGamePricingRepository) =>
        new PricingRulesService(repo),
      inject: [PrismaGamePricingRepository],
    },
  ],
  exports: [GameDispatchService],
})
export class GameDispatchModule {}

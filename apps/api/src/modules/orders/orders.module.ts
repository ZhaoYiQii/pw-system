import { Module } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { tenantGuarded } from "../../common/database/tenant-guard.js";
import { OrdersService } from "./application/orders.service.js";
import { PrismaOrdersRepository } from "./infrastructure/prisma-orders.repository.js";
import { OrdersController } from "./interface/orders.controller.js";
import { LedgerModule } from "../ledger/ledger.module.js";

export const ORDERS_DB_CLIENT = "ORDERS_DB_CLIENT";

@Module({
  imports: [LedgerModule],
  controllers: [OrdersController],
  providers: [
    {
      provide: ORDERS_DB_CLIENT,
      useFactory: () => {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error("DATABASE_URL (runtime) is not configured");
        return createDatabaseClient(url);
      }
    },
    {
      provide: PrismaOrdersRepository,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) => tenantGuarded(client, new PrismaOrdersRepository(client)),
      inject: [ORDERS_DB_CLIENT]
    },
    {
      provide: OrdersService,
      useFactory: (repo: PrismaOrdersRepository) => new OrdersService(repo),
      inject: [PrismaOrdersRepository]
    }
  ],
  exports: [OrdersService]
})
export class OrdersModule {}
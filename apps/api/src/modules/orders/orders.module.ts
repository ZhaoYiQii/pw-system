import { Module } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { OrdersService } from "./application/orders.service.js";
import { PrismaOrdersRepository } from "./infrastructure/prisma-orders.repository.js";
import { OrdersController } from "./interface/orders.controller.js";

export const ORDERS_DB_CLIENT = "ORDERS_DB_CLIENT";

@Module({
  controllers: [OrdersController],
  providers: [
    {
      provide: ORDERS_DB_CLIENT,
      useFactory: () => {
        const url = process.env.PLATFORM_DATABASE_URL ?? process.env.DATABASE_URL;
        if (!url) throw new Error("PLATFORM_DATABASE_URL/DATABASE_URL is not configured");
        return createDatabaseClient(url);
      }
    },
    {
      provide: PrismaOrdersRepository,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) => new PrismaOrdersRepository(client),
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
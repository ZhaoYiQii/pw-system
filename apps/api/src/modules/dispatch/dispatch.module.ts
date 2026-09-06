import { Module } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { tenantGuarded } from "../../common/database/tenant-guard.js";
import { DispatchService } from "./application/dispatch.service.js";
import { PrismaDispatchRepository } from "./infrastructure/prisma-dispatch.repository.js";
import { DispatchAdminController } from "./interface/dispatch-admin.controller.js";
import { DispatchPlayerController } from "./interface/dispatch-player.controller.js";
import { DispatchCustomerController } from "./interface/dispatch-customer.controller.js";
import { PlayersModule } from "../players/players.module.js";
import { CustomersModule } from "../customers/customers.module.js";
import { OrdersModule } from "../orders/orders.module.js";

export const DISPATCH_DB_CLIENT = "DISPATCH_DB_CLIENT";

@Module({
  imports: [PlayersModule, CustomersModule, OrdersModule],
  controllers: [
    DispatchAdminController,
    DispatchPlayerController,
    DispatchCustomerController,
  ],
  providers: [
    {
      provide: DISPATCH_DB_CLIENT,
      useFactory: () => {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error("DATABASE_URL (runtime) is not configured");
        return createDatabaseClient(url);
      },
    },
    {
      provide: PrismaDispatchRepository,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) =>
        tenantGuarded(client, new PrismaDispatchRepository(client)),
      inject: [DISPATCH_DB_CLIENT],
    },
    {
      provide: DispatchService,
      useFactory: (repo: PrismaDispatchRepository) => new DispatchService(repo),
      inject: [PrismaDispatchRepository],
    },
  ],
  exports: [DispatchService],
})
export class DispatchModule {}

import { Module } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { CustomersService } from "./application/customers.service.js";
import { PrismaCustomerRepository } from "./infrastructure/prisma-customers.repository.js";
import { CustomersController } from "./interface/customers.controller.js";
import { CustomerSelfController } from "./interface/customer-self.controller.js";
import { OrdersModule } from "../orders/orders.module.js";

export const CUSTOMERS_DB_CLIENT = "CUSTOMERS_DB_CLIENT";

@Module({
  imports: [OrdersModule],
  controllers: [CustomersController, CustomerSelfController],
  providers: [
    {
      provide: CUSTOMERS_DB_CLIENT,
      useFactory: () => {
        const url = process.env.PLATFORM_DATABASE_URL ?? process.env.DATABASE_URL;
        if (!url) throw new Error("PLATFORM_DATABASE_URL/DATABASE_URL is not configured");
        return createDatabaseClient(url);
      }
    },
    {
      provide: PrismaCustomerRepository,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) => new PrismaCustomerRepository(client),
      inject: [CUSTOMERS_DB_CLIENT]
    },
    {
      provide: CustomersService,
      useFactory: (repo: PrismaCustomerRepository) => new CustomersService(repo),
      inject: [PrismaCustomerRepository]
    }
  ],
  exports: [CustomersService]
})
export class CustomersModule {}
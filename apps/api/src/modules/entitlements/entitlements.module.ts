import { Module } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { EntitlementsService } from "./application/entitlements.service.js";
import { PrismaEntitlementRepository } from "./infrastructure/prisma-entitlement.repository.js";
import { EntitlementsController } from "./interface/entitlements.controller.js";

export const ENTITLEMENT_DB_CLIENT = "ENTITLEMENT_DB_CLIENT";

@Module({
  controllers: [EntitlementsController],
  providers: [
    {
      provide: ENTITLEMENT_DB_CLIENT,
      useFactory: () => {
        const url = process.env.PLATFORM_DATABASE_URL ?? process.env.DATABASE_URL;
        if (!url) throw new Error("PLATFORM_DATABASE_URL/DATABASE_URL is not configured");
        return createDatabaseClient(url);
      }
    },
    {
      provide: PrismaEntitlementRepository,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) => new PrismaEntitlementRepository(client),
      inject: [ENTITLEMENT_DB_CLIENT]
    },
    {
      provide: EntitlementsService,
      useFactory: (repo: PrismaEntitlementRepository) => new EntitlementsService(repo),
      inject: [PrismaEntitlementRepository]
    }
  ],
  exports: [EntitlementsService]
})
export class EntitlementsModule {}

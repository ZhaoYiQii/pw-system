import { Module } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { CatalogService } from "./application/catalog.service.js";
import { PrismaCatalogRepository } from "./infrastructure/prisma-catalog.repository.js";
import { CatalogController } from "./interface/catalog.controller.js";

export const CATALOG_DB_CLIENT = "CATALOG_DB_CLIENT";

@Module({
  controllers: [CatalogController],
  providers: [
    {
      provide: CATALOG_DB_CLIENT,
      useFactory: () => {
        const url = process.env.PLATFORM_DATABASE_URL ?? process.env.DATABASE_URL;
        if (!url) throw new Error("PLATFORM_DATABASE_URL/DATABASE_URL is not configured");
        return createDatabaseClient(url);
      }
    },
    {
      provide: PrismaCatalogRepository,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) => new PrismaCatalogRepository(client),
      inject: [CATALOG_DB_CLIENT]
    },
    {
      provide: CatalogService,
      useFactory: (repo: PrismaCatalogRepository) => new CatalogService(repo),
      inject: [PrismaCatalogRepository]
    }
  ],
  exports: [CatalogService]
})
export class CatalogModule {}
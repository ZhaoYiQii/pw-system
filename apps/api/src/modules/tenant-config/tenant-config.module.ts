import { Module } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { TenantConfigService } from "./application/config.service.js";
import { PrismaConfigRepository } from "./infrastructure/prisma-config.repository.js";
import { TenantConfigController } from "./interface/config.controller.js";

export const CONFIG_DB_CLIENT = "CONFIG_DB_CLIENT";

@Module({
  controllers: [TenantConfigController],
  providers: [
    {
      provide: CONFIG_DB_CLIENT,
      useFactory: () => {
        const url = process.env.PLATFORM_DATABASE_URL ?? process.env.DATABASE_URL;
        if (!url) throw new Error("PLATFORM_DATABASE_URL/DATABASE_URL is not configured");
        return createDatabaseClient(url);
      }
    },
    {
      provide: PrismaConfigRepository,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) => new PrismaConfigRepository(client),
      inject: [CONFIG_DB_CLIENT]
    },
    {
      provide: TenantConfigService,
      useFactory: (repo: PrismaConfigRepository) => new TenantConfigService(repo),
      inject: [PrismaConfigRepository]
    }
  ],
  exports: [TenantConfigService]
})
export class TenantConfigModule {}

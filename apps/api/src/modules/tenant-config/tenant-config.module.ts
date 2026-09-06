import { Module } from "@nestjs/common";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { createDatabaseClient } from "@pw/database";
import { tenantGuarded } from "../../common/database/tenant-guard.js";
import { TenantConfigService } from "./application/config.service.js";
import { PrismaConfigRepository } from "./infrastructure/prisma-config.repository.js";
import { TenantConfigController } from "./interface/config.controller.js";
import { StorefrontConfigController } from "./interface/storefront-config.controller.js";

export const CONFIG_DB_CLIENT = "CONFIG_DB_CLIENT";

@Module({
  controllers: [TenantConfigController, StorefrontConfigController],
  imports: [TenancyModule],
  providers: [
    {
      provide: CONFIG_DB_CLIENT,
      useFactory: () => {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error("DATABASE_URL (runtime) is not configured");
        return createDatabaseClient(url);
      },
    },
    {
      provide: PrismaConfigRepository,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) =>
        tenantGuarded(client, new PrismaConfigRepository(client)),
      inject: [CONFIG_DB_CLIENT],
    },
    {
      provide: TenantConfigService,
      useFactory: (repo: PrismaConfigRepository) =>
        new TenantConfigService(repo),
      inject: [PrismaConfigRepository],
    },
  ],
  exports: [TenantConfigService],
})
export class TenantConfigModule {}

import { Module } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { TenancyService } from "./application/tenancy.service.js";
import { PrismaTenantRepository } from "./infrastructure/prisma-tenant.repository.js";
import { TenancyController } from "./interface/tenancy.controller.js";

export const DATABASE_CLIENT = "DATABASE_CLIENT";

@Module({
  controllers: [TenancyController],
  providers: [
    {
      provide: DATABASE_CLIENT,
      useFactory: () => {
        // 平台运营/租户注册表走平台角色；禁止把运行时只读角色用于平台写操作。
        const url = process.env.PLATFORM_DATABASE_URL;
        if (!url) throw new Error("PLATFORM_DATABASE_URL is not configured");
        return createDatabaseClient(url);
      }
    },
    {
      provide: PrismaTenantRepository,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) => new PrismaTenantRepository(client),
      inject: [DATABASE_CLIENT]
    },
    {
      provide: TenancyService,
      useFactory: (repo: PrismaTenantRepository) => new TenancyService(repo),
      inject: [PrismaTenantRepository]
    }
  ],
  exports: [TenancyService]
})
export class TenancyModule {}

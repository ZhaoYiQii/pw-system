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
        const url = process.env.DATABASE_URL;
        if (!url) {
          // 平台后台接口在 Slice 1 使用 owner 连接串（PLATFORM_DATABASE_URL 优先）；
          // Slice 2/11 引入平台角色与审计后替换，禁止生产混用迁移凭据。
          const platformUrl = process.env.PLATFORM_DATABASE_URL;
          if (!platformUrl) throw new Error("DATABASE_URL/PLATFORM_DATABASE_URL is not configured");
          return createDatabaseClient(platformUrl);
        }
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

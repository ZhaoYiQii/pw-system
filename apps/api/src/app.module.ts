import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller.js";
import { TenancyModule } from "./modules/tenancy/tenancy.module.js";
import { IdentityAccessModule } from "./modules/identity-access/identity-access.module.js";
import { EntitlementsModule } from "./modules/entitlements/entitlements.module.js";
import { TenantConfigModule } from "./modules/tenant-config/tenant-config.module.js";

@Module({
  controllers: [HealthController],
  imports: [TenancyModule, IdentityAccessModule, TenantConfigModule, EntitlementsModule]
})
export class AppModule {}

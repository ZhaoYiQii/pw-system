import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller.js";
import { TenancyModule } from "./modules/tenancy/tenancy.module.js";
import { IdentityAccessModule } from "./modules/identity-access/identity-access.module.js";

@Module({
  controllers: [HealthController],
  imports: [TenancyModule, IdentityAccessModule]
})
export class AppModule {}

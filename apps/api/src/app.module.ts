import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller.js";
import { TenancyModule } from "./modules/tenancy/tenancy.module.js";

@Module({
  controllers: [HealthController],
  imports: [TenancyModule]
})
export class AppModule {}

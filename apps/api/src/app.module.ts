import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller.js";
import { TenancyModule } from "./modules/tenancy/tenancy.module.js";
import { IdentityAccessModule } from "./modules/identity-access/identity-access.module.js";
import { TenantConfigModule } from "./modules/tenant-config/tenant-config.module.js";
import { EntitlementsModule } from "./modules/entitlements/entitlements.module.js";
import { CustomersModule } from "./modules/customers/customers.module.js";
import { PlayersModule } from "./modules/players/players.module.js";
import { CatalogModule } from "./modules/catalog/catalog.module.js";
import { OrdersModule } from "./modules/orders/orders.module.js";
import { DispatchModule } from "./modules/dispatch/dispatch.module.js";

@Module({
  controllers: [HealthController],
  imports: [
    TenancyModule,
    IdentityAccessModule,
    TenantConfigModule,
    EntitlementsModule,
    CustomersModule,
    PlayersModule,
    CatalogModule,
    OrdersModule,
    DispatchModule
  ]
})
export class AppModule {}

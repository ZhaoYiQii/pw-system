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
import { ServiceSessionsModule } from "./modules/service-sessions/service-sessions.module.js";
import { LedgerModule } from "./modules/ledger/ledger.module.js";
import { AuditModule } from "./modules/audit/audit.module.js";
import { DisputesModule } from "./modules/disputes/disputes.module.js";
import { NotificationsModule } from "./modules/notifications/notifications.module.js";
import { AiAssistantModule } from "./modules/ai-assistant/ai.module.js";

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
    DispatchModule,
    ServiceSessionsModule,
    LedgerModule,
    AuditModule,
    DisputesModule,
    NotificationsModule,
    AiAssistantModule
  ]
})
export class AppModule {}

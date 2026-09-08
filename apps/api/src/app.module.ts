import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { HealthController } from "./health/health.controller.js";
import { ReadyController } from "./health/ready.controller.js";
import { HealthService } from "./health/health.service.js";
import { TenantContextInterceptor } from "./common/tenant-context/tenant-context.interceptor.js";
import { RequestContextMiddleware } from "./common/http/request-context.middleware.js";
import { HttpErrorFilter } from "./common/http/http-error.filter.js";
import { ValidationInterceptor } from "./common/validation/validation.interceptor.js";
import "./common/validation/api-validation-rules.js";
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
import { PlatformBillingModule } from "./modules/platform-billing/platform-billing.module.js";
import { PlatformOpsModule } from "./modules/platform-ops/platform-ops.module.js";
import { PlatformAccountsModule } from "./modules/platform-accounts/platform-accounts.module.js";
import { GameDispatchModule } from "./modules/game-dispatch/game-dispatch.module.js";
import { WalletModule } from "./modules/wallet/wallet.module.js";

@Module({
  controllers: [HealthController, ReadyController],
  imports: [
    TenancyModule,
    AuditModule,
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
    DisputesModule,
    NotificationsModule,
    AiAssistantModule,
    PlatformBillingModule,
    PlatformOpsModule,
    PlatformAccountsModule,
    GameDispatchModule,
    WalletModule,
  ],
  providers: [
    HealthService,
    {
      provide: APP_FILTER,
      useClass: HttpErrorFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantContextInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ValidationInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes("*");
  }
}

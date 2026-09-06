import { Module } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { DisputesService } from "./disputes.service.js";
import { DisputesController } from "./disputes.controller.js";
import { AuditModule } from "../audit/audit.module.js";
import { AuditService } from "../audit/audit.service.js";
import { CustomersModule } from "../customers/customers.module.js";
import { OrdersModule } from "../orders/orders.module.js";

export const DISPUTES_DB_CLIENT = "DISPUTES_DB_CLIENT";

@Module({
  imports: [AuditModule, CustomersModule, OrdersModule],
  controllers: [DisputesController],
  providers: [
    { provide: DISPUTES_DB_CLIENT, useFactory: () => { const url = process.env.DATABASE_URL; if (!url) throw new Error("db url missing"); return createDatabaseClient(url); } },
    { provide: DisputesService, useFactory: (c: ReturnType<typeof createDatabaseClient>, a: AuditService) => new DisputesService(c, a), inject: [DISPUTES_DB_CLIENT, AuditService] }
  ],
  exports: [DisputesService]
})
export class DisputesModule {}

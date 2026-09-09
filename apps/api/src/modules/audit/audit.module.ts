import { Global, Module } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { PlatformAccountsModule } from "../platform-accounts/platform-accounts.module.js";
import { AuditService } from "./audit.service.js";
import {
  AuditController,
  PlatformAuditController,
  PlatformAuditAggregateController,
} from "./audit.controller.js";

export const AUDIT_DB_CLIENT = "AUDIT_DB_CLIENT";

@Global()
@Module({
  imports: [PlatformAccountsModule],
  controllers: [
    AuditController,
    PlatformAuditController,
    PlatformAuditAggregateController,
  ],
  providers: [
    {
      provide: AUDIT_DB_CLIENT,
      useFactory: () => {
        const url =
          process.env.PLATFORM_DATABASE_URL ?? process.env.DATABASE_URL;
        if (!url) throw new Error("db url missing");
        return createDatabaseClient(url);
      },
    },
    {
      provide: AuditService,
      useFactory: (c: ReturnType<typeof createDatabaseClient>) =>
        new AuditService(c),
      inject: [AUDIT_DB_CLIENT],
    },
  ],
  exports: [AuditService],
})
export class AuditModule {}

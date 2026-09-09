import { Module } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { tenantGuarded } from "../../common/database/tenant-guard.js";
import { DashboardSummaryService } from "./application/dashboard-summary.service.js";
import { DashboardSummaryController } from "./interface/dashboard-summary.controller.js";

export const REPORTING_DB_CLIENT = "REPORTING_DB_CLIENT";

@Module({
  controllers: [DashboardSummaryController],
  providers: [
    {
      provide: REPORTING_DB_CLIENT,
      useFactory: () => {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error("DATABASE_URL (runtime) is not configured");
        return createDatabaseClient(url);
      },
    },
    {
      provide: DashboardSummaryService,
      useFactory: (client: ReturnType<typeof createDatabaseClient>) =>
        tenantGuarded(client, new DashboardSummaryService(client)),
      inject: [REPORTING_DB_CLIENT],
    },
  ],
  exports: [DashboardSummaryService],
})
export class ReportingModule {}

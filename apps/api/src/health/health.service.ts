import { Injectable } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";

export interface HealthChecks {
  database: "up" | "down";
  redis: "up" | "down" | "skipped";
}

@Injectable()
export class HealthService {
  async checks(): Promise<HealthChecks> {
    const url =
      process.env.PLATFORM_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
    let database: HealthChecks["database"] = "down";
    if (url) {
      try {
        const client = createDatabaseClient(url);
        try {
          await client.$queryRaw`SELECT 1`;
          database = "up";
        } finally {
          await client.$disconnect();
        }
      } catch {
        database = "down";
      }
    }
    return {
      database,
      redis: process.env.REDIS_URL ? "down" : "skipped",
    };
  }
}

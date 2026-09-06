import { Injectable } from "@nestjs/common";
import { createDatabaseClient } from "@pw/database";
import { Redis } from "ioredis";

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
      redis: process.env.REDIS_URL
        ? await pingRedis(process.env.REDIS_URL)
        : "skipped",
    };
  }
}

async function pingRedis(url: string): Promise<"up" | "down"> {
  const redis = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
  });
  try {
    await redis.connect();
    await redis.ping();
    return "up";
  } catch {
    return "down";
  } finally {
    redis.disconnect();
  }
}

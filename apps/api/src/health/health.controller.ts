import { Controller, Get, Inject } from "@nestjs/common";
import { Public } from "../common/auth/decorators.js";
import { HealthService } from "./health.service.js";

export interface HealthResult {
  status: "ok";
  service: "api";
  checks: {
    database: "up" | "down";
    redis: "up" | "down" | "skipped";
  };
}

@Controller("health")
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Public()
  @Get()
  async getHealth(): Promise<HealthResult> {
    return {
      status: "ok",
      service: "api",
      checks: await this.health.checks(),
    };
  }
}

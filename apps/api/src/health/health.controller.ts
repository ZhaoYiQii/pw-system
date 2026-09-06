import { Controller, Get } from "@nestjs/common";

export interface HealthResult {
  status: "ok";
  service: "api";
}

@Controller("health")
export class HealthController {
  @Get()
  getHealth(): HealthResult {
    return { status: "ok", service: "api" };
  }
}

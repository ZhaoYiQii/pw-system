import { Controller, Get } from "@nestjs/common";
import { Public } from "../common/auth/decorators.js";

export interface HealthResult {
  status: "ok";
  service: "api";
}

@Controller("health")
export class HealthController {
  @Public()
  @Get()
  getHealth(): HealthResult {
    return { status: "ok", service: "api" };
  }
}

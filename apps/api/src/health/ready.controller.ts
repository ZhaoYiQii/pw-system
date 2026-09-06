import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Public } from "../common/auth/decorators.js";
import { HealthChecks, HealthService } from "./health.service.js";

@Controller("ready")
export class ReadyController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  /** 就绪门禁：数据库可达才返回 200，否则 503。 */
  @Public()
  @Get()
  async ready(): Promise<{ status: "ready"; checks: HealthChecks }> {
    const checks = await this.health.checks();
    if (checks.database !== "up") {
      throw new ServiceUnavailableException({
        status: HttpStatus.SERVICE_UNAVAILABLE,
        checks,
      });
    }
    return { status: "ready", checks };
  }
}

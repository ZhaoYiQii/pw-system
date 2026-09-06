import { Controller, Get, Req } from "@nestjs/common";
import { PlatformScope, TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";

@Controller("api/v1")
export class MeController {
  @PlatformScope()
  @Get("platform/me")
  platformMe(@Req() req: AuthenticatedRequest) {
    return { data: req.principal };
  }

  @TenantScope()
  @Get("tenant/me")
  tenantMe(@Req() req: AuthenticatedRequest) {
    return { data: req.principal };
  }
}

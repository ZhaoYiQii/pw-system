import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { PlatformBillingService } from "./platform-billing.service.js";
import { PlatformScope, Permissions } from "../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../common/auth/auth.guard.js";

function bad(error: unknown): never {
  throw new HttpException(
    error instanceof Error ? error.message : String(error),
    HttpStatus.BAD_REQUEST,
  );
}

@Controller("api/v1/platform")
export class PlatformBillingController {
  constructor(
    @Inject(PlatformBillingService)
    private readonly svc: PlatformBillingService,
  ) {}

  @PlatformScope()
  @Permissions("platform.manage")
  @Get("packages")
  async packages() {
    return { data: await this.svc.listPackages() };
  }

  @PlatformScope()
  @Permissions("platform.manage")
  @Post("onboarding/tenants")
  async onboard(
    @Req() req: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      const input: {
        code: string;
        name: string;
        host: string;
        ownerUsername: string;
        ownerPassword: string;
        brandPrimary?: string;
        brandAccent?: string;
        logoText?: string;
        storeCutBp?: number;
        packageCode?: string;
      } = {
        code: String(body.code ?? ""),
        name: String(body.name ?? ""),
        host: String(body.host ?? ""),
        ownerUsername: String(body.ownerUsername ?? ""),
        ownerPassword: String(body.ownerPassword ?? ""),
      };
      if (typeof body.brandPrimary === "string")
        input.brandPrimary = body.brandPrimary;
      if (typeof body.brandAccent === "string")
        input.brandAccent = body.brandAccent;
      if (typeof body.logoText === "string") input.logoText = body.logoText;
      if (typeof body.storeCutBp === "number")
        input.storeCutBp = body.storeCutBp;
      if (typeof body.packageCode === "string")
        input.packageCode = body.packageCode;
      return {
        data: await this.svc.onboard(input, req.principal?.sub ?? "platform"),
      };
    } catch (error) {
      bad(error);
    }
  }

  @PlatformScope()
  @Permissions("platform.manage")
  @Post("tenants/:tenantId/package")
  async assign(
    @Req() req: AuthenticatedRequest,
    @Param("tenantId") tenantId: string,
    @Body() body: { packageCode?: unknown },
  ) {
    try {
      return {
        data: await this.svc.assignPackage(
          tenantId,
          String(body.packageCode ?? ""),
          req.principal?.sub ?? "platform",
        ),
      };
    } catch (error) {
      bad(error);
    }
  }

  @PlatformScope()
  @Permissions("platform.manage")
  @Post("tenants/:tenantId/activate")
  async activate(
    @Req() req: AuthenticatedRequest,
    @Param("tenantId") tenantId: string,
  ) {
    try {
      return {
        data: await this.svc.activate(
          tenantId,
          req.principal?.sub ?? "platform",
        ),
      };
    } catch (error) {
      bad(error);
    }
  }

  @PlatformScope()
  @Permissions("platform.manage")
  @Post("subscriptions/:subscriptionId/renew")
  async renew(
    @Req() req: AuthenticatedRequest,
    @Param("subscriptionId") subscriptionId: string,
    @Body() body: { months?: unknown; note?: unknown },
  ) {
    try {
      return {
        data: await this.svc.renewSubscription(
          subscriptionId,
          body.months,
          req.principal?.sub ?? "platform",
          body.note,
        ),
      };
    } catch (error) {
      bad(error);
    }
  }
}

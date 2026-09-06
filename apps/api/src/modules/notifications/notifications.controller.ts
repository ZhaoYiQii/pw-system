import { Controller, Get, HttpException, HttpStatus, Inject, Req } from "@nestjs/common";
import type { PrismaClient } from "@pw/database";
import { NOTIFY_DB_CLIENT } from "./tokens.js";
import { TenantScope } from "../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../common/auth/auth.guard.js";

@Controller("api/v1/tenant/notifications")
export class NotificationsController {
  constructor(@Inject(NOTIFY_DB_CLIENT) private readonly client: PrismaClient) {}

  @TenantScope()
  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    const tenantId = req.principal?.tenantId;
    if (!tenantId) throw new HttpException("tenant missing", HttpStatus.UNAUTHORIZED);
    const rows = await this.client.notificationDelivery.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 50
    });
    return { data: rows.map((r) => ({ id: r.id, channel: r.channel, title: r.title, content: r.content, createdAt: r.createdAt })) };
  }
}
import {
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Req,
} from "@nestjs/common";
import type { DbTransaction, Prisma, PrismaClient } from "@pw/database";
import { withTenantContext } from "@pw/database";
import { NOTIFY_DB_CLIENT } from "./tokens.js";
import { TenantScope } from "../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../common/auth/auth.guard.js";
import { CustomersService } from "../customers/application/customers.service.js";
import { PlayersService } from "../players/application/players.service.js";

const STAFF_ROLES = new Set([
  "TENANT_OWNER",
  "TENANT_ADMIN",
  "CUSTOMER_SERVICE",
  "FINANCE",
]);

@Controller("api/v1/tenant/notifications")
export class NotificationsController {
  constructor(
    @Inject(NOTIFY_DB_CLIENT) private readonly client: PrismaClient,
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(PlayersService) private readonly players: PlayersService,
  ) {}

  @TenantScope()
  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    const tenantId = req.principal?.tenantId;
    if (!tenantId)
      throw new HttpException("tenant missing", HttpStatus.UNAUTHORIZED);
    return withTenantContext(
      this.client,
      tenantId,
      async (tx: DbTransaction) => {
        const role = req.principal?.role;
        const where: Prisma.NotificationDeliveryWhereInput = { tenantId };

        if (role !== undefined && STAFF_ROLES.has(role)) {
          // 员工可见整店通知
        } else if (role === "CUSTOMER") {
          const profile = await this.customers
            .getByAccount(tenantId, req.principal?.sub ?? "")
            .catch(() => null);
          if (!profile) throw new ForbiddenException("尚未绑定客户档案");
          const orders = await tx.order.findMany({
            where: { tenantId, customerProfileId: profile.id },
            select: { id: true },
          });
          const ids = orders.map((o) => o.id);
          if (ids.length === 0) return { data: [] };
          where.recipientType = "order";
          where.recipientId = { in: ids };
        } else if (role === "PLAYER") {
          const player = await this.players
            .getByAccount(tenantId, req.principal?.sub ?? "")
            .catch(() => null);
          if (!player) throw new ForbiddenException("尚未绑定陪玩档案");
          const [assignments, applications] = await Promise.all([
            tx.assignment.findMany({
              where: { tenantId, playerId: player.id },
              select: { orderId: true },
            }),
            tx.application.findMany({
              where: { tenantId, playerId: player.id },
              select: { orderId: true },
            }),
          ]);
          const ids = Array.from(
            new Set([...assignments, ...applications].map((r) => r.orderId)),
          );
          if (ids.length === 0) return { data: [] };
          where.recipientType = "order";
          where.recipientId = { in: ids };
        } else {
          throw new ForbiddenException("无权查看通知");
        }

        const rows = await tx.notificationDelivery.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: 50,
        });
        return {
          data: rows.map((r) => ({
            id: r.id,
            channel: r.channel,
            title: r.title,
            content: r.content,
            createdAt: r.createdAt,
          })),
        };
      },
    );
  }
}

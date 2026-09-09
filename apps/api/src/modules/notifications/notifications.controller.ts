import {
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
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

  /** 按会话角色计算可见通知过滤条件；不可见角色抛 403。 */
  private async listWhere(
    req: AuthenticatedRequest,
    tx: DbTransaction,
    tenantId: string,
  ): Promise<Prisma.NotificationDeliveryWhereInput> {
    const role = req.principal?.role;
    const where: Prisma.NotificationDeliveryWhereInput = { tenantId };
    if (role !== undefined && STAFF_ROLES.has(role)) {
      // 员工可见整店通知
      return where;
    }
    if (role === "CUSTOMER") {
      const profile = await this.customers
        .getByAccount(tenantId, req.principal?.sub ?? "")
        .catch(() => null);
      if (!profile) throw new ForbiddenException("尚未绑定客户档案");
      const orders = await tx.order.findMany({
        where: { tenantId, customerProfileId: profile.id },
        select: { id: true },
      });
      where.recipientType = "order";
      where.recipientId = { in: orders.map((o) => o.id) };
      return where;
    }
    if (role === "PLAYER") {
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
      where.recipientType = "order";
      where.recipientId = { in: ids };
      return where;
    }
    throw new ForbiddenException("无权查看通知");
  }

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
        const where = await this.listWhere(req, tx, tenantId);
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
            readAt: r.readAt,
            createdAt: r.createdAt,
          })),
        };
      },
    );
  }

  @TenantScope()
  @Get("unread-count")
  async unreadCount(@Req() req: AuthenticatedRequest) {
    const tenantId = req.principal?.tenantId;
    if (!tenantId)
      throw new HttpException("tenant missing", HttpStatus.UNAUTHORIZED);
    return withTenantContext(
      this.client,
      tenantId,
      async (tx: DbTransaction) => {
        const where = await this.listWhere(req, tx, tenantId);
        const count = await tx.notificationDelivery.count({
          where: { ...where, readAt: null },
        });
        return { data: { count } };
      },
    );
  }

  @TenantScope()
  @Post(":id/read")
  async markRead(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    const tenantId = req.principal?.tenantId;
    if (!tenantId)
      throw new HttpException("tenant missing", HttpStatus.UNAUTHORIZED);
    return withTenantContext(this.client, tenantId, async (tx) => {
      const where = await this.listWhere(req, tx, tenantId);
      const row = await tx.notificationDelivery.findFirst({
        where: { ...where, id },
        select: { id: true },
      });
      if (!row) throw new HttpException("通知不存在", HttpStatus.NOT_FOUND);
      await tx.notificationDelivery.update({
        where: { id },
        data: { readAt: new Date() },
      });
      return { data: { id, read: true } };
    });
  }

  @TenantScope()
  @Post("read-all")
  async markAllRead(@Req() req: AuthenticatedRequest) {
    const tenantId = req.principal?.tenantId;
    if (!tenantId)
      throw new HttpException("tenant missing", HttpStatus.UNAUTHORIZED);
    return withTenantContext(this.client, tenantId, async (tx) => {
      const where = await this.listWhere(req, tx, tenantId);
      const res = await tx.notificationDelivery.updateMany({
        where: { ...where, readAt: null },
        data: { readAt: new Date() },
      });
      return { data: { updated: res.count } };
    });
  }
}

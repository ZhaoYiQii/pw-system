import {
  Body,
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
import {
  DisputesService,
  DisputeEarningMismatchError,
  DisputeNoPlayerError,
  DisputeOrderNotFoundError,
  InvalidDisputeInputError,
} from "./disputes.service.js";
import { CustomersService } from "../customers/application/customers.service.js";
import { OrdersService } from "../orders/application/orders.service.js";
import { Permissions, TenantScope } from "../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../common/auth/auth.guard.js";

function tenantIdOf(req: AuthenticatedRequest): string {
  const id = req.principal?.tenantId;
  if (!id) throw new HttpException("tenant missing", HttpStatus.UNAUTHORIZED);
  return id;
}
function bad(error: unknown): never {
  throw new HttpException(
    error instanceof Error ? error.message : String(error),
    HttpStatus.CONFLICT,
  );
}
function badOpen(error: unknown): never {
  if (error instanceof DisputeOrderNotFoundError)
    throw new HttpException(error.message, HttpStatus.NOT_FOUND);
  if (
    error instanceof DisputeEarningMismatchError ||
    error instanceof DisputeNoPlayerError ||
    error instanceof InvalidDisputeInputError
  ) {
    throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
  }
  bad(error);
}

@Controller("api/v1/tenant")
export class DisputesController {
  constructor(
    @Inject(DisputesService) private readonly disputes: DisputesService,
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(OrdersService) private readonly orders: OrdersService,
  ) {}

  /** 客服/店主端租户级争议列表（客户只能按订单维度查看自己的争议）。 */
  @TenantScope()
  @Permissions("dispute.manage")
  @Get("disputes")
  async listAll(@Req() req: AuthenticatedRequest) {
    if (req.principal?.role === "CUSTOMER")
      throw new ForbiddenException("客户请按订单查看争议");
    return { data: await this.disputes.list(tenantIdOf(req)) };
  }

  @TenantScope()
  @Permissions("dispute.manage")
  @Get("orders/:orderId/disputes")
  async list(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
  ) {
    const role = req.principal?.role;
    if (role === "CUSTOMER") {
      const profile = await this.customers
        .getByAccount(tenantIdOf(req), req.principal?.sub ?? "")
        .catch(() => null);
      if (!profile) throw new ForbiddenException("尚未绑定客户档案");
      const order = await this.orders
        .get(tenantIdOf(req), orderId)
        .catch(() => null);
      if (!order || order.customerProfileId !== profile.id)
        throw new ForbiddenException("只能查看自己订单的争议");
    }
    return { data: await this.disputes.list(tenantIdOf(req), orderId) };
  }

  @TenantScope()
  @Permissions("dispute.manage")
  @Post("orders/:orderId/disputes")
  async open(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
    @Body() body: { reason?: unknown; earningId?: unknown },
  ) {
    const role = req.principal?.role;
    if (role === "CUSTOMER") {
      const profile = await this.customers
        .getByAccount(tenantIdOf(req), req.principal?.sub ?? "")
        .catch(() => null);
      if (!profile) throw new ForbiddenException("尚未绑定客户档案");
      const order = await this.orders
        .get(tenantIdOf(req), orderId)
        .catch(() => null);
      if (!order || order.customerProfileId !== profile.id)
        throw new ForbiddenException("只能对自己订单的争议");
    }
    try {
      return {
        data: await this.disputes.open(
          tenantIdOf(req),
          orderId,
          String(body.reason ?? ""),
          typeof body.earningId === "string" ? body.earningId : null,
          req.principal?.sub ?? "system",
          role ?? "system",
        ),
      };
    } catch (error) {
      badOpen(error);
    }
  }

  @TenantScope()
  @Permissions("dispute.manage")
  @Post("disputes/:disputeId/resolve")
  async resolve(
    @Req() req: AuthenticatedRequest,
    @Param("disputeId") disputeId: string,
    @Body() body: { resolution?: unknown },
  ) {
    const role = req.principal?.role;
    if (role !== "TENANT_OWNER" && role !== "CUSTOMER_SERVICE")
      throw new ForbiddenException("仅客服/店主可处理争议");
    try {
      return {
        data: await this.disputes.resolve(
          tenantIdOf(req),
          disputeId,
          req.principal?.sub ?? "system",
          String(body.resolution ?? ""),
        ),
      };
    } catch (error) {
      bad(error);
    }
  }
}

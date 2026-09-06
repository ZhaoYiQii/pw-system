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
import { DispatchService } from "../application/dispatch.service.js";
import {
  ApplicationConflictError,
  AssignmentExistsError,
  DispatchNotFoundError,
  OrderStateConflictError,
} from "../domain/errors.js";
import { CustomersService } from "../../customers/application/customers.service.js";
import { OrdersService } from "../../orders/application/orders.service.js";
import { TenantScope } from "../../../common/auth/decorators.js";
import { RequireAddon } from "../../../common/auth/entitlement.guard.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { AuditService } from "../../audit/audit.service.js";

/** 老板端（客户自助）：查看本人订单候选并选人。 */
@RequireAddon("addon.customer_self_service")
@Controller("api/v1/tenant/customer")
export class DispatchCustomerController {
  constructor(
    @Inject(DispatchService) private readonly dispatch: DispatchService,
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async ctxOf(
    req: AuthenticatedRequest,
    orderId: string,
  ): Promise<{
    tenantId: string;
    accountId: string;
    customerProfileId: string;
  }> {
    const p = req.principal;
    if (!p?.tenantId || p.role !== "CUSTOMER")
      throw new ForbiddenException("需要客户身份");
    const profile = await this.customers
      .getByAccount(p.tenantId, p.sub)
      .catch(() => {
        throw new ForbiddenException("尚未绑定客户档案");
      });
    const order = await this.orders.get(p.tenantId, orderId).catch(() => {
      throw new HttpException("订单不存在", HttpStatus.NOT_FOUND);
    });
    if (order.customerProfileId !== profile.id)
      throw new ForbiddenException("只能查看/操作自己的订单");
    return {
      tenantId: p.tenantId,
      accountId: p.sub,
      customerProfileId: profile.id,
    };
  }

  private mapError(error: unknown): never {
    if (error instanceof DispatchNotFoundError)
      throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    if (
      error instanceof OrderStateConflictError ||
      error instanceof ApplicationConflictError ||
      error instanceof AssignmentExistsError
    ) {
      throw new HttpException(error.message, HttpStatus.CONFLICT);
    }
    if (error instanceof HttpException) throw error;
    throw new HttpException(
      error instanceof Error ? error.message : String(error),
      HttpStatus.BAD_REQUEST,
    );
  }

  @TenantScope()
  @Get("orders/:orderId/applications")
  async candidates(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
  ) {
    const ctx = await this.ctxOf(req, orderId);
    return { data: await this.dispatch.applications(ctx.tenantId, orderId) };
  }

  @TenantScope()
  @Post("orders/:orderId/assignment")
  async select(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
    @Body() body: { applicationId?: unknown },
  ) {
    const ctx = await this.ctxOf(req, orderId);
    try {
      const assigned = await this.dispatch.assign(
        ctx.tenantId,
        orderId,
        body.applicationId as string,
        ctx.accountId,
      );
      await this.audit.record({
        tenantId: ctx.tenantId,
        actorType: "CUSTOMER",
        actorId: ctx.accountId,
        action: "dispatch.assign",
        resourceType: "assignment",
        resourceId: assigned.id,
        summary: "客户自助选人",
      });
      return { data: assigned };
    } catch (error) {
      this.mapError(error);
    }
  }
}

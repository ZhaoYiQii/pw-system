import { Body, Controller, ForbiddenException, Get, HttpException, HttpStatus, Inject, Param, Post, Req } from "@nestjs/common";
import { CustomersService } from "../application/customers.service.js";
import { CustomerNotFoundError } from "../domain/errors.js";
import { OrdersService } from "../../orders/application/orders.service.js";
import { LedgerService } from "../../ledger/application/ledger.service.js";
import { TenantScope } from "../../../common/auth/decorators.js";
import { RequireAddon } from "../../../common/auth/entitlement.guard.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { AuditService } from "../../audit/audit.service.js";
import { ApiCreatedResponse, ApiOkResponse } from "@nestjs/swagger";
import { accountingResultSchema, dataArraySchema, dataSchema, orderSchema } from "../../../openapi/schemas.js";

@RequireAddon("addon.customer_self_service")
@Controller("api/v1/tenant/customer")
export class CustomerSelfController {
  constructor(
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(AuditService) private readonly audit: AuditService
  ) {}

  private requireCustomer(req: AuthenticatedRequest): { tenantId: string; accountId: string } {
    const p = req.principal;
    if (!p?.tenantId || p.role !== "CUSTOMER") throw new ForbiddenException("需要客户身份");
    return { tenantId: p.tenantId, accountId: p.sub };
  }

  @TenantScope()
  @Get("me")
  async me(@Req() req: AuthenticatedRequest) {
    const ctx = this.requireCustomer(req);
    try {
      return { data: await this.customers.getByAccount(ctx.tenantId, ctx.accountId) };
    } catch (error) {
      if (error instanceof CustomerNotFoundError) {
        throw new HttpException("尚未绑定客户档案", HttpStatus.NOT_FOUND);
      }
      throw error;
    }
  }

  @TenantScope()
  @Get("orders")
  @ApiOkResponse({ schema: dataArraySchema(orderSchema) as never })
  async myOrders(@Req() req: AuthenticatedRequest) {
    const ctx = this.requireCustomer(req);
    try {
      const profile = await this.customers.getByAccount(ctx.tenantId, ctx.accountId);
      return { data: await this.orders.listByCustomer(ctx.tenantId, profile.id) };
    } catch (error) {
      if (error instanceof CustomerNotFoundError) {
        throw new HttpException("尚未绑定客户档案", HttpStatus.NOT_FOUND);
      }
      throw error;
    }
  }

  @TenantScope()
  @Post("orders")
  @ApiCreatedResponse({ schema: dataSchema(orderSchema) as never })
  async createOrder(@Req() req: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    const ctx = this.requireCustomer(req);
    try {
      const profile = await this.customers.getByAccount(ctx.tenantId, ctx.accountId);
      const created = await this.orders.create(ctx.tenantId, ctx.accountId, {
        customerProfileId: profile.id,
        requirement: ((body.requirement as Record<string, unknown> | undefined) ?? {}) as never
      } as never);
      await this.audit.record({
        tenantId: ctx.tenantId,
        actorType: "CUSTOMER",
        actorId: ctx.accountId,
        action: "order.create",
        resourceType: "order",
        resourceId: created.id,
        summary: `客户自助创建订单 ${created.orderNo}`
      });
      return {
        data: created
      };
    } catch (error) {
      if (error instanceof CustomerNotFoundError) {
        throw new HttpException("尚未绑定客户档案", HttpStatus.NOT_FOUND);
      }
      if (error instanceof HttpException) throw error;
      throw new HttpException(error instanceof Error ? error.message : String(error), HttpStatus.BAD_REQUEST);
    }
  }

  /** 老板确认完成：PENDING_CONFIRMATION → COMPLETED（并完成核算）。 */
  @TenantScope()
  @Post("orders/:orderId/complete")
  @ApiCreatedResponse({ schema: dataSchema(accountingResultSchema) as never })
  async confirmComplete(@Req() req: AuthenticatedRequest, @Param("orderId") orderId: string) {
    const ctx = this.requireCustomer(req);
    try {
      const profile = await this.customers.getByAccount(ctx.tenantId, ctx.accountId);
      const order = await this.orders.get(ctx.tenantId, orderId);
      if (order.customerProfileId !== profile.id) throw new ForbiddenException("只能确认自己的订单");
      const result = await this.ledger.completeAccounting(ctx.tenantId, orderId, ctx.accountId);
      if (!result) throw new HttpException("订单未处于待确认状态或场次未结束", HttpStatus.CONFLICT);
      await this.audit.record({
        tenantId: ctx.tenantId,
        actorType: "CUSTOMER",
        actorId: ctx.accountId,
        action: "order.customer_confirm",
        resourceType: "order",
        resourceId: orderId,
        summary: "客户确认完成订单"
      });
      return { data: result };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(error instanceof Error ? error.message : String(error), HttpStatus.CONFLICT);
    }
  }
}

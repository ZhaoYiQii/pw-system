import { Body, Controller, ForbiddenException, Get, HttpException, HttpStatus, Inject, Post, Req } from "@nestjs/common";
import { CustomersService } from "../application/customers.service.js";
import { CustomerNotFoundError } from "../domain/errors.js";
import { OrdersService } from "../../orders/application/orders.service.js";
import { TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";

@Controller("api/v1/tenant/customer")
export class CustomerSelfController {
  constructor(
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(OrdersService) private readonly orders: OrdersService
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
  async createOrder(@Req() req: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    const ctx = this.requireCustomer(req);
    try {
      const profile = await this.customers.getByAccount(ctx.tenantId, ctx.accountId);
      return {
        data: await this.orders.create(ctx.tenantId, ctx.accountId, {
          customerProfileId: profile.id,
          requirement: ((body.requirement as Record<string, unknown> | undefined) ?? {}) as never
        } as never)
      };
    } catch (error) {
      if (error instanceof CustomerNotFoundError) {
        throw new HttpException("尚未绑定客户档案", HttpStatus.NOT_FOUND);
      }
      if (error instanceof HttpException) throw error;
      throw new HttpException(error instanceof Error ? error.message : String(error), HttpStatus.BAD_REQUEST);
    }
  }
}
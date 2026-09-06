import { Body, Controller, Get, HttpException, HttpStatus, Inject, Param, Post, Query, Req } from "@nestjs/common";
import { OrdersService } from "../application/orders.service.js";
import {
  CustomerNotInTenantError,
  GameNotInTenantError,
  InvalidOrderInputError,
  OrderNotFoundError,
  OrderStateConflictError,
  PricingRuleMissingError,
  ProductDisabledError,
  ProductNotInTenantError
} from "../domain/errors.js";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";

function tenantIdOf(req: AuthenticatedRequest): string {
  const id = req.principal?.tenantId;
  if (!id) throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
  return id;
}

function actorIdOf(req: AuthenticatedRequest): string {
  return req.principal?.sub ?? "system";
}

@Controller("api/v1/tenant/orders")
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  private mapError(error: unknown): never {
    if (error instanceof OrderNotFoundError) throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    if (error instanceof OrderStateConflictError) throw new HttpException(error.message, HttpStatus.CONFLICT);
    if (
      error instanceof InvalidOrderInputError ||
      error instanceof CustomerNotInTenantError ||
      error instanceof GameNotInTenantError ||
      error instanceof ProductNotInTenantError ||
      error instanceof PricingRuleMissingError ||
      error instanceof ProductDisabledError
    ) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
    throw error;
  }

  @TenantScope()
  @Permissions("order.manage")
  @Get()
  async list(@Req() req: AuthenticatedRequest, @Query("status") status?: unknown) {
    const s = typeof status === "string" && status ? status : undefined;
    return { data: await this.orders.list(tenantIdOf(req), s) };
  }

  @TenantScope()
  @Permissions("order.manage")
  @Post()
  async create(@Req() req: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    try {
      return {
        data: await this.orders.create(tenantIdOf(req), actorIdOf(req), {
          customerProfileId: body.customerProfileId as string,
          ...(body.orderNo !== undefined ? { orderNo: body.orderNo as string } : {}),
          ...(body.remark !== undefined ? { remark: body.remark as string | null } : {}),
          ...(body.idempotencyKey !== undefined ? { idempotencyKey: body.idempotencyKey as string } : {}),
          requirement: (body.requirement as Record<string, unknown> | undefined) ?? {}
        } as never)
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("order.manage")
  @Get(":id")
  async get(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    try {
      return { data: await this.orders.get(tenantIdOf(req), id) };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("order.manage")
  @Post(":id/confirm")
  async confirm(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    try {
      return { data: await this.orders.confirm(tenantIdOf(req), id, actorIdOf(req)) };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("order.manage")
  @Post(":id/cancel")
  async cancel(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: { reason?: unknown }) {
    try {
      return {
        data: await this.orders.cancel(tenantIdOf(req), id, actorIdOf(req), body && typeof body.reason === "string" ? body.reason : null)
      };
    } catch (error) {
      this.mapError(error);
    }
  }
}
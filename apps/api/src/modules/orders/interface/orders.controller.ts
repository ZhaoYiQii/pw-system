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
  Query,
  Req,
} from "@nestjs/common";
import { OrdersService } from "../application/orders.service.js";
import { LedgerService } from "../../ledger/application/ledger.service.js";
import {
  CustomerNotInTenantError,
  GameNotInTenantError,
  InvalidOrderInputError,
  OrderNotFoundError,
  OrderStateConflictError,
  PricingRuleMissingError,
  ProductDisabledError,
  ProductNotInTenantError,
} from "../domain/errors.js";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { AuditService } from "../../audit/audit.service.js";
import { ApiCreatedResponse, ApiOkResponse } from "@nestjs/swagger";
import {
  accountingResultSchema,
  dataArraySchema,
  dataSchema,
  orderSchema,
} from "../../../openapi/schemas.js";

function tenantIdOf(req: AuthenticatedRequest): string {
  const id = req.principal?.tenantId;
  if (!id)
    throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
  return id;
}

function actorIdOf(req: AuthenticatedRequest): string {
  return req.principal?.sub ?? "system";
}

@Controller("api/v1/tenant/orders")
export class OrdersController {
  constructor(
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private mapError(error: unknown): never {
    if (error instanceof OrderNotFoundError)
      throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    if (error instanceof OrderStateConflictError)
      throw new HttpException(error.message, HttpStatus.CONFLICT);
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
  @ApiOkResponse({ schema: dataArraySchema(orderSchema) as never })
  async list(
    @Req() req: AuthenticatedRequest,
    @Query("status") status?: unknown,
  ) {
    const s = typeof status === "string" && status ? status : undefined;
    return { data: await this.orders.list(tenantIdOf(req), s) };
  }

  @TenantScope()
  @Permissions("order.manage")
  @Post()
  @ApiCreatedResponse({ schema: dataSchema(orderSchema) as never })
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      const created = await this.orders.create(
        tenantIdOf(req),
        actorIdOf(req),
        {
          customerProfileId: body.customerProfileId as string,
          ...(body.orderNo !== undefined
            ? { orderNo: body.orderNo as string }
            : {}),
          ...(body.remark !== undefined
            ? { remark: body.remark as string | null }
            : {}),
          ...(body.idempotencyKey !== undefined
            ? { idempotencyKey: body.idempotencyKey as string }
            : {}),
          requirement:
            (body.requirement as Record<string, unknown> | undefined) ?? {},
        } as never,
      );
      await this.audit.record({
        tenantId: tenantIdOf(req),
        actorType: req.principal?.role,
        actorId: actorIdOf(req),
        action: "order.create",
        resourceType: "order",
        resourceId: created.id,
        summary: `创建订单 ${created.orderNo}`,
      });
      return { data: created };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("order.manage")
  @Get(":id")
  @ApiOkResponse({ schema: dataSchema(orderSchema) as never })
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
  @ApiCreatedResponse({ schema: dataSchema(orderSchema) as never })
  async confirm(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    try {
      const updated = await this.orders.confirm(
        tenantIdOf(req),
        id,
        actorIdOf(req),
      );
      await this.audit.record({
        tenantId: tenantIdOf(req),
        actorType: req.principal?.role,
        actorId: actorIdOf(req),
        action: "order.confirm",
        resourceType: "order",
        resourceId: id,
        summary: `确认订单 ${updated.orderNo}`,
      });
      return { data: updated };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("order.manage")
  @Post(":id/cancel")
  @ApiCreatedResponse({ schema: dataSchema(orderSchema) as never })
  async cancel(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: { reason?: unknown },
  ) {
    try {
      const updated = await this.orders.cancel(
        tenantIdOf(req),
        id,
        actorIdOf(req),
        body && typeof body.reason === "string" ? body.reason : null,
      );
      await this.audit.record({
        tenantId: tenantIdOf(req),
        actorType: req.principal?.role,
        actorId: actorIdOf(req),
        action: "order.cancel",
        resourceType: "order",
        resourceId: id,
        summary: `取消订单 ${updated.orderNo}`,
      });
      return { data: updated };
    } catch (error) {
      this.mapError(error);
    }
  }

  /** 客服/店主确认完成（含超时确认场景的人工入口）：PENDING_CONFIRMATION → COMPLETED。 */
  @TenantScope()
  @Permissions("order.manage")
  @Post(":id/staff-confirm")
  @ApiCreatedResponse({ schema: dataSchema(accountingResultSchema) as never })
  async staffConfirm(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    const role = req.principal?.role;
    if (role !== "TENANT_OWNER" && role !== "CUSTOMER_SERVICE")
      throw new ForbiddenException("仅客服/店主可确认完成");
    try {
      const result = await this.ledger.completeAccounting(
        tenantIdOf(req),
        id,
        actorIdOf(req),
      );
      if (!result)
        throw new HttpException(
          "订单未处于待确认状态或场次未结束",
          HttpStatus.CONFLICT,
        );
      await this.audit.record({
        tenantId: tenantIdOf(req),
        actorType: role,
        actorId: actorIdOf(req),
        action: "order.staff_confirm",
        resourceType: "order",
        resourceId: id,
        summary: "客服/店主确认完成订单",
      });
      return { data: result };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error ? error.message : String(error),
        HttpStatus.CONFLICT,
      );
    }
  }
}

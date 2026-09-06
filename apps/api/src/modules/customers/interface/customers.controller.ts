import { Body, Controller, Delete, Get, HttpException, HttpStatus, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { CustomersService } from "../application/customers.service.js";
import { CustomerNotFoundError, DuplicateCustomerError, InvalidCustomerInputError } from "../domain/errors.js";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";

function tenantIdOf(req: AuthenticatedRequest): string {
  const id = req.principal?.tenantId;
  if (!id) throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
  return id;
}

@Controller("api/v1/tenant/customers")
export class CustomersController {
  constructor(@Inject(CustomersService) private readonly customers: CustomersService) {}

  private mapError(error: unknown): never {
    if (error instanceof CustomerNotFoundError) throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    if (error instanceof DuplicateCustomerError) throw new HttpException(error.message, HttpStatus.CONFLICT);
    if (error instanceof InvalidCustomerInputError) throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    throw error;
  }

  @TenantScope()
  @Permissions("customer.manage")
  @Get()
  async list(@Req() req: AuthenticatedRequest, @Query("q") q?: unknown) {
    const query = typeof q === "string" && q.trim() ? q.trim() : undefined;
    return { data: await this.customers.list(tenantIdOf(req), query) };
  }

  @TenantScope()
  @Permissions("customer.manage")
  @Post()
  async create(@Req() req: AuthenticatedRequest, @Body() body: { name?: unknown; mobile?: unknown; remark?: unknown }) {
    try {
      const input: { name: string; mobile?: string | null; remark?: string | null } = { name: body.name as string };
      if (body.mobile !== undefined) input.mobile = body.mobile as string | null;
      if (body.remark !== undefined) input.remark = body.remark as string | null;
      return { data: await this.customers.create(tenantIdOf(req), input) };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("customer.manage")
  @Get(":id")
  async get(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    try {
      return { data: await this.customers.get(tenantIdOf(req), id) };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("customer.manage")
  @Patch(":id")
  async update(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: { name?: unknown; mobile?: unknown; remark?: unknown; status?: unknown }
  ) {
    try {
      const input: { name?: string; mobile?: string | null; remark?: string | null; status?: "ACTIVE" | "INACTIVE" } = {};
      if (body.name !== undefined) input.name = body.name as string;
      if (body.mobile !== undefined) input.mobile = body.mobile as string | null;
      if (body.remark !== undefined) input.remark = body.remark as string | null;
      if (body.status === "ACTIVE" || body.status === "INACTIVE") input.status = body.status;
      return { data: await this.customers.update(tenantIdOf(req), id, input) };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("customer.manage")
  @Delete(":id")
  async remove(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    try {
      await this.customers.remove(tenantIdOf(req), id);
      return { data: { ok: true } };
    } catch (error) {
      this.mapError(error);
    }
  }
}
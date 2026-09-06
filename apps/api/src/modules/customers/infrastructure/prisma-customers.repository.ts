import type { PrismaClient } from "@pw/database";
import type { CustomerView } from "../domain/customer.js";
import { AccountNotCustomerError, CustomerAccountBoundError, CustomerNotFoundError, DuplicateCustomerError } from "../domain/errors.js";

function isP2002(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002";
}
import type { CustomerInput, CustomerRepository } from "../application/customers.service.js";

function map(row: {
  id: string;
  tenantId: string;
  name: string;
  mobile: string | null;
  remark: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): CustomerView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    mobile: row.mobile,
    remark: row.remark,
    status: row.status as CustomerView["status"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export class PrismaCustomerRepository implements CustomerRepository {
  constructor(private readonly client: PrismaClient) {}

  async list(tenantId: string, query?: string): Promise<CustomerView[]> {
    const rows = await this.client.customerProfile.findMany({
      where: {
        tenantId,
        ...(query ? { OR: [{ name: { contains: query, mode: "insensitive" } }, { mobile: { contains: query } }] } : {})
      },
      orderBy: { createdAt: "desc" }
    });
    return rows.map(map);
  }

  async find(tenantId: string, id: string): Promise<CustomerView | null> {
    const row = await this.client.customerProfile.findFirst({ where: { tenantId, id } });
    return row ? map(row) : null;
  }

  async create(tenantId: string, input: CustomerInput): Promise<CustomerView> {
    try {
      const row = await this.client.customerProfile.create({
        data: {
          tenantId,
          name: input.name,
          ...(input.mobile ? { mobile: input.mobile } : {}),
          ...(input.remark ? { remark: input.remark } : {}),
          status: input.status ?? "ACTIVE"
        }
      });
      return map(row);
    } catch (error) {
      if (error !== null && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002") {
        throw new DuplicateCustomerError(input.mobile ?? undefined);
      }
      throw error;
    }
  }

  async update(tenantId: string, id: string, input: Partial<CustomerInput>): Promise<CustomerView | null> {
    try {
      const row = await this.client.customerProfile.updateMany({
        where: { tenantId, id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.mobile !== undefined ? { mobile: input.mobile } : {}),
          ...(input.remark !== undefined ? { remark: input.remark } : {}),
          ...(input.status !== undefined ? { status: input.status } : {})
        }
      });
      if (row.count === 0) return null;
      return this.find(tenantId, id);
    } catch (error) {
      if (error !== null && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002") {
        throw new DuplicateCustomerError(input.mobile ?? undefined);
      }
      throw error;
    }
  }

  async remove(tenantId: string, id: string): Promise<boolean> {
    const res = await this.client.customerProfile.deleteMany({ where: { tenantId, id } });
    return res.count > 0;
  }

  async bind(tenantId: string, customerId: string, accountId: string): Promise<CustomerView> {
    const account = await this.client.tenantAccount.findFirst({
      where: { tenantId, id: accountId, roles: { some: { role: "CUSTOMER" } } },
      select: { id: true }
    });
    if (!account) throw new AccountNotCustomerError(accountId);
    try {
      const res = await this.client.customerProfile.updateMany({
        where: { tenantId, id: customerId },
        data: { tenantAccountId: accountId }
      });
      if (res.count === 0) throw new CustomerNotFoundError(customerId);
      const row = await this.find(tenantId, customerId);
      return row as CustomerView;
    } catch (error) {
      if (isP2002(error)) throw new CustomerAccountBoundError();
      throw error;
    }
  }

  async findByAccount(tenantId: string, accountId: string): Promise<CustomerView | null> {
    const row = await this.client.customerProfile.findFirst({ where: { tenantId, tenantAccountId: accountId } });
    return row ? map(row) : null;
  }
}
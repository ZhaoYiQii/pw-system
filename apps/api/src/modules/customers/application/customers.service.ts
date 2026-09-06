import type { CustomerView } from "../domain/customer.js";
import {
  CustomerNotFoundError,
  DuplicateCustomerError,
  InvalidCustomerInputError
} from "../domain/errors.js";

export interface CustomerInput {
  name: string;
  mobile?: string | null;
  remark?: string | null;
  status?: "ACTIVE" | "INACTIVE";
}

export interface CustomerRepository {
  list(tenantId: string, query?: string): Promise<CustomerView[]>;
  find(tenantId: string, id: string): Promise<CustomerView | null>;
  create(tenantId: string, input: CustomerInput): Promise<CustomerView>;
  update(tenantId: string, id: string, input: Partial<CustomerInput>): Promise<CustomerView | null>;
  remove(tenantId: string, id: string): Promise<boolean>;
  bind(tenantId: string, customerId: string, accountId: string): Promise<CustomerView>;
}

function assertValid(input: CustomerInput | Partial<CustomerInput>): void {
  if (input.name !== undefined && (typeof input.name !== "string" || input.name.trim().length < 1 || input.name.length > 80)) {
    throw new InvalidCustomerInputError("name 需为 1-80 字符");
  }
  if (input.mobile !== undefined && input.mobile !== null) {
    if (typeof input.mobile !== "string" || !/^[0-9+\- ]{5,20}$/.test(input.mobile.trim())) {
      throw new InvalidCustomerInputError("mobile 格式非法");
    }
  }
  if (input.remark !== undefined && input.remark !== null && typeof input.remark === "string" && input.remark.length > 200) {
    throw new InvalidCustomerInputError("remark 超出 200 字符");
  }
}

export class CustomersService {
  constructor(private readonly repository: CustomerRepository) {}

  async list(tenantId: string, query?: string): Promise<CustomerView[]> {
    return this.repository.list(tenantId, query?.trim() || undefined);
  }

  async get(tenantId: string, id: string): Promise<CustomerView> {
    const row = await this.repository.find(tenantId, id);
    if (!row) throw new CustomerNotFoundError(id);
    return row;
  }

  async create(tenantId: string, input: CustomerInput): Promise<CustomerView> {
    assertValid(input);
    try {
      return await this.repository.create(tenantId, {
        name: input.name.trim(),
        mobile: input.mobile?.trim() || null,
        remark: input.remark?.trim() || null,
        status: input.status ?? "ACTIVE"
      });
    } catch (error) {
      if (error instanceof DuplicateCustomerError) throw error;
      throw error;
    }
  }

  async update(tenantId: string, id: string, input: Partial<CustomerInput>): Promise<CustomerView> {
    assertValid(input);
    const clean: Partial<CustomerInput> = {};
    if (input.name !== undefined) clean.name = input.name.trim();
    if (input.mobile !== undefined) clean.mobile = input.mobile?.trim() || null;
    if (input.remark !== undefined) clean.remark = input.remark?.trim() || null;
    if (input.status !== undefined) clean.status = input.status;
    const row = await this.repository.update(tenantId, id, clean);
    if (!row) throw new CustomerNotFoundError(id);
    return row;
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const removed = await this.repository.remove(tenantId, id);
    if (!removed) throw new CustomerNotFoundError(id);
  }

  async bind(tenantId: string, customerId: string, accountId: string): Promise<CustomerView> {
    const customer = await this.repository.find(tenantId, customerId);
    if (!customer) throw new CustomerNotFoundError(customerId);
    return this.repository.bind(tenantId, customerId, accountId);
  }
}
import type { OrderView } from "../domain/order.js";
import {
  CustomerNotInTenantError,
  GameNotInTenantError,
  InvalidOrderInputError,
  OrderNotFoundError,
  OrderStateConflictError,
  ProductNotInTenantError
} from "../domain/errors.js";

export interface RequirementInput {
  description: string;
  gameId?: string | null;
  serviceProductId?: string | null;
  gender?: string | null;
  desiredStartAt?: string | null;
  durationSeconds?: number | null;
  minBudgetFen?: number | null;
  maxBudgetFen?: number | null;
  note?: string | null;
}

export interface CreateOrderInput {
  customerProfileId: string;
  orderNo?: string;
  remark?: string | null;
  idempotencyKey?: string;
  requirement: RequirementInput;
}

export interface ProductLookup {
  id: string;
  name: string;
  regionName: string | null;
  enabled: boolean;
}

export interface OrdersRepository {
  loadFull(tenantId: string, orderId: string): Promise<OrderView | null>;
  list(tenantId: string, opts: { status?: string }): Promise<OrderView[]>;
  customerInTenant(tenantId: string, id: string): Promise<boolean>;
  gameInTenant(tenantId: string, id: string): Promise<boolean>;
  productInTenant(tenantId: string, id: string): Promise<ProductLookup | null>;
  createDraft(opts: {
    tenantId: string;
    actorId: string;
    orderNo: string;
    customerProfileId: string;
    remark: string | null;
    requirement: RequirementInput;
    idempotencyKey?: string;
  }): Promise<{ orderId: string; duplicate: boolean }>;
  confirm(tenantId: string, orderId: string, actorId: string): Promise<void>;
  cancel(tenantId: string, orderId: string, actorId: string, reason: string | null): Promise<void>;
}

const ORDER_NO_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

function randomToken(length: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export class OrdersService {
  constructor(private readonly repository: OrdersRepository) {}

  private validateRequirement(r: RequirementInput, requireProduct: boolean): void {
    if (typeof r.description !== "string" || r.description.trim().length < 2 || r.description.length > 1000) {
      throw new InvalidOrderInputError("description 需为 2-1000 字符");
    }
    if (r.gameId !== undefined && r.gameId !== null && typeof r.gameId !== "string") {
      throw new InvalidOrderInputError("gameId 非法");
    }
    if (r.serviceProductId !== undefined && r.serviceProductId !== null && typeof r.serviceProductId !== "string") {
      throw new InvalidOrderInputError("serviceProductId 非法");
    }
    if (r.gender !== undefined && r.gender !== null && typeof r.gender !== "string") {
      throw new InvalidOrderInputError("gender 非法");
    }
    if (r.desiredStartAt !== undefined && r.desiredStartAt !== null) {
      const d = new Date(r.desiredStartAt);
      if (Number.isNaN(d.getTime())) throw new InvalidOrderInputError("desiredStartAt 需为合法时间");
    }
    if (r.durationSeconds !== undefined && r.durationSeconds !== null && (!Number.isInteger(r.durationSeconds) || r.durationSeconds <= 0)) {
      throw new InvalidOrderInputError("durationSeconds 必须为正整数（秒）");
    }
    for (const key of ["minBudgetFen", "maxBudgetFen"] as const) {
      const v = r[key];
      if (v !== undefined && v !== null && (typeof v !== "number" || !Number.isInteger(v) || v < 0)) {
        throw new InvalidOrderInputError(`${key} 必须为非负整数（分）`);
      }
    }
    if (requireProduct && (r.serviceProductId === undefined || r.serviceProductId === null || r.durationSeconds === undefined || r.durationSeconds === null)) {
      throw new InvalidOrderInputError("确认订单需要 serviceProductId 与 durationSeconds");
    }
  }

  async create(tenantId: string, actorId: string, input: CreateOrderInput): Promise<OrderView> {
    this.validateRequirement(input.requirement, false);
    if (input.idempotencyKey !== undefined && (typeof input.idempotencyKey !== "string" || input.idempotencyKey.length < 8 || input.idempotencyKey.length > 100)) {
      throw new InvalidOrderInputError("idempotencyKey 需为 8-100 字符");
    }
    if (!(await this.repository.customerInTenant(tenantId, input.customerProfileId))) {
      throw new CustomerNotInTenantError(input.customerProfileId);
    }
    if (input.requirement.gameId && !(await this.repository.gameInTenant(tenantId, input.requirement.gameId))) {
      throw new GameNotInTenantError(input.requirement.gameId);
    }
    if (input.requirement.serviceProductId && !(await this.repository.productInTenant(tenantId, input.requirement.serviceProductId))) {
      throw new ProductNotInTenantError(input.requirement.serviceProductId);
    }
    let orderNo = input.orderNo?.trim() ?? "";
    if (orderNo === "") {
      orderNo = `R${Date.now().toString(36).toUpperCase()}${randomToken(5).toUpperCase()}`;
    }
    if (!ORDER_NO_PATTERN.test(orderNo)) throw new InvalidOrderInputError("orderNo 需为 1-40 位字母数字_-");
    const result = await this.repository.createDraft({
      tenantId,
      actorId,
      orderNo,
      customerProfileId: input.customerProfileId,
      remark: input.remark?.trim() || null,
      requirement: input.requirement,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {})
    });
    const view = await this.repository.loadFull(tenantId, result.orderId);
    if (!view) throw new OrderNotFoundError(result.orderId);
    return view;
  }

  async confirm(tenantId: string, orderId: string, actorId: string): Promise<OrderView> {
    const order = await this.repository.loadFull(tenantId, orderId);
    if (!order) throw new OrderNotFoundError(orderId);
    if (order.status !== "DRAFT") throw new OrderStateConflictError(orderId, order.status, "CONFIRMED");
    const req = order.requirement;
    if (!req || !req.serviceProductId || !req.durationSeconds) {
      throw new InvalidOrderInputError("确认订单需要 serviceProductId 与 durationSeconds");
    }
    await this.repository.confirm(tenantId, orderId, actorId);
    const view = await this.repository.loadFull(tenantId, orderId);
    if (!view) throw new OrderNotFoundError(orderId);
    return view;
  }

  async cancel(tenantId: string, orderId: string, actorId: string, reason: string | null): Promise<OrderView> {
    const order = await this.repository.loadFull(tenantId, orderId);
    if (!order) throw new OrderNotFoundError(orderId);
    if (order.status !== "DRAFT" && order.status !== "CONFIRMED") {
      throw new OrderStateConflictError(orderId, order.status, "CANCELLED");
    }
    await this.repository.cancel(tenantId, orderId, actorId, reason);
    const view = await this.repository.loadFull(tenantId, orderId);
    if (!view) throw new OrderNotFoundError(orderId);
    return view;
  }

  async get(tenantId: string, orderId: string): Promise<OrderView> {
    const view = await this.repository.loadFull(tenantId, orderId);
    if (!view) throw new OrderNotFoundError(orderId);
    return view;
  }

  async list(tenantId: string, status?: string): Promise<OrderView[]> {
    return this.repository.list(tenantId, { ...(status ? { status } : {}) });
  }
}
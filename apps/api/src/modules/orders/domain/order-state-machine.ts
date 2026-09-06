import type { OrderStatusType } from "./order.js";
import { OrderStateConflictError } from "./errors.js";

/** 主规格 10.1：订单状态机合法迁移表（集中定义，禁止散落魔法字符串）。 */
export const ORDER_TRANSITIONS: Record<
  OrderStatusType,
  readonly OrderStatusType[]
> = {
  DRAFT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["DISPATCHING", "CANCELLED"],
  DISPATCHING: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["READY", "CANCELLED"],
  READY: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["PENDING_CONFIRMATION"],
  PENDING_CONFIRMATION: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransition(
  from: OrderStatusType,
  to: OrderStatusType,
): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertOrderTransition(
  orderId: string,
  from: OrderStatusType,
  to: OrderStatusType,
): void {
  if (!canTransition(from, to)) {
    throw new OrderStateConflictError(orderId, from, to);
  }
}

import type { OrderStatusType } from "./order.js";
import { OrderStateConflictError } from "./errors.js";

/** 主规格 10.1：订单状态机合法迁移表（集中定义，禁止散落魔法字符串）。 */
export const ORDER_TRANSITIONS: Record<
  OrderStatusType,
  readonly OrderStatusType[]
> = {
  // ADR-0005（2026-09-21 批准）：表按代码实际行为对齐——补三条 game-dispatch 主线在用的迁移。
  // DRAFT → DISPATCHING：派单发布允许草稿直接发布（经典流程仍可先 CONFIRMED）。
  DRAFT: ["CONFIRMED", "DISPATCHING", "CANCELLED"],
  CONFIRMED: ["DISPATCHING", "CANCELLED"],
  DISPATCHING: ["ASSIGNED", "CANCELLED"],
  // ASSIGNED → IN_PROGRESS：game-dispatch 开始服务不经过 READY；
  // ASSIGNED → DISPATCHING：商家「释放名额」后回到报名阶段（Task 4）。
  ASSIGNED: ["READY", "IN_PROGRESS", "DISPATCHING", "CANCELLED"],
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

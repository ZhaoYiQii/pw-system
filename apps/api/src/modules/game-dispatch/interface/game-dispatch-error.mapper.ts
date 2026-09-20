import { HttpException, HttpStatus } from "@nestjs/common";
import {
  DispatchConflictError,
  DispatchInputError,
  DispatchNotFoundError,
  DispatchStateError,
} from "../domain/dispatch-errors.js";
import { OrderStateConflictError } from "../../orders/domain/errors.js";

/**
 * game-dispatch 模块统一的「领域错误 → HTTP」映射（ADR-0005 切片二）。
 *
 * 六个订单状态迁移点分布在两个控制器上（发布 / 选人 / 确认结算 / 释放名额在
 * `GameDispatchController`，开始 / 结束服务在 `SlotSessionController`），
 * 集中迁移表校验抛出的 `OrderStateConflictError` 必须在这里统一成 409；
 * 原先三个控制器各写一份 `mapError`，切片二的用例正是踩到 `SlotSessionController`
 * 漏映射、把表外迁移变成了 500。收敛到一处后，新增迁移点不会再漏。
 */
export function mapGameDispatchError(error: unknown): never {
  if (error instanceof DispatchNotFoundError)
    throw new HttpException(error.message, HttpStatus.NOT_FOUND);
  if (error instanceof DispatchInputError)
    throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
  if (
    error instanceof DispatchStateError ||
    error instanceof DispatchConflictError
  )
    throw new HttpException(error.message, HttpStatus.CONFLICT);
  // ADR-0005：表外订单状态迁移 → 409（与「状态不允许」同义，前端文案直接取 message）。
  if (error instanceof OrderStateConflictError)
    throw new HttpException(error.message, HttpStatus.CONFLICT);
  throw error;
}

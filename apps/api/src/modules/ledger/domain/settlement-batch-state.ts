/**
 * 结算批次状态机（DS-001）：纯领域规则，无 I/O、无副作用、不使用 Prisma 类型。
 *
 * 允许流转：DRAFT -> REVIEWED、VOID；REVIEWED -> APPROVED、VOID；APPROVED -> PAID。
 * PAID 与 VOID 为终态；禁止状态跳跃、回退与自迁移；未知状态一律拒绝，不默认允许。
 * 本模块只校验状态流转，不涉及角色权限、金额、数据库写入、事务、审计或实际打款。
 */
export type SettlementBatchStatus =
  "DRAFT" | "REVIEWED" | "APPROVED" | "PAID" | "VOID";

const ALLOWED_TRANSITIONS: Readonly<
  Record<SettlementBatchStatus, readonly SettlementBatchStatus[]>
> = {
  DRAFT: ["REVIEWED", "VOID"],
  REVIEWED: ["APPROVED", "VOID"],
  APPROVED: ["PAID"],
  PAID: [],
  VOID: [],
};

function isKnownStatus(value: unknown): value is SettlementBatchStatus {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(ALLOWED_TRANSITIONS, value)
  );
}

export function canTransitionSettlementBatch(
  from: SettlementBatchStatus,
  to: SettlementBatchStatus,
): boolean {
  if (!isKnownStatus(from) || !isKnownStatus(to)) return false;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertSettlementBatchTransition(
  from: SettlementBatchStatus,
  to: SettlementBatchStatus,
): void {
  if (!canTransitionSettlementBatch(from, to)) {
    throw new Error(
      `结算批次状态不允许从 ${String(from)} 变更为 ${String(to)}`,
    );
  }
}

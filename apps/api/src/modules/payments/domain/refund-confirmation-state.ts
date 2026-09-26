/**
 * 退款确认状态机（DS-004）：纯领域规则，无 I/O、无副作用，
 * 不依赖 NestJS、Prisma、HTTP、数据库、环境变量或支付网关。
 *
 * 退款申请不等于已实际退款：PENDING_CONFIRMATION 只表示财务已登记、等待门店提供并确认
 * 实际退款凭证，不得计入已退款、不得扣客户钱包、不得冲销统一总账。
 * 仅 SUCCEEDED 代表实际退款已经确认；REJECTED 与 CANCELLED 同为终态，均不产生任何资金变动。
 * 本模块只校验状态流转，不写资金账、钱包、支付单、退款单、审计或 API，也不含任何「自动成功」逻辑。
 *
 * 注意：字面量 `PENDING_CONFIRMATION` 同时是派单订单的「待核算」状态（order-state-machine.ts）。
 * 两者属于不同实体的独立状态机（订单表 vs payment_refunds），语义不可互换，也不得复用同一套中文标签。
 */
export type RefundStatus =
  "PENDING_CONFIRMATION" | "SUCCEEDED" | "REJECTED" | "CANCELLED";

/**
 * 允许的退款状态；顺序为状态机自然顺序（初始态在前，终态在后）。
 * 运行时冻结：状态机守卫以此数组为唯一运行时依据，不得被同进程代码改写。
 */
export const REFUND_STATUSES: readonly RefundStatus[] = Object.freeze([
  "PENDING_CONFIRMATION",
  "SUCCEEDED",
  "REJECTED",
  "CANCELLED",
]);

/**
 * 唯一的状态转移事实来源：终态的出边为空数组。
 * `Record<RefundStatus, ...>` 由类型系统保证四个状态全部列出，将来新增状态时漏写会直接编译报错。
 */
const ALLOWED_TRANSITIONS: Readonly<
  Record<RefundStatus, readonly RefundStatus[]>
> = {
  PENDING_CONFIRMATION: ["SUCCEEDED", "REJECTED", "CANCELLED"],
  SUCCEEDED: [],
  REJECTED: [],
  CANCELLED: [],
};

/**
 * 把任意输入渲染为安全的短标签供错误消息使用：状态名的合法字符集只有字母与下划线，其余一律替换为 `?`。
 * 目的有二：(1) 未知状态可能来自自由字符串列，绝不让控制字符或换行混进日志伪造审计行；
 * (2) 绝不调用调用方对象的 `toString`，避免二次异常掩盖真实的非法转移结论。
 */
function label(value: unknown): string {
  if (typeof value !== "string") return `<${typeof value}>`;
  return value.slice(0, 32).replace(/[^A-Za-z_]/g, "?");
}

/** 非法状态转移（含未知状态）。消息只含 from/to 两个状态名，不含客户、金额、银行卡或退款单号。 */
export class RefundStatusTransitionError extends Error {
  constructor(from: unknown, to: unknown) {
    super(`退款状态不允许从 ${label(from)} 变更为 ${label(to)}`);
    this.name = "RefundStatusTransitionError";
  }
}

/**
 * 判断状态是否已知。以导出的 REFUND_STATUSES 为唯一运行时依据（同 fund-account.ts 的 isFundAccountKind）；
 * 逐个严格相等比对，因此 "constructor"、"toString" 等原型链属性名不会被误判为合法状态。
 */
function isKnownStatus(value: unknown): value is RefundStatus {
  return (
    typeof value === "string" &&
    REFUND_STATUSES.some((status) => status === value)
  );
}

/**
 * 校验一次退款状态转移：合法则直接返回，不返回任何业务数据；非法一律抛 RefundStatusTransitionError。
 * 未知 from/to、从终态出发、以及任何自转移都被拒绝，不做静默纠正。
 */
export function assertRefundStatusTransition(
  from: RefundStatus,
  to: RefundStatus,
): void {
  if (!isKnownStatus(from) || !isKnownStatus(to)) {
    throw new RefundStatusTransitionError(from, to);
  }
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new RefundStatusTransitionError(from, to);
  }
}

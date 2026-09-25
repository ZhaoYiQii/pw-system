/**
 * 对账处理单状态机（DS-010）：纯领域规则，无 I/O、无副作用，
 * 不依赖 NestJS、Prisma、HTTP、数据库、环境变量或支付渠道。
 *
 * 对账差异本身仍是不可由 UI 改写的原始事实，处理单只是它的处理闭环记录：
 *   OPEN -> CLAIMED -> PROCESSING -> PENDING_REVIEW -> CLOSED
 *   OPEN / CLAIMED -> IGNORED（仅用于不需要继续处理的差异，后续接入时必须记录理由）
 * 不能跳过认领、实际处理或复核；PROCESSING 之后不能忽略；禁止回退、自迁移与从终态继续迁移；
 * 未知状态一律拒绝，不默认允许。
 *
 * 本模块只锁定状态拓扑：不校验处理说明、忽略理由、处理人/复核人、处理结果、幂等、权限、审计，
 * 也不同步 `ReconciliationDifference.resolvedAt`——这些由后续切片在事务内完成。本模块同样不含
 * 任何「自动认领 / 自动复核 / 自动关闭 / 按差异类型自动忽略」逻辑。
 */
export type ReconciliationCaseStatus =
  "OPEN" | "CLAIMED" | "PROCESSING" | "PENDING_REVIEW" | "CLOSED" | "IGNORED";

/**
 * 允许的对账处理单状态；顺序为状态机自然顺序（初始态在前，终态在后）。
 * 运行时冻结：已知状态判定以此为唯一运行时依据，不得被同进程代码改写。
 */
export const RECONCILIATION_CASE_STATUSES: readonly ReconciliationCaseStatus[] =
  Object.freeze([
    "OPEN",
    "CLAIMED",
    "PROCESSING",
    "PENDING_REVIEW",
    "CLOSED",
    "IGNORED",
  ]);

/**
 * 唯一的转移事实来源：终态的出边为空数组。
 * `Record<ReconciliationCaseStatus, ...>` 由类型系统保证六个状态全部列出，将来新增状态时
 * 漏写会直接编译报错；终态也由「出边为空」推导，不维护第二份终态清单。
 */
const ALLOWED_TRANSITIONS: Readonly<
  Record<ReconciliationCaseStatus, readonly ReconciliationCaseStatus[]>
> = {
  OPEN: ["CLAIMED", "IGNORED"],
  CLAIMED: ["PROCESSING", "IGNORED"],
  PROCESSING: ["PENDING_REVIEW"],
  PENDING_REVIEW: ["CLOSED"],
  CLOSED: [],
  IGNORED: [],
};

/**
 * 把任意输入渲染为安全的短标签供错误消息使用：状态名的合法字符集只有字母与下划线，
 * 其余一律替换为 `?`。目的有二：(1) 未知状态可能来自自由字符串，绝不让控制字符、换行、
 * 数字或方括号混进日志伪造审计行；(2) 绝不调用调用方对象的 `toString`，避免二次异常
 * 掩盖真实的非法转移结论。
 */
function label(value: unknown): string {
  if (typeof value !== "string") return `<${typeof value}>`;
  return value.slice(0, 32).replace(/[^A-Za-z_]/g, "?");
}

/** 非法状态转移（含未知状态）。消息只含 from/to 两个安全标签，不含备注、金额、客户或渠道明细。 */
export class ReconciliationCaseTransitionError extends Error {
  constructor(from: unknown, to: unknown) {
    super(`对账处理单状态不允许从 ${label(from)} 变更为 ${label(to)}`);
    this.name = "ReconciliationCaseTransitionError";
  }
}

/**
 * 判断状态是否已知。以导出的 RECONCILIATION_CASE_STATUSES 为唯一运行时依据，逐个严格相等
 * 比对，因此 "constructor"、"toString"、"__proto__" 等原型链属性名不会被误判为合法状态。
 */
function isKnownStatus(value: unknown): value is ReconciliationCaseStatus {
  return (
    typeof value === "string" &&
    RECONCILIATION_CASE_STATUSES.some((status) => status === value)
  );
}

/**
 * 判断一次状态转移是否允许：合法转移返回 true；未知状态与所有非法转移返回 false。
 * 任何输入都不抛错，调用方按布尔值决策即可。
 */
export function canTransitionReconciliationCase(
  from: ReconciliationCaseStatus,
  to: ReconciliationCaseStatus,
): boolean {
  if (!isKnownStatus(from) || !isKnownStatus(to)) return false;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** 校验一次状态转移：合法则直接返回，不返回业务数据；未知或非法一律抛专用错误，不做静默纠正。 */
export function assertReconciliationCaseTransition(
  from: ReconciliationCaseStatus,
  to: ReconciliationCaseStatus,
): void {
  if (!canTransitionReconciliationCase(from, to)) {
    throw new ReconciliationCaseTransitionError(from, to);
  }
}

/**
 * 终态判定：只有 CLOSED 与 IGNORED 是终态，由「转移表中出边为空」推导，不维护第二份清单。
 * 未知运行时输入不是终态（返回 false），避免把伪造状态当成不可再处理的事实。
 */
export function isReconciliationCaseTerminalStatus(
  status: ReconciliationCaseStatus,
): boolean {
  return isKnownStatus(status) && ALLOWED_TRANSITIONS[status].length === 0;
}

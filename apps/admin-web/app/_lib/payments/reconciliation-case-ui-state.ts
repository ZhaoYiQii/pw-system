/**
 * DS-014：对账处理单工作台的状态 → 动作映射、展示文案与命令请求体纯函数
 * （供页面组件与单测共用；无 JSX、无 React、无 fetch、无副作用）。
 *
 * 约定：
 * - 状态机拓扑只在后端 DS-010 定义，这里**不复制第二张转移表**：本文件只回答
 *   「以当前账号的身份，这张单此刻在我界面里该给出哪些按钮」，具体能否推进由服务端裁决。
 *   认不出的状态一律只读——失败关闭，绝不猜测出一个按钮。
 * - 只给「前提已被现有数据证明成立」的动作：`/api/v1/tenant/me` 还没回来时当前账号是 `null`，
 *   此时「是不是我的」与「是不是别人提交的」都无法证明，只保留与身份无关的 OPEN 动作
 *   （认领 / 忽略），其余一律只读。少给一个按钮只是不顺手，多给一个按钮就是让用户撞 409。
 * - `expectedVersion` **只**取列表行上的 `version`，绝不推导成 `version + 1`：
 *   那是服务端乐观锁的原值，猜一个数字换来的只可能是 409。
 * - 命令请求体里不出现 tenantId / ownerId / reviewerId / status / 时间戳：
 *   身份由登录态决定、状态由命令路径决定，客户端多写一个字段就是越权面。多写的键会被
 *   服务端 400 拒绝（与 `additionalProperties: false` 同义的运行期校验）。
 * - 展示层：状态/处理结果映射到中文，未知值**回退原始值**，空值显示 `—`，
 *   绝不伪装成某个已知状态。差异类型中文由服务端 `kindLabel` 提供，本文件不再映射。
 * - 三条命令的请求/响应类型尚未进入生成客户端 `@pw/api-client`（Codex 稍后重新生成）；
 *   在重新生成之前，本文件按已冻结的 OpenAPI 契约**本地**声明它们，只读列表行仍从生成类型派生。
 */
import type {
  TenantReconciliationCaseListData,
  TenantReconciliationCaseListResponse,
} from "@pw/api-client";

/** 列表 query（生成契约）。 */
export type ReconciliationCaseListQuery = NonNullable<
  TenantReconciliationCaseListData["query"]
>;
/** 列表响应中的单行处理单（含内嵌的不可变差异引用）。 */
export type ReconciliationCaseRow =
  TenantReconciliationCaseListResponse["data"]["rows"][number];

export type ReconciliationCaseStatus = NonNullable<
  ReconciliationCaseListQuery["status"]
>;

/** 契约枚举值列表（与生成类型同源，`satisfies` 保证不漂移）。 */
export const RECONCILIATION_CASE_STATUSES = [
  "OPEN",
  "CLAIMED",
  "PROCESSING",
  "PENDING_REVIEW",
  "CLOSED",
  "IGNORED",
] as const satisfies readonly ReconciliationCaseStatus[];

/** 空值展示文案：与 `fund-ledger-state` 同语义。 */
export const RECONCILIATION_CASE_EMPTY_TEXT = "—";

/** 列表页大小：与服务端默认值一致（服务端上限 100）。 */
export const RECONCILIATION_CASE_PAGE_SIZE = 20;

/** 处理说明 / 忽略理由的长度区间（Unicode 码位，与服务端 minLength/maxLength 对齐）。 */
export const RECONCILIATION_NOTE_MIN_CODE_POINTS = 1;
export const RECONCILIATION_NOTE_MAX_CODE_POINTS = 500;

/** 409 固定文案：并发冲突只提示刷新重取，**不自动重试**。 */
export const RECONCILIATION_CONFLICT_MESSAGE =
  "数据已被其他操作更新，请刷新后重试";

/**
 * 提交复核时**可请求**的处理结果类型：只有两个公开值。
 *
 * 落库后的内部字面量 `IGNORED`（忽略命令写进 `resolutionType`）不在这个列表里——
 * 它不是一种「处理结果」，只能由忽略命令产生，绝不作为表单选项出现。
 */
export const RECONCILIATION_SELECTABLE_RESOLUTION_TYPES = [
  "NO_LEDGER_CHANGE",
  "LEDGER_TRANSACTION",
] as const;

export type ReconciliationResolutionType =
  (typeof RECONCILIATION_SELECTABLE_RESOLUTION_TYPES)[number];

/**
 * 处理结果展示映射：含内部字面量 `IGNORED`（服务端会把它写进这一列，界面上必须看得懂）。
 * 映射只用于展示，不代表可请求。
 */
const RESOLUTION_TYPE_LABELS: Readonly<Record<string, string>> = {
  NO_LEDGER_CHANGE: "无需改账",
  LEDGER_TRANSACTION: "关联交易",
  IGNORED: "已忽略",
};

const STATUS_LABELS: Readonly<Record<ReconciliationCaseStatus, string>> = {
  OPEN: "待认领",
  CLAIMED: "已认领",
  PROCESSING: "处理中",
  PENDING_REVIEW: "待复核",
  CLOSED: "已关闭",
  IGNORED: "已忽略",
};

/** 只读原因文案：仅在没有可用动作时出现。 */
const READ_ONLY_REASON_OTHER_OWNER = "他人处理中";
const READ_ONLY_REASON_WAIT_REVIEWER = "等待其他财务复核";
const READ_ONLY_REASON_IDENTITY_UNKNOWN = "当前账号信息未就绪，暂不可操作";

/** 五个命令：路径段与按钮文案一一对应。 */
export type ReconciliationCaseAction =
  "claim" | "start-processing" | "submit-review" | "close" | "ignore";

const ACTION_LABELS: Readonly<Record<ReconciliationCaseAction, string>> = {
  claim: "认领",
  "start-processing": "开始处理",
  "submit-review": "提交复核",
  close: "复核关闭",
  ignore: "忽略",
};

/**
 * 动作可见性结论。判别联合：有动作时不带只读原因，只读时不带动作数组，
 * 「既有按钮又有只读说明」这种自相矛盾的状态在类型上就不存在。
 */
export type ReconciliationCaseActionPlan =
  | {
      readonly kind: "actions";
      readonly actions: readonly ReconciliationCaseAction[];
    }
  | { readonly kind: "read-only"; readonly reason: string };

/**
 * 判定动作只需要状态与处理人两个字段。
 * 用结构化类型而非完整行，供单测直接复用；完整 API 行天然满足该约束。
 */
export interface ReconciliationCaseActionRow {
  /**
   * 故意标成 `string` 而不是闭合联合：运行期拿到的是 JSON，类型标注在运行时不存在。
   * 认不出的状态必须走到失败关闭分支，而不是被类型断言假定成某个已知状态。
   */
  readonly status: string;
  readonly ownerId: string | null;
}

/** 请求体需要版本号的行：版本只从行上取，绝不与行分离传递（避免与展示的行错位）。 */
export interface ReconciliationCaseVersionedRow {
  readonly version: number;
}

/**
 * 三条命令的请求体。字段名与服务端契约一致
 * （`additionalProperties: false`：多一个键就是 400）。
 */
export interface ReconciliationCaseTransitionBody {
  readonly expectedVersion: number;
}

export interface ReconciliationCaseSubmitReviewBody {
  readonly expectedVersion: number;
  readonly resolutionType: ReconciliationResolutionType;
  readonly resolutionNote: string;
  /** 仅 `LEDGER_TRANSACTION` 出现；`NO_LEDGER_CHANGE` 时该键**缺席**（不是 `null`）。 */
  readonly linkedTransactionId?: string;
}

export interface ReconciliationCaseIgnoreBody {
  readonly expectedVersion: number;
  readonly reason: string;
}

/** 与服务端同一形状的规范 UUID 校验（客户端只是提交前的预检，服务端才是权威）。 */
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * 当前账号对这张单可执行的动作；没有可执行动作时给出只读原因。
 *
 * `currentAccountId` 为 `null`（`/me` 未返回）时，除 OPEN 那两个与身份无关的动作外，
 * 一切依赖「是不是我的」判断的动作都失败关闭：判定不出来就不给按钮。
 */
export function caseActionsFor(
  row: ReconciliationCaseActionRow,
  currentAccountId: string | null,
): ReconciliationCaseActionPlan {
  // 身份未知优先判：此时 ownerId 是不是我自己**无法判定**，不能退化成「反正不是我」。
  if (currentAccountId === null && row.status !== "OPEN") {
    return { kind: "read-only", reason: READ_ONLY_REASON_IDENTITY_UNKNOWN };
  }
  const ownedByCaller =
    currentAccountId !== null && row.ownerId === currentAccountId;

  switch (row.status) {
    case "OPEN":
      // 还没人认领，归属不适用：这两个动作与「我是谁」无关。
      return { kind: "actions", actions: ["claim", "ignore"] };
    case "CLAIMED":
      return ownedByCaller
        ? { kind: "actions", actions: ["start-processing", "ignore"] }
        : { kind: "read-only", reason: READ_ONLY_REASON_OTHER_OWNER };
    case "PROCESSING":
      return ownedByCaller
        ? { kind: "actions", actions: ["submit-review"] }
        : { kind: "read-only", reason: READ_ONLY_REASON_OTHER_OWNER };
    case "PENDING_REVIEW":
      // 复核人必须不是处理人：自己提交的单，本人这里只读。
      return ownedByCaller
        ? { kind: "read-only", reason: READ_ONLY_REASON_WAIT_REVIEWER }
        : { kind: "actions", actions: ["close"] };
    case "CLOSED":
      return { kind: "read-only", reason: "已关闭，无可用操作" };
    case "IGNORED":
      return { kind: "read-only", reason: "已忽略，无可用操作" };
    default:
      // 服务端新增了本页不认识的状态：只读并点名原值，绝不猜测出一个按钮。
      return {
        kind: "read-only",
        reason: `状态「${row.status}」暂不支持操作，请刷新页面`,
      };
  }
}

export function actionLabel(action: ReconciliationCaseAction): string {
  return ACTION_LABELS[action];
}

/** 命令路径：与任务包契约逐字一致（动作名即路径段）。 */
export function caseCommandPath(
  caseId: string,
  action: ReconciliationCaseAction,
): string {
  return `/api/v1/tenant/reconciliation/cases/${caseId}/${action}`;
}

/** 展示映射：空值 `—`；未知值原样点名（不伪装成已知状态）。 */
export function caseStatusLabel(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return RECONCILIATION_CASE_EMPTY_TEXT;
  }
  return STATUS_LABELS[value as ReconciliationCaseStatus] ?? value;
}

export function resolutionTypeLabel(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return RECONCILIATION_CASE_EMPTY_TEXT;
  }
  return RESOLUTION_TYPE_LABELS[value] ?? value;
}

export function accountLabel(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return RECONCILIATION_CASE_EMPTY_TEXT;
  }
  return value;
}

/** 处理说明 / 理由：原文展示（服务端已保证无控制字符、长度受控），空值 `—`。 */
export function noteLabel(value: string | null | undefined): string {
  if (value === null || value === undefined || value.trim() === "") {
    return RECONCILIATION_CASE_EMPTY_TEXT;
  }
  return value;
}

/** 表单原始值：全是字符串，校验与裁剪都在 `commit*` 里做。 */
export interface SubmitReviewFormValues {
  readonly resolutionType: string;
  readonly resolutionNote: string;
  readonly linkedTransactionId: string;
}

export type SubmitReviewFormErrors = Partial<
  Record<keyof SubmitReviewFormValues, string>
>;
export type IgnoreFormErrors = Partial<Record<"reason", string>>;

export type CommitSubmitReviewResult =
  | { readonly ok: true; readonly body: ReconciliationCaseSubmitReviewBody }
  | { readonly ok: false; readonly errors: SubmitReviewFormErrors };

export type CommitIgnoreResult =
  | { readonly ok: true; readonly body: ReconciliationCaseIgnoreBody }
  | { readonly ok: false; readonly errors: IgnoreFormErrors };

/** 说明/理由的公共校验：trim → 非空 → 码位计长 → 无控制字符或换行。 */
function validateNote(
  field: "resolutionNote" | "reason",
  raw: string,
): { ok: true; value: string } | { ok: false; message: string } {
  const value = raw.trim();
  const codePoints = [...value];
  if (codePoints.length < RECONCILIATION_NOTE_MIN_CODE_POINTS) {
    return { ok: false, message: "请填写说明" };
  }
  if (codePoints.length > RECONCILIATION_NOTE_MAX_CODE_POINTS) {
    return {
      ok: false,
      message: `最多 ${RECONCILIATION_NOTE_MAX_CODE_POINTS} 个字符`,
    };
  }
  const hasControlCharacter = codePoints.some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
  if (hasControlCharacter) {
    return { ok: false, message: "不能包含控制字符或换行" };
  }
  return { ok: true, value };
}

function isSelectableResolutionType(
  value: string,
): value is ReconciliationResolutionType {
  return RECONCILIATION_SELECTABLE_RESOLUTION_TYPES.some(
    (candidate) => candidate === value,
  );
}

/**
 * 提交复核表单 → 请求体。校验不通过返回字段错误，**不**发出请求。
 *
 * `expectedVersion` 取行上的 `version` 原值；`NO_LEDGER_CHANGE` 时 `linkedTransactionId`
 * 整个键缺席（服务端拒绝显式 `null`，也拒绝空白串）。
 */
export function commitSubmitReviewForm(
  row: ReconciliationCaseVersionedRow,
  values: SubmitReviewFormValues,
): CommitSubmitReviewResult {
  const errors: SubmitReviewFormErrors = {};

  // 一次收齐所有字段错误（不是碰到第一个就返回），所以这里先把合法值收窄成局部变量：
  // 类型守卫放在非终结分支里，属性本身的收窄会失效。
  const resolutionType = isSelectableResolutionType(values.resolutionType)
    ? values.resolutionType
    : null;
  if (resolutionType === null) {
    errors.resolutionType = "请选择处理结果";
  }

  const note = validateNote("resolutionNote", values.resolutionNote);
  if (!note.ok) {
    errors.resolutionNote = note.message;
  }

  // 交易 id **不做 trim**：服务端按原样字符串校验 UUID，trim 会把服务端会拒绝的输入
  // 悄悄修好、再送出一个与用户输入不一致的值。别替调用方纠错，让它带着错去撞 400。
  const linkedTransactionId = values.linkedTransactionId;
  if (resolutionType === "LEDGER_TRANSACTION") {
    if (!UUID_PATTERN.test(linkedTransactionId)) {
      errors.linkedTransactionId = "请填写有效的交易 id（规范 UUID）";
    }
  }
  // `NO_LEDGER_CHANGE` 下即使表单里残留了 id 也不校验、更不带上：
  // 该键必须缺席，服务端不接受任何形式的关联交易字段。

  if (!note.ok || resolutionType === null || Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  if (resolutionType === "LEDGER_TRANSACTION") {
    return {
      ok: true,
      body: {
        expectedVersion: row.version,
        resolutionType,
        resolutionNote: note.value,
        linkedTransactionId,
      },
    };
  }
  return {
    ok: true,
    body: {
      expectedVersion: row.version,
      resolutionType,
      resolutionNote: note.value,
    },
  };
}

/** 忽略理由表单 → 请求体。落库字段名（`resolutionNote` / `IGNORED`）由服务端决定，这里不写。 */
export function commitIgnoreForm(
  row: ReconciliationCaseVersionedRow,
  reason: string,
): CommitIgnoreResult {
  const note = validateNote("reason", reason);
  if (!note.ok) {
    return { ok: false, errors: { reason: note.message } };
  }
  return {
    ok: true,
    body: { expectedVersion: row.version, reason: note.value },
  };
}

/** 只有 409 是并发冲突：提示刷新重取，不自动重试。 */
export function isConflictStatus(status: number): boolean {
  return status === 409;
}

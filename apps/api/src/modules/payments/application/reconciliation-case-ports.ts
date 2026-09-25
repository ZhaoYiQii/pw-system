/**
 * DS-012/DS-013：对账处理单的仓储端口与视图契约（接口隔离，便于单测注入假实现）。
 *
 * 口径：
 * 1. 列表这一片**只读**——列表既不创建也不补齐处理单；DS-013 另加两个**显式命令**
 *    （认领 `OPEN -> CLAIMED`、开始处理 `CLAIMED -> PROCESSING`），仓储不为它们提供通用的
 *    「任意改状态」入口：命令名即允许的转移，拓扑仍只由 DS-010 领域状态机裁决；
 * 2. 查询值在应用层规范化成强类型 `ReconciliationCaseQuery`（只有四个字段），
 *    命令值同样规范化成 `ReconciliationCaseTransitionCommand`；仓储不二次解释客户端输入；
 * 3. 金额以 `bigint` 在层间传递、以十进制字符串出网；时间以 `Date` 传递、ISO 字符串出网，可空即显式 `null`。
 */

import type { ReconciliationCaseStatus } from "../domain/reconciliation-case-state.js";

/** 每页条数默认值（与任务包契约一致；上限见 `RECONCILIATION_CASE_MAX_PAGE_SIZE`）。 */
export const RECONCILIATION_CASE_DEFAULT_PAGE_SIZE = 20;

/** 每页条数上限：超过即 400，不静默夹取（静默夹取会让调用方以为拿到的是全部）。 */
export const RECONCILIATION_CASE_MAX_PAGE_SIZE = 100;

/** 对账处理单入参问题（状态认不出 / 页码非规范正整数 / 命令字段畸形 / 缺租户上下文）→ 控制器映射 400。 */
export class ReconciliationCaseInputError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "ReconciliationCaseInputError";
  }
}

/**
 * DS-013：处理单在**本租户内**不可见——不存在，或属于别的租户（两者对外不可区分）→ 控制器映射 404。
 * 单独成型（而不是复用输入错误）：这是「查无此单」的资源语义，不是客户端参数写错。
 */
export class ReconciliationCaseNotFoundError extends Error {
  constructor() {
    super("对账处理单不存在");
    this.name = "ReconciliationCaseNotFoundError";
  }
}

/**
 * DS-013：命令因**冲突**被拒 → 控制器映射 409：版本过期、来源状态不允许、归属不符、
 * 或条件更新竞争失败（另一个请求先改了这一行）。消息是固定安全文案，不回显请求内容。
 */
export class ReconciliationCaseConflictError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "ReconciliationCaseConflictError";
  }
}

/**
 * 控制器传入的原始查询值：三个可选参数故意用 `unknown`，
 * 让「重复参数变成数组」「数字字面量」这类畸形输入也能在运行期被拒绝，而不是被类型系统挡在门外。
 */
export interface ReconciliationCaseQueryInput {
  tenantId: string;
  status?: unknown;
  page?: unknown;
  pageSize?: unknown;
}

/** 规范化后的仓储查询：**只有**这四个字段；`status: null` 表示不过滤。 */
export interface ReconciliationCaseQuery {
  tenantId: string;
  status: ReconciliationCaseStatus | null;
  page: number;
  pageSize: number;
}

/**
 * DS-013：控制器传入的原始命令值。`caseId` 与 `body` 故意用 `unknown`：
 * 「数组 UUID」「带换行的伪 UUID」「字符串 expectedVersion」这类畸形输入必须在**运行期**被拒绝，
 * 而不是被类型断言挡在门外——断言在运行时不存在，等于没校验。
 */
export interface ReconciliationCaseCommandInput {
  tenantId: string;
  operatorAccountId: string;
  caseId: unknown;
  body: unknown;
}

/**
 * 规范化后的命令：仓储只认这四个字段。
 * `caseId` 已校验为单个规范 UUID；`expectedVersion` 已校验为 ≥1 的安全整数；
 * 目标状态、处理人、租户都不在命令里——前者由命令名决定，后两者只来自登录态。
 */
export interface ReconciliationCaseTransitionCommand {
  tenantId: string;
  operatorAccountId: string;
  caseId: string;
  expectedVersion: number;
}

/**
 * DS-014：提交复核时客户端可选的**处理结果类型**——只有两个取值。
 *
 * 这是**请求**词表，不等于落库词表：`resolution_type` 列在库层是自由 `TEXT`（DS-011 明确不预设枚举），
 * 忽略命令往同一列写的是内部字面量（见 `RECONCILIATION_CASE_IGNORED_RESOLUTION_TYPE`），
 * 它**不在**这里——想忽略只能走 `ignore` 命令，不能从 submit-review 绕进去。
 */
export const RECONCILIATION_RESOLUTION_TYPES = [
  "NO_LEDGER_CHANGE",
  "LEDGER_TRANSACTION",
] as const;

export type ReconciliationResolutionType =
  (typeof RECONCILIATION_RESOLUTION_TYPES)[number];

/**
 * DS-014：忽略命令落库用的**内部**字面量，刻意独立于上面的公开词表。
 *
 * 单独成型而不是塞进 `RECONCILIATION_RESOLUTION_TYPES`：后者是「客户端能请求什么」的白名单，
 * 一旦把 `IGNORED` 并进去，`submit-review` 就会接受一个它不该接受的值，
 * 而目标状态由命令名决定的边界也就破了。
 */
export const RECONCILIATION_CASE_IGNORED_RESOLUTION_TYPE = "IGNORED";

/**
 * 处理说明 / 忽略理由的长度上下界，按 **Unicode 码位**计（不是 UTF-16 码元）：
 * 一个 emoji 算一个字符。用 `.length` 实现会按码元计，把 500 个 emoji 误判成 1000 而拒绝。
 */
export const RECONCILIATION_NOTE_MIN_CODE_POINTS = 1;
export const RECONCILIATION_NOTE_MAX_CODE_POINTS = 500;

/**
 * DS-014 提交复核命令（`PROCESSING -> PENDING_REVIEW`）：在 DS-013 的转移命令之上追加处理结果。
 *
 * `linkedTransactionId` 是**必填的可空**字段（不是可选字段）：可选字段在
 * `exactOptionalPropertyTypes` 下读取时仍是 `T | undefined`，会把 `undefined` 漏进仓储；
 * 必填可空则强迫服务层显式给出「没有关联交易」这个决定。
 * 该字段由 `resolutionType` **唯一决定**：`LEDGER_TRANSACTION` 必须给出关联交易，
 * `NO_LEDGER_CHANGE` 必须没有（规范化后即 `null`）。
 */
export interface ReconciliationCaseSubmitReviewCommand extends ReconciliationCaseTransitionCommand {
  resolutionType: ReconciliationResolutionType;
  resolutionNote: string;
  linkedTransactionId: string | null;
}

/**
 * DS-014 忽略命令（`OPEN -> IGNORED`，或 `CLAIMED -> IGNORED` 且调用者就是处理人）。
 * 字段名与请求体一致（`reason`），落库时才映射到 `resolutionNote`——映射点保持可见。
 */
export interface ReconciliationCaseIgnoreCommand extends ReconciliationCaseTransitionCommand {
  reason: string;
}

/** 处理单内嵌的对账差异行（不可由 UI 改写的原始事实，本切片只读它）。 */
export interface ReconciliationCaseDifferenceRow {
  /** `MISSING_LOCAL` / `MISSING_WECHAT` / `AMOUNT_MISMATCH` / `STATUS_MISMATCH` 等。 */
  kind: string;
  amountFen: bigint | null;
  detail: string | null;
  paymentOrderId: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

/** 仓储返回的处理单行：字段与 API 行一一对应，映射只做序列化，不再做业务判断。 */
export interface ReconciliationCaseRow {
  id: string;
  differenceId: string;
  status: ReconciliationCaseStatus;
  ownerId: string | null;
  resolutionType: string | null;
  resolutionNote: string | null;
  linkedTransactionId: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  difference: ReconciliationCaseDifferenceRow;
}

/** 处理单内嵌差异的 API 视图：金额十进制字符串、时间 ISO 字符串。 */
export interface ReconciliationCaseDifferenceView {
  kind: string;
  /** 中文说明由既有 `differenceKindLabel()` 提供，认不出时原样点名。 */
  kindLabel: string;
  amountFen: string | null;
  detail: string | null;
  paymentOrderId: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

/**
 * 处理单 API 行：**不含** `tenantId`（租户来自登录态，不回显）；
 * 也不推断处理人显示名、可执行动作、处理状态或关联交易详情——那些不属于本切片。
 */
export interface ReconciliationCaseView {
  id: string;
  differenceId: string;
  status: ReconciliationCaseStatus;
  ownerId: string | null;
  resolutionType: string | null;
  resolutionNote: string | null;
  linkedTransactionId: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  difference: ReconciliationCaseDifferenceView;
}

/** 分页视图：`total` 是同一筛选条件下的总数，不受 `pageSize` 影响。 */
export interface ReconciliationCasePageView {
  rows: ReconciliationCaseView[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ReconciliationCaseRepository {
  /** 一次调用返回当页行与总数（两个查询同一筛选条件、同一租户上下文）。 */
  list(input: ReconciliationCaseQuery): Promise<{
    rows: ReconciliationCaseRow[];
    total: number;
  }>;
  /**
   * DS-013 认领：只实现 `OPEN -> CLAIMED`；成功即把处理人写成 `operatorAccountId`——
   * 调用方**无法**指定别人当处理人（命令里根本没有 owner 字段），切片内也没有改派/抢占。
   */
  claim(
    input: ReconciliationCaseTransitionCommand,
  ): Promise<ReconciliationCaseRow>;
  /**
   * DS-013 开始处理：只实现 `CLAIMED -> PROCESSING`；处理人必须已是该命令的操作人，
   * 别人的单推不动（越权与版本过期同样以冲突上报，不静默放行）。
   */
  startProcessing(
    input: ReconciliationCaseTransitionCommand,
  ): Promise<ReconciliationCaseRow>;
  /**
   * DS-014 提交复核：只实现 `PROCESSING -> PENDING_REVIEW`；只有该单**当前**处理人能提交。
   *
   * 只写处理结果三件套（类型 / 说明 / 关联交易），**不**写复核人、复核时间或关闭时间，
   * 也**不**解析差异——差异要等复核关闭那一刻才落 `resolvedAt`，中途落就等于自审自批。
   */
  submitReview(
    input: ReconciliationCaseSubmitReviewCommand,
  ): Promise<ReconciliationCaseRow>;
  /**
   * DS-014 复核关闭：只实现 `PENDING_REVIEW -> CLOSED`；复核人**必须不是**处理人——
   * 本切片没有 owner/admin 覆盖口子，自己提交的单自己关不了。
   *
   * 与状态一起落复核人、复核时间与关闭时间，并在**同一事务**内解析该单的差异。
   */
  close(
    input: ReconciliationCaseTransitionCommand,
  ): Promise<ReconciliationCaseRow>;
  /**
   * DS-014 忽略：`OPEN -> IGNORED`（任意有权限的调用者）或 `CLAIMED -> IGNORED`（仅处理人）。
   * `PROCESSING` / `PENDING_REVIEW` / 终态都进不来——拓扑由 DS-010 裁决。
   *
   * 理由是唯一的说明来源；`reviewedBy` / `reviewedAt` 保持为空：忽略没有复核这一步，
   * 拿它们记「是谁忽略的」会污染复核字段的语义。
   */
  ignore(
    input: ReconciliationCaseIgnoreCommand,
  ): Promise<ReconciliationCaseRow>;
}

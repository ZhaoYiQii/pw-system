import { assertBalancedFundEntries } from "./funds.js";
import type { FundEntryDirection } from "./funds.js";
import { buildLedgerTransactionNo } from "./ledger-transaction-no.js";
import type { SettlementBatchStatus } from "./settlement-batch-state.js";

/**
 * DS-006：陪玩**实际付款确认**（`PLAYER_PAYOUT_CONFIRMED`）的固定口径。
 *
 * 门店在自己的渠道（银行/现金/线下）把钱付给陪玩，平台**不是**代付方：
 * 本模块只把「财务已取得凭证的实际付款事实」翻译成统一总账草稿，不调用任何真实
 * 支付、退款、银行或微信接口。
 *
 * 科目、来源、事件、状态与辅助核算类型的唯一定义点；仓储只引用这里的常量，不得自行硬编码。
 * 纯模块：无 NestJS / Prisma / HTTP / 数据库 / 环境变量依赖，只负责口径，不负责取数与落库。
 */

/** 统一总账来源：结算批次。 */
export const PLAYER_PAYOUT_CONFIRMED_SOURCE_TYPE = "settlement_batch";
/** 实际付款已确认事件。 */
export const PLAYER_PAYOUT_CONFIRMED_EVENT_TYPE = "PLAYER_PAYOUT_CONFIRMED";
/** 付款事实一旦登记即确认；本任务不写草稿态交易。 */
export const PLAYER_PAYOUT_CONFIRMED_STATUS = "CONFIRMED";
/** 两条分录共用的批次辅助核算类型。 */
export const SETTLEMENT_BATCH_AUXILIARY_TYPE = "settlement_batch";

/**
 * 借方（减负债）科目：门店欠陪玩的已结算款。
 * 名称与订单核算里的 `ensureAccount("PLAYER_PAYABLE", "应付陪玩款")` 保持一致，
 * 否则同一科目会以两个名字出现在账上。
 */
export const PLAYER_PAYABLE_ACCOUNT = {
  code: "PLAYER_PAYABLE",
  name: "应付陪玩款",
} as const;

/** 贷方（减资产）科目：结算付款所动用的资金池。 */
export const SETTLEMENT_FUND_ASSET_ACCOUNT = {
  code: "SETTLEMENT_FUND_ASSET",
  name: "结算付款资金资产",
} as const;

/** 本任务涉及的两个科目码。 */
export type PlayerPayoutAccountCode =
  | typeof PLAYER_PAYABLE_ACCOUNT.code
  | typeof SETTLEMENT_FUND_ASSET_ACCOUNT.code;

/** 入参非法（请求体形状、凭证号、幂等键、时间、金额）：明确拒绝，不做静默纠正 → HTTP 400。 */
export class PlayerPayoutConfirmedInputError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "PlayerPayoutConfirmedInputError";
  }
}

/** 业务冲突（批次不存在或状态不符、重复付款、资金账户不可用）→ HTTP 409。 */
export class PlayerPayoutConfirmedConflictError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "PlayerPayoutConfirmedConflictError";
  }
}

/**
 * DB 里的 `settlement_batches.status` 是自由字符串，付款入口必须把它收窄成状态机认识的状态。
 *
 * 列表用 `satisfies` 钉在 `SettlementBatchStatus` 上：状态机新增状态时这里编译报错提醒，
 * 而未知状态一律**拒绝付款**（fail-closed），绝不会被当成可付款状态。允许流转表仍然只有
 * `settlement-batch-state.ts` 一份，本函数只做收窄，不复制规则。
 */
const KNOWN_SETTLEMENT_BATCH_STATUSES = [
  "DRAFT",
  "REVIEWED",
  "APPROVED",
  "PAID",
  "VOID",
] as const satisfies readonly SettlementBatchStatus[];

export function toSettlementBatchStatus(value: string): SettlementBatchStatus {
  const found = KNOWN_SETTLEMENT_BATCH_STATUSES.find(
    (status) => status === value,
  );
  if (!found) {
    throw new PlayerPayoutConfirmedConflictError(
      `结算批次状态无法识别（${value}），拒绝付款`,
    );
  }
  return found;
}

/**
 * 付款凭证号的安全字符集：与 DS-005 退款凭据同口径。只允许字母、数字、下划线与连字符，
 * 长度 1–64，**不接受**自由文本；空格、斜杠、点号、中文与控制字符一律拒绝，避免把银行卡号、
 * 客户隐私或完整渠道报文塞进付款记录与日志。
 */
const EVIDENCE_REF_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** 幂等键：由客户端生成，只用于提交关联；持久化去重靠批次来源唯一交易键。 */
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * 数据库 uuid 主键的形状（批次 id、资金账户 id）。格式不对必须在控制器层拦成 400：
 * 放行到 Prisma 会抛 uuid 解析错误，把客户端输入错误伪装成服务端 500，
 * 同时让客户端原始字符串落进服务端错误日志。
 */
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * ISO 8601 带时区的时间串：`occurredAt` 只接受这一种形状，不接受模糊日期串。
 *
 * 小时限定 00–23、分秒限定 00–59：`2026-09-24T24:00:00Z` 会被 `new Date()` 接受并
 * **静默滚到次日**，记账时间被悄悄改动比直接报错更糟。时区偏移同时接受 `+08:00` 与 `+0800`
 * （两种都是 ISO 8601，客户端库生成哪一种由其决定）；小数秒 1–9 位，超出毫秒的部分由
 * `Date` 截断——截断发生在毫秒以下，不改变日期，且我们随后使用的就是这个同一个值。
 */
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * Unicode `Cc`（控制字符，含 NUL、换行、DEL）：用属性转义写，源码里不留不可见字节
 * （字面量控制字符会把源文件变成二进制文件，diff、grep 与工具链都会失灵）。
 */
const CONTROL_CHARACTERS = /\p{Cc}+/gu;

/** 备注长度上限（`trim()` 之后）。 */
export const PLAYER_PAYOUT_NOTE_MAX_LENGTH = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 字符串字段：必须是字符串，裁剪后不得为空。 */
function requireNonEmptyText(value: unknown, message: string): string {
  if (typeof value !== "string") {
    throw new PlayerPayoutConfirmedInputError(message);
  }
  const text = value.trim();
  if (!text) throw new PlayerPayoutConfirmedInputError(message);
  return text;
}

function requireUuid(value: unknown, message: string): string {
  if (typeof value !== "string") {
    throw new PlayerPayoutConfirmedInputError(message);
  }
  const text = value.trim();
  if (!UUID_PATTERN.test(text)) {
    throw new PlayerPayoutConfirmedInputError(message);
  }
  return text;
}

function requirePattern(
  value: unknown,
  pattern: RegExp,
  message: string,
): string {
  if (typeof value !== "string") {
    throw new PlayerPayoutConfirmedInputError(message);
  }
  const text = value.trim();
  if (!pattern.test(text)) {
    throw new PlayerPayoutConfirmedInputError(message);
  }
  return text;
}

/**
 * 实际付款时间：只接受 ISO 8601 带时区字符串或 `Date`。
 *
 * - `Date` 实例**原样返回同一个引用**：调用方给的时间必须原封不动地成为记账时间；
 * - 字符串必须匹配 ISO 8601 带时区形状，并复核日历日——`2026-02-31T00:00:00.000Z`
 *   会被 JS 悄悄滚到 3 月 3 日，记账时间被静默改动比直接报错更糟。
 */
function requireOccurredAt(value: unknown): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new PlayerPayoutConfirmedInputError("实际付款时间不是有效时间");
    }
    return value;
  }
  if (typeof value !== "string") {
    throw new PlayerPayoutConfirmedInputError(
      "必须提供实际付款时间（ISO 8601 字符串）",
    );
  }
  const text = value.trim();
  if (!ISO_TIMESTAMP_PATTERN.test(text)) {
    throw new PlayerPayoutConfirmedInputError(
      "实际付款时间必须是 ISO 8601 时间（如 2026-09-24T12:00:00.000Z）",
    );
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    throw new PlayerPayoutConfirmedInputError("实际付款时间不是有效时间");
  }
  assertRealCalendarDate(text, parsed);
  return parsed;
}

function assertRealCalendarDate(text: string, parsed: Date): void {
  const [yearText, monthText, dayText] = text.slice(0, 10).split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const utc = new Date(Date.UTC(year, month - 1, day));
  const rollsOver =
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day;
  if (rollsOver) {
    throw new PlayerPayoutConfirmedInputError(
      `实际付款时间不是有效日期（${text.slice(0, 10)}）`,
    );
  }
  if (Number.isNaN(parsed.getTime())) {
    throw new PlayerPayoutConfirmedInputError("实际付款时间不是有效时间");
  }
}

/** 备注：可选；空白按 `null` 存；超长拒绝。 */
function normalizeNote(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new PlayerPayoutConfirmedInputError("备注必须是字符串");
  }
  const text = value.trim();
  if (!text) return null;
  if (text.length > PLAYER_PAYOUT_NOTE_MAX_LENGTH) {
    throw new PlayerPayoutConfirmedInputError(
      `备注不能超过 ${PLAYER_PAYOUT_NOTE_MAX_LENGTH} 个字符`,
    );
  }
  return text;
}

/**
 * `ManualPaymentRecord.note` 的安全组合：只放已校验的凭证号与可选备注。
 * 控制字符与换行一律压成空格（避免多行内容伪造日志或导出），不写银行卡号、客户隐私
 * 或完整渠道报文。凭证号在这里**再校验一次**：仓储不得假设调用方已经校验过。
 */
export function buildManualPaymentNote(
  evidenceRef: string,
  note: string | null,
): string {
  // 先查类型再查形状：`RegExp.test` 会把入参强制转成字符串，`test(undefined)` 恰好通过
  // 正则，会把「凭证 undefined」写进付款记录——凭证号缺失时必须拒绝，不得凭空生成一个。
  if (
    typeof evidenceRef !== "string" ||
    !EVIDENCE_REF_PATTERN.test(evidenceRef)
  ) {
    throw new PlayerPayoutConfirmedInputError(
      "付款凭证号非法，拒绝写入付款记录",
    );
  }
  const head = `凭证 ${evidenceRef}`;
  if (note === null) return head;
  const cleaned = note
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? `${head}；备注 ${cleaned}` : head;
}

export interface NormalizedPlayerPayoutRequest {
  batchId: string;
  fundAccountId: string;
  evidenceRef: string;
  occurredAt: Date;
  idempotencyKey: string;
  note: string | null;
}

/**
 * 规范化并校验付款请求：控制器**必须**先过这一关，不得把未经校验的内容传给仓储。
 *
 * `raw` 取 `unknown` 而不是结构化类型：HTTP 请求体是外部输入，TypeScript 标注不构成校验。
 * `batchIdFromPath` 取路径参数而非请求体字段——批次 id 以 URL 为唯一权威，请求体里的同名字段
 * 被忽略，避免「路径指向一个批次、请求体指向另一个批次」。任何一项不合法直接抛
 * `PlayerPayoutConfirmedInputError`（HTTP 400），不做任何宽松兜底。
 */
export function normalizePlayerPayoutRequest(
  raw: unknown,
  batchIdFromPath: string,
): NormalizedPlayerPayoutRequest {
  if (!isRecord(raw)) {
    throw new PlayerPayoutConfirmedInputError("请求体必须是 JSON 对象");
  }

  const batchId = requireUuid(batchIdFromPath, "批次 id 格式不正确");
  const fundAccountId = requireUuid(
    raw["fundAccountId"],
    "必须指定付款资金账户（uuid）",
  );
  const evidenceRef = requirePattern(
    raw["evidenceRef"],
    EVIDENCE_REF_PATTERN,
    "付款凭证号必填，且只能是 1–64 位字母、数字、下划线或连字符",
  );
  const idempotencyKey = requirePattern(
    raw["idempotencyKey"],
    IDEMPOTENCY_KEY_PATTERN,
    "幂等键必填，且只能是 1–64 位字母、数字、下划线或连字符",
  );
  const occurredAt = requireOccurredAt(raw["occurredAt"]);
  const note = normalizeNote(raw["note"]);

  return {
    batchId,
    fundAccountId,
    evidenceRef,
    occurredAt,
    idempotencyKey,
    note,
  };
}

export interface PlayerPayoutConfirmedPostingInput {
  /** 结算批次 id，作为总账来源 id 与两条分录的辅助核算 id。 */
  batchId: string;
  /** 批次号，写入描述供人工追溯；缺失时描述退回批次 id。 */
  batchNo?: string;
  /** 实际付款动用的、同租户 `ACTIVE` 资金账户 id。 */
  fundAccountId: string;
  /** 批次项目合计（分），必须为正整数。 */
  amountFen: bigint;
  /** 实际付款时间，同时作为发生时间与确认时间。 */
  occurredAt: Date;
  /** 服务端登录态里的操作者 id。 */
  actorId: string;
  /** 客户端本次提交的幂等键：只进交易描述，持久化去重靠批次来源唯一交易键。 */
  idempotencyKey?: string;
}

export interface PlayerPayoutConfirmedLedgerTransactionDraft {
  /** 交易号在领域层生成，仓储只能原样写入，避免另生成一套口径或绕过唯一性。 */
  txNo: string;
  sourceType: typeof PLAYER_PAYOUT_CONFIRMED_SOURCE_TYPE;
  sourceId: string;
  eventType: typeof PLAYER_PAYOUT_CONFIRMED_EVENT_TYPE;
  status: typeof PLAYER_PAYOUT_CONFIRMED_STATUS;
  /** 交易锚定的资金账户，用于按资金账户查询总账交易。 */
  fundAccountId: string;
  createdBy: string;
  confirmedBy: string;
  description: string;
  occurredAt: Date;
  confirmedAt: Date;
}

export interface PlayerPayoutConfirmedLedgerEntryDraft {
  accountCode: PlayerPayoutAccountCode;
  direction: FundEntryDirection;
  amountFen: bigint;
  /** 只有贷方（资产）落在资金账户上；借方是应付陪玩款，不挂资金账户。 */
  fundAccountId: string | null;
  auxiliaryType: typeof SETTLEMENT_BATCH_AUXILIARY_TYPE;
  auxiliaryId: string;
}

export interface PlayerPayoutConfirmedLedgerPosting {
  transaction: PlayerPayoutConfirmedLedgerTransactionDraft;
  /** 恰好一借一贷，金额同为批次合计。 */
  entries: readonly [
    PlayerPayoutConfirmedLedgerEntryDraft,
    PlayerPayoutConfirmedLedgerEntryDraft,
  ];
}

/**
 * 由「实际付款事实」推导统一总账草稿：借 `PLAYER_PAYABLE`（减应付陪玩款）、
 * 贷 `SETTLEMENT_FUND_ASSET`（减结算资金资产）。
 *
 * 纯函数；正金额、借贷平衡与全部固定字段都在这里检查，仓储不得自行拼装交易或分录。
 * `batchNo` / `idempotencyKey` 只影响描述文案（缺失时退回批次 id），不影响任何资金口径。
 */
export function buildPlayerPayoutConfirmedLedgerPosting(
  input: PlayerPayoutConfirmedPostingInput,
): PlayerPayoutConfirmedLedgerPosting {
  if (typeof input.amountFen !== "bigint" || input.amountFen <= 0n) {
    throw new PlayerPayoutConfirmedInputError(
      `付款金额必须为大于 0 的整数分，实际收到 ${String(input.amountFen)}`,
    );
  }
  const batchId = requireNonEmptyText(input.batchId, "缺少批次 id");
  const fundAccountId = requireNonEmptyText(
    input.fundAccountId,
    "缺少付款资金账户",
  );
  const actorId = requireNonEmptyText(input.actorId, "缺少操作者");
  const occurredAt = requireOccurredAt(input.occurredAt);
  const batchLabel =
    input.batchNo === undefined
      ? batchId
      : requireNonEmptyText(input.batchNo, "批次号不能为空白");
  const keyLabel =
    input.idempotencyKey === undefined
      ? null
      : requirePattern(
          input.idempotencyKey,
          IDEMPOTENCY_KEY_PATTERN,
          "幂等键必填，且只能是 1–64 位字母、数字、下划线或连字符",
        );

  const entries: readonly [
    PlayerPayoutConfirmedLedgerEntryDraft,
    PlayerPayoutConfirmedLedgerEntryDraft,
  ] = [
    {
      accountCode: PLAYER_PAYABLE_ACCOUNT.code,
      direction: "DEBIT",
      amountFen: input.amountFen,
      fundAccountId: null,
      auxiliaryType: SETTLEMENT_BATCH_AUXILIARY_TYPE,
      auxiliaryId: batchId,
    },
    {
      accountCode: SETTLEMENT_FUND_ASSET_ACCOUNT.code,
      direction: "CREDIT",
      amountFen: input.amountFen,
      fundAccountId,
      auxiliaryType: SETTLEMENT_BATCH_AUXILIARY_TYPE,
      auxiliaryId: batchId,
    },
  ];

  // 复用既有守卫：非正金额与借贷不平衡都在这里兜底，避免绕过领域规则直接落库。
  assertBalancedFundEntries(entries);

  const descriptionParts = [`批次 ${batchLabel}`];
  if (keyLabel !== null) descriptionParts.push(`幂等键 ${keyLabel}`);

  return {
    transaction: {
      txNo: buildLedgerTransactionNo(),
      sourceType: PLAYER_PAYOUT_CONFIRMED_SOURCE_TYPE,
      sourceId: batchId,
      eventType: PLAYER_PAYOUT_CONFIRMED_EVENT_TYPE,
      status: PLAYER_PAYOUT_CONFIRMED_STATUS,
      fundAccountId,
      createdBy: actorId,
      confirmedBy: actorId,
      description: `陪玩付款已确认（${descriptionParts.join("，")}）`,
      occurredAt,
      confirmedAt: occurredAt,
    },
    entries,
  };
}

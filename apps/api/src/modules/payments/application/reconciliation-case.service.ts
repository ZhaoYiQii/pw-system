/**
 * DS-012/DS-013：对账处理单的应用服务。
 *
 * 职责边界：把控制器传入的原始值逐字段校验、规范化为强类型查询/命令；
 * 再把仓储返回的行映射成固定 API 视图（金额十进制字符串、时间 ISO 字符串、可空显式 `null`）。
 *
 * - DS-012 列表：只读，不创建、不补齐、不推进任何处理单；
 * - DS-013 命令：`claim()`（`OPEN -> CLAIMED`）与 `startProcessing()`（`CLAIMED -> PROCESSING`），
 *   各调用**一个**仓储方法一次。目标状态由方法名决定，**不接受**客户端指定；处理人只取登录态。
 *   状态拓扑、归属与并发都由领域状态机 + 仓储条件更新裁决，服务层不复制第二份转移表。
 *
 * 纯应用层：不依赖 NestJS、HTTP、环境变量、Prisma client 或数据库。
 */

import {
  RECONCILIATION_CASE_STATUSES,
  type ReconciliationCaseStatus,
} from "../domain/reconciliation-case-state.js";
import { differenceKindLabel } from "./tenant-reconciliation.service.js";
import {
  RECONCILIATION_CASE_DEFAULT_PAGE_SIZE,
  RECONCILIATION_CASE_MAX_PAGE_SIZE,
  RECONCILIATION_NOTE_MAX_CODE_POINTS,
  RECONCILIATION_NOTE_MIN_CODE_POINTS,
  RECONCILIATION_RESOLUTION_TYPES,
  ReconciliationCaseInputError,
} from "./reconciliation-case-ports.js";
import type {
  ReconciliationCaseCommandInput,
  ReconciliationCaseIgnoreCommand,
  ReconciliationCasePageView,
  ReconciliationCaseQuery,
  ReconciliationCaseQueryInput,
  ReconciliationCaseRepository,
  ReconciliationCaseRow,
  ReconciliationCaseSubmitReviewCommand,
  ReconciliationCaseTransitionCommand,
  ReconciliationCaseView,
  ReconciliationResolutionType,
} from "./reconciliation-case-ports.js";

/** 规范正整数（页码、页大小）：不接受 `0`、前导零、正负号、小数或空白。 */
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;

/**
 * 数据库 uuid 主键的形状（处理单号 `reconciliation_cases.id`）。与既有退款命令同一口径：
 * 格式不对必须在服务层拦成 400，放行到 Prisma 会抛 uuid 解析错误
 * （「Inconsistent column data」），把客户端的输入错误伪装成服务端 500，
 * 同时让客户端原始字符串落进服务端错误日志（多行内容可伪造日志行）。
 */
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** 命令请求体只允许这一个字段：多一个、少一个都不认，也不替客户端补默认值。 */
const EXPECTED_VERSION_FIELD = "expectedVersion";

/**
 * 状态过滤：只接受六个 DS-010 状态之一的**单个**字符串；`undefined`/`null` 表示不过滤。
 * 空白串、数组、认不出的值与大小写别名一律 400——静默当成「全部」会让分页数字对不上。
 */
function parseStatus(value: unknown): ReconciliationCaseStatus | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ReconciliationCaseInputError("status 必须是单个状态字符串");
  }
  const text = value.trim();
  const found = RECONCILIATION_CASE_STATUSES.find(
    (candidate) => candidate === text,
  );
  if (!found) {
    // 不回显原始输入：状态合法取值是封闭集合，点名允许值即可，避免把任意输入写进日志。
    throw new ReconciliationCaseInputError(
      `status 只能是 ${RECONCILIATION_CASE_STATUSES.join(" / ")}（大小写敏感）`,
    );
  }
  return found;
}

/** 页码 / 页大小：缺席取默认值，提供了就必须是规范十进制正整数字符串。 */
function parsePositiveInteger(
  value: unknown,
  field: "page" | "pageSize",
  fallback: number,
): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") {
    throw new ReconciliationCaseInputError(`${field} 必须是十进制正整数字符串`);
  }
  const text = value.trim();
  if (!POSITIVE_INTEGER_PATTERN.test(text)) {
    throw new ReconciliationCaseInputError(
      `${field} 必须是规范十进制正整数（不接受 0、前导零、正负号、小数或空白）`,
    );
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) {
    throw new ReconciliationCaseInputError(`${field} 超出可处理范围`);
  }
  return parsed;
}

/**
 * 解析并校验原始查询值。
 *
 * 任何一项非法都抛 `ReconciliationCaseInputError`（HTTP 400），**不做静默回退**：
 * 认不出的状态不会被当成「全部」，非法页码不会被当成第 1 页，空白参数也不会被当成「未提供」。
 */
export function parseReconciliationCaseQuery(
  input: ReconciliationCaseQueryInput,
): ReconciliationCaseQuery {
  if (typeof input.tenantId !== "string" || !input.tenantId.trim()) {
    // 正常情况下控制器已从登录态取到租户并在此之前以 401 拦下，这里是纵深防御。
    throw new ReconciliationCaseInputError("缺少租户上下文，拒绝查询");
  }
  const status = parseStatus(input.status);
  const page = parsePositiveInteger(input.page, "page", 1);
  const pageSize = parsePositiveInteger(
    input.pageSize,
    "pageSize",
    RECONCILIATION_CASE_DEFAULT_PAGE_SIZE,
  );
  if (pageSize > RECONCILIATION_CASE_MAX_PAGE_SIZE) {
    throw new ReconciliationCaseInputError(
      `pageSize 最大为 ${RECONCILIATION_CASE_MAX_PAGE_SIZE}`,
    );
  }
  // 两个值各自安全不代表偏移量安全：`page=90071992547411` 与 `pageSize=100` 单看都合法，
  // 相乘后却越过 MAX_SAFE_INTEGER，`skip` 会带着失真的数字进查询。算不出安全偏移就必须 400，
  // 绝不能把溢出的页码当成合法分页交给仓储。
  // （两个解析器已保证入参 ≥ 1，非负判断是纵深防御。）
  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new ReconciliationCaseInputError(
      "page 与 pageSize 组合超出可处理范围，无法计算分页偏移量",
    );
  }
  return { tenantId: input.tenantId.trim(), status, page, pageSize };
}

/** 租户 / 操作人标识：来自登录态，缺失或空白即拒（控制器已在更外层把缺登录态拦成 401，这里是纵深防御）。 */
function requireIdentity(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ReconciliationCaseInputError(message);
  }
  // 原样返回、不 trim：审计里的 tenantId / actorId 必须与认证主体逐字一致，不静默改写身份。
  return value;
}

/**
 * `expectedVersion` 的**取值**校验：一个判断覆盖全部畸形值——
 * 字符串、0、负数、小数、NaN、±Infinity、非安全整数。
 *
 * 从请求体校验里单独拆出来，是因为 DS-014 的请求体不止一个字段；
 * 但版本号本身的口径必须与 DS-013 逐字一致，所以文案留在下面那个包装函数里没有动。
 */
function parseExpectedVersionValue(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new ReconciliationCaseInputError(
      `${EXPECTED_VERSION_FIELD} 必须是 1 起的安全整数`,
    );
  }
  return value;
}

/** 请求体：只接受「恰好一个 expectedVersion 字段、值为正安全整数」的普通对象；多余字段不忽略而是拒绝。 */
function parseExpectedVersion(body: unknown): number {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ReconciliationCaseInputError(
      "请求体必须是只含 expectedVersion 的 JSON 对象",
    );
  }
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== EXPECTED_VERSION_FIELD) {
    // 不回显键名或值：客户端原文不进错误消息，也就进不了日志。
    throw new ReconciliationCaseInputError(
      `请求体只允许 ${EXPECTED_VERSION_FIELD} 一个字段`,
    );
  }
  return parseExpectedVersionValue(
    (body as Record<string, unknown>)[EXPECTED_VERSION_FIELD],
  );
}

/**
 * 拒绝**任何**白名单之外的键，返回普通对象视图。
 *
 * 与 `parseExpectedVersion` 的「恰好 N 个键」不同，这里只判「有没有多余的」：
 * DS-014 的 `submit-review` 请求体是 3 个键还是 4 个键由 `resolutionType` 决定，
 * 必填字段的缺失交给各自的取值解析器报错，不在这里靠数键来推断。
 *
 * 用 `Object.keys` 而不是 `in` 或取值访问：JSON 里自带一个 own `__proto__` 键是真实可达的载荷形状，
 * 它会被 `Object.keys` 枚举出来从而撞上白名单；而原型链访问会把它当成原型而不是请求体字段。
 */
function rejectUnknownKeys(
  body: unknown,
  allowed: readonly string[],
): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ReconciliationCaseInputError("请求体必须是 JSON 对象");
  }
  const record = body as Record<string, unknown>;
  // 只判断「有没有」，不回显是哪一个键：客户端原文不进错误消息。
  const hasUnknownKey = Object.keys(record).some(
    (key) => !allowed.includes(key),
  );
  if (hasUnknownKey) {
    throw new ReconciliationCaseInputError(
      `请求体只允许 ${allowed.join(" / ")} 这些字段`,
    );
  }
  return record;
}

/**
 * 处理说明 / 忽略理由：先 `trim()`，再按 **Unicode 码位**计长，并拒绝控制字符。
 *
 * 先 trim 再计长是有意的：全是空白的输入应当报「不能为空」，而不是报「超长」或「含控制字符」。
 * 错误消息固定安全文案，不回显客户端原文。
 */
function parseBoundedText(
  value: unknown,
  field: "resolutionNote" | "reason",
): string {
  if (typeof value !== "string") {
    throw new ReconciliationCaseInputError(`${field} 必须是字符串`);
  }
  const text = value.trim();
  // 按码位切分（不是 `.length` 的 UTF-16 码元）：一个 emoji 算一个字符。
  const codePoints = [...text];
  if (codePoints.length < RECONCILIATION_NOTE_MIN_CODE_POINTS) {
    throw new ReconciliationCaseInputError(`${field} 不能为空`);
  }
  if (codePoints.length > RECONCILIATION_NOTE_MAX_CODE_POINTS) {
    throw new ReconciliationCaseInputError(
      `${field} 最多 ${RECONCILIATION_NOTE_MAX_CODE_POINTS} 个字符`,
    );
  }
  // 控制字符（Unicode Cc：U+0000–U+001F 与 U+007F–U+009F）一律拒绝：
  // 说明要进审计摘要与页面展示，换行能伪造日志行，其它控制字符能把界面撑坏。
  const hasControlCharacter = codePoints.some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
  if (hasControlCharacter) {
    throw new ReconciliationCaseInputError(`${field} 不能包含控制字符或换行`);
  }
  return text;
}

/**
 * 处理结果类型：只认两个公开取值的**逐字符精确**匹配。
 *
 * 这里刻意**不** `trim()`、不折叠大小写——与上面 `parseStatus` 对查询参数的宽松口径相反：
 * 查询串来自 URL，命令体是 JSON。允许「修一下就能用」的宽松化，等于承认客户端能靠空白改名，
 * 而处理结果类型是要落库的业务事实。
 */
function parseResolutionType(value: unknown): ReconciliationResolutionType {
  const found = RECONCILIATION_RESOLUTION_TYPES.find(
    (candidate) => candidate === value,
  );
  if (!found) {
    throw new ReconciliationCaseInputError(
      `resolutionType 只能是 ${RECONCILIATION_RESOLUTION_TYPES.join(" / ")}（逐字符精确匹配）`,
    );
  }
  return found;
}

/**
 * DS-013：解析并校验原始命令。
 *
 * 三条口径：
 * 1. `caseId` 必须是**单个**规范 UUID 字符串——不 trim、不做「修一下就能用」的宽松化，
 *    带空白/换行的伪 UUID 与数组一律 400；
 * 2. `body` 必须是只含 `expectedVersion` 的普通对象，值为 ≥1 的安全整数；
 * 3. 目标状态、处理人、租户**都不从命令里取**：目标状态由命令方法名决定，
 *    处理人与租户只来自登录态（服务端绑定，永不信任客户端提交）。
 */
/** 身份与单号：DS-013/DS-014 五条命令共用同一套校验与同一份文案，抽出来只为不产生第二套口径。 */
function parseCommandIdentity(input: ReconciliationCaseCommandInput): {
  tenantId: string;
  operatorAccountId: string;
  caseId: string;
} {
  const tenantId = requireIdentity(
    input.tenantId,
    "缺少租户上下文，拒绝执行命令",
  );
  const operatorAccountId = requireIdentity(
    input.operatorAccountId,
    "缺少操作人上下文，拒绝执行命令",
  );
  if (typeof input.caseId !== "string" || !UUID_PATTERN.test(input.caseId)) {
    throw new ReconciliationCaseInputError("caseId 必须是单个规范 UUID 字符串");
  }
  return { tenantId, operatorAccountId, caseId: input.caseId };
}

export function parseReconciliationCaseTransitionCommand(
  input: ReconciliationCaseCommandInput,
): ReconciliationCaseTransitionCommand {
  return {
    ...parseCommandIdentity(input),
    expectedVersion: parseExpectedVersion(input.body),
  };
}

/** submit-review 请求体允许的键；多一个即 400，少一个交给该字段自己的解析器报错。 */
const SUBMIT_REVIEW_FIELDS = [
  EXPECTED_VERSION_FIELD,
  "resolutionType",
  "resolutionNote",
  "linkedTransactionId",
] as const;

/** ignore 请求体允许的键。 */
const IGNORE_FIELDS = [EXPECTED_VERSION_FIELD, "reason"] as const;

/**
 * DS-014：解析提交复核命令（`PROCESSING -> PENDING_REVIEW`）。
 *
 * `resolutionType` 与 `linkedTransactionId` 是**一个决定的两个面**，必须同时成立：
 * - `LEDGER_TRANSACTION` → 关联交易必填，且必须是规范 UUID（形状先在这里拦，
 *   至于它是否存在、是否本租户、是否 `CONFIRMED`，由仓储在事务内裁决）；
 * - `NO_LEDGER_CHANGE` → 关联交易**必须缺席**，连显式 `null` 也不接受。
 *
 * 第二条刻意严格：`null` 与「没这个字段」在 JSON 里是两种写法、同一个意思，
 * 但只接受一种能让「客户端到底想说什么」保持唯一解释；宽进只会让日志里出现两种历史。
 */
export function parseReconciliationCaseSubmitReviewCommand(
  input: ReconciliationCaseCommandInput,
): ReconciliationCaseSubmitReviewCommand {
  const identity = parseCommandIdentity(input);
  const body = rejectUnknownKeys(input.body, SUBMIT_REVIEW_FIELDS);
  const expectedVersion = parseExpectedVersionValue(
    body[EXPECTED_VERSION_FIELD],
  );
  const resolutionType = parseResolutionType(body.resolutionType);
  const resolutionNote = parseBoundedText(
    body.resolutionNote,
    "resolutionNote",
  );
  if (resolutionType === "LEDGER_TRANSACTION") {
    const linkedTransactionId = body.linkedTransactionId;
    if (
      typeof linkedTransactionId !== "string" ||
      !UUID_PATTERN.test(linkedTransactionId)
    ) {
      throw new ReconciliationCaseInputError(
        "linkedTransactionId 必须是单个规范 UUID 字符串（resolutionType 为 LEDGER_TRANSACTION 时必填）",
      );
    }
    return {
      ...identity,
      expectedVersion,
      resolutionType,
      resolutionNote,
      linkedTransactionId,
    };
  }
  if (Object.hasOwn(body, "linkedTransactionId")) {
    throw new ReconciliationCaseInputError(
      "linkedTransactionId 必须缺席（resolutionType 为 NO_LEDGER_CHANGE 时不允许关联交易）",
    );
  }
  return {
    ...identity,
    expectedVersion,
    resolutionType,
    resolutionNote,
    linkedTransactionId: null,
  };
}

/**
 * DS-014：解析忽略命令（`OPEN -> IGNORED`，或 `CLAIMED -> IGNORED` 且调用者就是处理人）。
 *
 * 字段名保持 `reason`：请求体的词表与落库列名（`resolutionNote`）不强行统一——
 * 映射点留在仓储那一处，比让两套命名在服务层咬合成一个更难看懂。
 */
export function parseReconciliationCaseIgnoreCommand(
  input: ReconciliationCaseCommandInput,
): ReconciliationCaseIgnoreCommand {
  const identity = parseCommandIdentity(input);
  const body = rejectUnknownKeys(input.body, IGNORE_FIELDS);
  return {
    ...identity,
    expectedVersion: parseExpectedVersionValue(body[EXPECTED_VERSION_FIELD]),
    reason: parseBoundedText(body.reason, "reason"),
  };
}

/** 可空时间 → ISO 字符串或显式 `null`（不用 `?.`：字段缺席必须暴露成错误，而不是悄悄变 `null`）。 */
function toIsoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/** 可空金额 → 十进制字符串或显式 `null`；`BigInt` 绝不经过 `number`。 */
function toFenTextOrNull(value: bigint | null): string | null {
  return value === null ? null : value.toString();
}

/** 处理单行 → API 视图：逐字段显式映射，可空字段显式 `null`，不做任何派生或重算。 */
export function toReconciliationCaseView(
  row: ReconciliationCaseRow,
): ReconciliationCaseView {
  return {
    id: row.id,
    differenceId: row.differenceId,
    status: row.status,
    ownerId: row.ownerId,
    resolutionType: row.resolutionType,
    resolutionNote: row.resolutionNote,
    linkedTransactionId: row.linkedTransactionId,
    reviewedBy: row.reviewedBy,
    reviewedAt: toIsoOrNull(row.reviewedAt),
    closedAt: toIsoOrNull(row.closedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
    difference: {
      kind: row.difference.kind,
      // 中文说明复用门店可见对账那一个标签表，避免第二份文案漂移。
      kindLabel: differenceKindLabel(row.difference.kind),
      amountFen: toFenTextOrNull(row.difference.amountFen),
      detail: row.difference.detail,
      paymentOrderId: row.difference.paymentOrderId,
      resolvedAt: toIsoOrNull(row.difference.resolvedAt),
      createdAt: row.difference.createdAt.toISOString(),
    },
  };
}

export class ReconciliationCaseService {
  constructor(private readonly repository: ReconciliationCaseRepository) {}

  /** 一次查询：校验 → 单次仓储调用（列表与总数同一口径）→ 固定映射。 */
  async list(
    input: ReconciliationCaseQueryInput,
  ): Promise<ReconciliationCasePageView> {
    const query = parseReconciliationCaseQuery(input);
    const page = await this.repository.list(query);
    return {
      rows: page.rows.map(toReconciliationCaseView),
      total: page.total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * DS-013 认领：`OPEN -> CLAIMED`，处理人即调用者。
   * 解析一次、只调一个仓储方法一次；找不到/冲突/状态不允许由仓储抛专用错误上抛，
   * 由控制器映射 HTTP——服务层不把领域错误翻译成别的错误，也不重试。
   */
  async claim(
    input: ReconciliationCaseCommandInput,
  ): Promise<ReconciliationCaseView> {
    const command = parseReconciliationCaseTransitionCommand(input);
    return toReconciliationCaseView(await this.repository.claim(command));
  }

  /** DS-013 开始处理：`CLAIMED -> PROCESSING`；归属校验在仓储事务内（只有该单当前处理人能推进）。 */
  async startProcessing(
    input: ReconciliationCaseCommandInput,
  ): Promise<ReconciliationCaseView> {
    const command = parseReconciliationCaseTransitionCommand(input);
    return toReconciliationCaseView(
      await this.repository.startProcessing(command),
    );
  }

  /**
   * DS-014 提交复核：`PROCESSING -> PENDING_REVIEW`，只有该单当前处理人能提交。
   * 有处理结果，但**没有**终态：复核人与关闭时间不在这里写，差异也不在这里解析。
   */
  async submitReview(
    input: ReconciliationCaseCommandInput,
  ): Promise<ReconciliationCaseView> {
    const command = parseReconciliationCaseSubmitReviewCommand(input);
    return toReconciliationCaseView(
      await this.repository.submitReview(command),
    );
  }

  /**
   * DS-014 复核关闭：`PENDING_REVIEW -> CLOSED`，复核人必须不是处理人。
   * 请求体与 DS-013 两条命令同形（只有 `expectedVersion`），所以复用同一个转移命令解析。
   */
  async close(
    input: ReconciliationCaseCommandInput,
  ): Promise<ReconciliationCaseView> {
    const command = parseReconciliationCaseTransitionCommand(input);
    return toReconciliationCaseView(await this.repository.close(command));
  }

  /**
   * DS-014 忽略：带理由终止，`OPEN` 或 `CLAIMED`（仅处理人）可达。
   * 写的是内部字面量 `IGNORED`——它不在客户端可请求的词表里，只能由这条命令产生。
   */
  async ignore(
    input: ReconciliationCaseCommandInput,
  ): Promise<ReconciliationCaseView> {
    const command = parseReconciliationCaseIgnoreCommand(input);
    return toReconciliationCaseView(await this.repository.ignore(command));
  }
}

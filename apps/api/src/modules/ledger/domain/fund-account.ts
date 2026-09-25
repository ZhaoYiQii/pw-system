/**
 * 资金账户领域规则（DS-002）：纯规则，无 I/O、无副作用，不依赖 NestJS、Prisma 或 HTTP。
 *
 * 只负责输入规范化与校验、视图转换、领域错误与仓储 port；
 * 不写资金流水、不计算余额、不做归档，也不接受客户端传入的 tenantId。
 */
export type FundAccountKind = "WECHAT_SETTLEMENT" | "BANK" | "CASH" | "OFFLINE";

export type FundAccountStatus = "ACTIVE" | "ARCHIVED";

/** 允许的账户类型，顺序与 API 契约一致。 */
export const FUND_ACCOUNT_KINDS: readonly FundAccountKind[] = [
  "WECHAT_SETTLEMENT",
  "BANK",
  "CASH",
  "OFFLINE",
];

/** 对外响应视图：只含契约字段，createdAt 为 ISO 字符串，不含 tenantId、余额或流水。 */
export interface FundAccountView {
  id: string;
  code: string;
  name: string;
  kind: FundAccountKind;
  status: FundAccountStatus;
  externalRef: string | null;
  createdAt: string;
}

/** 创建入参（未校验）：调用方传入的原始请求体。 */
export interface CreateFundAccountInput {
  code: string;
  name: string;
  kind: FundAccountKind;
  externalRef?: string;
}

/** 校验通过、可直接落库的创建入参。 */
export interface NormalizedFundAccountInput {
  code: string;
  name: string;
  kind: FundAccountKind;
  externalRef: string | null;
}

/** 仓储返回的账户行；tenantId 只在服务端与持久化之间流转，不进入视图。 */
export interface FundAccountRecord {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  kind: FundAccountKind;
  status: FundAccountStatus;
  externalRef: string | null;
  createdAt: Date;
}

/** 仓储 port：tenantId 必须由应用层从服务端上下文传入。 */
export interface FundAccountRepositoryPort {
  list(tenantId: string): Promise<FundAccountRecord[]>;
  create(
    tenantId: string,
    input: NormalizedFundAccountInput,
  ): Promise<FundAccountRecord>;
}

/** 输入不合法（控制器映射 HTTP 400）。 */
export class FundAccountInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FundAccountInputError";
  }
}

/** 同租户 code 重复（控制器映射 HTTP 409）。 */
export class FundAccountDuplicateCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FundAccountDuplicateCodeError";
  }
}

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,31}$/;
const NAME_MAX_LENGTH = 64;
const EXTERNAL_REF_MAX_LENGTH = 64;

function isFundAccountKind(value: string): value is FundAccountKind {
  return FUND_ACCOUNT_KINDS.some((kind) => kind === value);
}

/** 边界解析：把 unknown 请求体收窄为可逐字段校验的对象，缺字段由各字段校验负责报错。 */
function asRequestBody(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null) {
    throw new FundAccountInputError("创建资金账户的请求体必须是对象");
  }
  return input as Record<string, unknown>;
}

function normalizeCode(value: unknown): string {
  if (typeof value !== "string") {
    throw new FundAccountInputError("code 必须是字符串");
  }
  const code = value.trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) {
    throw new FundAccountInputError(
      `code 需匹配 ^[A-Z][A-Z0-9_]{1,31}$（trim 并转大写后），实际为 ${JSON.stringify(code)}`,
    );
  }
  return code;
}

function normalizeName(value: unknown): string {
  if (typeof value !== "string") {
    throw new FundAccountInputError("name 必须是字符串");
  }
  const name = value.trim();
  if (name.length < 1 || name.length > NAME_MAX_LENGTH) {
    throw new FundAccountInputError(
      `name 去空白后长度需为 1-${NAME_MAX_LENGTH}，实际为 ${name.length}`,
    );
  }
  return name;
}

function normalizeKind(value: unknown): FundAccountKind {
  if (typeof value === "string" && isFundAccountKind(value)) return value;
  throw new FundAccountInputError(`kind 仅接受 ${FUND_ACCOUNT_KINDS.join(" / ")}`);
}

function normalizeExternalRef(
  value: unknown,
  kind: FundAccountKind,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new FundAccountInputError("externalRef 必须是字符串");
  }
  const ref = value.trim();
  if (ref.length === 0) return null;
  if (ref.length > EXTERNAL_REF_MAX_LENGTH) {
    throw new FundAccountInputError(
      `externalRef 去空白后长度需为 1-${EXTERNAL_REF_MAX_LENGTH}，实际为 ${ref.length}`,
    );
  }
  if (kind === "BANK" && !ref.includes("*")) {
    throw new FundAccountInputError(
      "BANK 账户的 externalRef 必须包含 *（不得存放完整卡号）",
    );
  }
  return ref;
}

/** 规范化并校验创建入参；任一项不合格即抛 FundAccountInputError，不静默截断。 */
export function normalizeCreateFundAccountInput(
  input: unknown,
): NormalizedFundAccountInput {
  const raw = asRequestBody(input);
  const code = normalizeCode(raw.code);
  const name = normalizeName(raw.name);
  const kind = normalizeKind(raw.kind);
  const externalRef = normalizeExternalRef(raw.externalRef, kind);
  return { code, name, kind, externalRef };
}

/** 转为对外视图：只暴露契约字段，createdAt 统一为 ISO 字符串。 */
export function toFundAccountView(record: FundAccountRecord): FundAccountView {
  return {
    id: record.id,
    code: record.code,
    name: record.name,
    kind: record.kind,
    status: record.status,
    externalRef: record.externalRef,
    createdAt: record.createdAt.toISOString(),
  };
}

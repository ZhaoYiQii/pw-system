export class GameTemplateNotFoundError extends Error {
  constructor(id: string) {
    super(`game template not found: ${id}`);
    this.name = "GameTemplateNotFoundError";
  }
}

export class DuplicateGameTemplateError extends Error {
  constructor(name: string) {
    super(`游戏模板已存在：${name}`);
    this.name = "DuplicateGameTemplateError";
  }
}

export class InvalidGameTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidGameTemplateError";
  }
}

export const GENERIC_TEMPLATE_ERROR_STATUSES = {
  TEMPLATE_CURSOR_INVALID: 400,
  TEMPLATE_NOT_FOUND: 404,
  TEMPLATE_REVISION_CONFLICT: 409,
  TEMPLATE_ARCHIVED: 409,
  TEMPLATE_NAME_CONFLICT: 409,
  TEMPLATE_DELETE_RESTRICTED: 409,
  TEMPLATE_VERSION_UNAVAILABLE: 422,
  TEMPLATE_COMPONENT_INVALID: 422,
  TEMPLATE_BINDING_INVALID: 422,
  TEMPLATE_PRICE_RULE_INVALID: 422,
  TEMPLATE_LEGACY_REVIEW_REQUIRED: 422,
  TEMPLATE_IDEMPOTENCY_REQUIRED: 400,
  TEMPLATE_IDEMPOTENCY_MISMATCH: 422,
  TEMPLATE_IDEMPOTENCY_IN_FLIGHT: 409,
} as const;

export type GenericTemplateErrorCode =
  keyof typeof GENERIC_TEMPLATE_ERROR_STATUSES;

export interface GenericTemplateValidationIssueDetail {
  code:
    | "TEMPLATE_COMPONENT_INVALID"
    | "TEMPLATE_BINDING_INVALID"
    | "TEMPLATE_PRICE_RULE_INVALID"
    | "TEMPLATE_LEGACY_REVIEW_REQUIRED";
  path: string;
  componentKey?: string;
  message: string;
}

export type GenericTemplateErrorDetails = Readonly<Record<string, unknown>>;

export interface GenericTemplateErrorResponse {
  code: GenericTemplateErrorCode;
  message: string;
  details?: GenericTemplateErrorDetails;
}

/**
 * S2 的受控业务错误。只序列化 code/message/details，不暴露 cause、堆栈、
 * 数据库错误或完整模板配置。
 */
export class GenericTemplateError extends Error {
  public readonly status: (typeof GENERIC_TEMPLATE_ERROR_STATUSES)[GenericTemplateErrorCode];
  public readonly details: GenericTemplateErrorDetails | undefined;

  constructor(
    public readonly code: GenericTemplateErrorCode,
    message: string,
    details?: GenericTemplateErrorDetails,
  ) {
    super(message);
    this.name = "GenericTemplateError";
    this.status = GENERIC_TEMPLATE_ERROR_STATUSES[code];
    this.details =
      details === undefined ? undefined : Object.freeze({ ...details });
  }

  toResponse(): GenericTemplateErrorResponse {
    return {
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

export class GameTemplateRevisionConflictError extends GenericTemplateError {
  constructor(
    public readonly expectedRevision: number,
    public readonly currentRevision: number,
    public readonly currentEditor: string | null = null,
    public readonly currentUpdatedAt: string | null = null,
  ) {
    super(
      "TEMPLATE_REVISION_CONFLICT",
      "模板修订冲突：提交版本 " +
        expectedRevision +
        "，当前版本 " +
        currentRevision,
      {
        expectedRevision,
        currentRevision,
        currentEditor,
        currentUpdatedAt,
      },
    );
    this.name = "GameTemplateRevisionConflictError";
  }
}

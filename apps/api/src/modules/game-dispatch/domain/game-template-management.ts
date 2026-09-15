import type {
  DraftConfigV2,
  TemplateConfigIssue,
} from "./game-template-config-v2.js";
import { GenericTemplateError } from "./errors.js";

export const GENERIC_TEMPLATE_SORTS = [
  "UPDATED_DESC",
  "UPDATED_ASC",
  "NAME_ASC",
  "LAST_USED_DESC",
] as const;

export type GenericTemplateSort = (typeof GENERIC_TEMPLATE_SORTS)[number];

export const GENERIC_TEMPLATE_STATUSES = [
  "DRAFT",
  "PUBLISHED",
  "UNPUBLISHED_CHANGES",
  "ARCHIVED",
] as const;

export type GenericTemplateStatus = (typeof GENERIC_TEMPLATE_STATUSES)[number];

export interface GenericTemplateListQuery {
  gameId?: string;
  status?: GenericTemplateStatus;
  q?: string;
  sort: GenericTemplateSort;
  cursor?: string;
  limit: number;
}

export interface GenericTemplateSummary {
  id: string;
  game: { id: string; name: string };
  name: string;
  description: string | null;
  status: GenericTemplateStatus;
  activeVersionNo: number | null;
  revision: number;
  isDefault: boolean;
  lastUsedAt: Date | null;
  updatedAt: Date;
  updatedBy: string | null;
  hasUnpublishedChanges: boolean;
}

export interface CursorPage {
  nextCursor: string | null;
}

export interface GenericTemplateListPage {
  data: GenericTemplateSummary[];
  page: CursorPage;
}

export interface GenericTemplateVersionSummary {
  id: string;
  versionNo: number;
  schemaVersion: number;
  sourceVersionId: string | null;
  changeNote: string | null;
  publishedAt: Date;
  publishedBy: string;
}

export interface GenericTemplateDraftView extends GenericTemplateSummary {
  config: DraftConfigV2;
  activeVersion: GenericTemplateVersionSummary | null;
}

export interface CreateGenericTemplateInput {
  gameId: string;
  name: string;
  description?: string | null;
}

export interface ExpectedRevisionInput {
  expectedRevision: number;
}

export interface SaveGenericTemplateDraftInput extends ExpectedRevisionInput {
  config: DraftConfigV2;
}

export interface PublishGenericTemplateInput extends ExpectedRevisionInput {
  changeNote?: string | null;
  sourceVersionId?: string | null;
}

export interface RestoreGenericTemplateInput extends ExpectedRevisionInput {
  versionId: string;
}

export interface CopyGenericTemplateInput {
  targetGameId: string;
  newName: string;
}

export interface SaveGenericTemplateDraftResult {
  revision: number;
  updatedAt: Date;
  updatedBy: string;
  validationWarnings: TemplateConfigIssue[];
}

export interface TemplateCursorValue {
  sort: GenericTemplateSort;
  value: string | null;
  id: string;
}

export interface DecodedTemplateCursor extends TemplateCursorValue {
  v: 1;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function invalidCursor(): GenericTemplateError {
  return new GenericTemplateError(
    "TEMPLATE_CURSOR_INVALID",
    "模板列表游标无效或与排序不匹配",
  );
}

export function encodeTemplateCursor(value: TemplateCursorValue): string {
  if (
    !GENERIC_TEMPLATE_SORTS.includes(value.sort) ||
    (value.value !== null && typeof value.value !== "string") ||
    !UUID_PATTERN.test(value.id)
  ) {
    throw invalidCursor();
  }
  return Buffer.from(JSON.stringify({ v: 1, ...value }), "utf8").toString(
    "base64url",
  );
}

export function decodeTemplateCursor(
  cursor: string,
  expectedSort: GenericTemplateSort,
): DecodedTemplateCursor {
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      Array.isArray(decoded)
    ) {
      throw invalidCursor();
    }
    const record = decoded as Record<string, unknown>;
    if (
      Object.keys(record).length !== 4 ||
      record.v !== 1 ||
      record.sort !== expectedSort ||
      !GENERIC_TEMPLATE_SORTS.includes(record.sort as GenericTemplateSort) ||
      (record.value !== null && typeof record.value !== "string") ||
      typeof record.id !== "string" ||
      !UUID_PATTERN.test(record.id)
    ) {
      throw invalidCursor();
    }
    return {
      v: 1,
      sort: record.sort as GenericTemplateSort,
      value: record.value as string | null,
      id: record.id,
    };
  } catch (error) {
    if (error instanceof GenericTemplateError) throw error;
    throw invalidCursor();
  }
}

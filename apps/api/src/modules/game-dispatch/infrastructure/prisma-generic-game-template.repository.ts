import type { DbTransaction, PrismaClient } from "@pw/database";
import type {
  GenericGameTemplateRepository,
  GenericTemplateVersionsPage,
  GenericTemplateVersionsQuery,
} from "../application/generic-game-template.service.js";
import type {
  DraftConfigV2,
  PublishedConfigV2,
} from "../domain/game-template-config-v2.js";
import {
  PUBLISHED_GAME_LIMIT,
  readPublishedConfig,
  selectPublishedGames,
  selectPublishedTemplates,
  type PublishedGameSummary,
  type PublishedTemplateForm,
  type PublishedTemplateSummary,
} from "../domain/game-template-published-read.js";
import {
  GameTemplateRevisionConflictError,
  GenericTemplateError,
} from "../domain/errors.js";
import {
  type CursorPage,
  decodeTemplateCursor,
  encodeTemplateCursor,
  type CopyGenericTemplateInput,
  type CreateGenericTemplateInput,
  type ExpectedRevisionInput,
  type GenericTemplateDraftView,
  type GenericTemplateListPage,
  type GenericTemplateListQuery,
  type GenericTemplateSort,
  type GenericTemplateStatus,
  type GenericTemplateSummary,
  type GenericTemplateVersionSummary,
  type PublishGenericTemplateInput,
  type RestoreGenericTemplateInput,
  type SaveGenericTemplateDraftInput,
  type SaveGenericTemplateDraftResult,
} from "../domain/game-template-management.js";

/**
 * 可派单模板列表的硬上限：派单选择是「单个游戏的模板」这一有界集合，
 * 用固定上限约束响应体，避免无界列表（api-and-interface-design 的列表边界要求）。
 */
const PUBLISHED_TEMPLATE_LIMIT = 50;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 新建模板的初始草稿：结构有效、零组件，由服务端生成，
 * 不接受客户端传入的初始 config。
 */
const MINIMAL_DRAFT_CONFIG_V2 = {
  schemaVersion: 2,
  sections: [],
  components: [],
  staffingSource: { kind: "FIXED", count: 1 },
} as const;

/**
 * 列表摘要行。派生状态与“未发布改动”都在 SQL 内一次算出，
 * 避免按模板逐条加载 active version 造成 N+1。
 */
interface TemplateSummaryRow {
  id: string;
  name: string;
  description: string | null;
  revision: number;
  is_default: boolean;
  last_used_at: Date | null;
  updated_at: Date;
  updated_by: string | null;
  game_id: string | null;
  normalized_name: string;
  game_name: string | null;
  active_version_no: number | null;
  has_unpublished_changes: boolean;
  derived_status: GenericTemplateStatus;
}

interface TemplateRow {
  id: string;
  tenantId: string;
  gameId: string | null;
  name: string;
  description: string | null;
  status: string;
  revision: number;
  isDefault: boolean;
  activeVersionId: string | null;
  lastUsedAt: Date | null;
  updatedAt: Date;
  updatedBy: string | null;
  archivedAt: Date | null;
  draftSchemaVersion: number | null;
  draftConfigJson: unknown;
}

interface LockedTemplateRow {
  id: string;
  name: string;
  revision: number;
  status: string;
  archived_at: Date | string | null;
  updated_by: string | null;
  updated_at: Date | string;
  draft_schema_version: number | null;
  draft_config_json: unknown;
  game_id: string | null;
  active_version_id: string | null;
  is_default: boolean;
  last_used_at: Date | string | null;
}

interface VersionRow {
  id: string;
  versionNo: number;
  configJson: unknown;
  changeNote: string | null;
  publishedBy: string | null;
  publishedAt: Date;
  sourceVersionId: string | null;
}

interface VersionHistoryRow {
  id: string;
  version_no: number;
  schema_version: number | string | null;
  source_version_id: string | null;
  change_note: string | null;
  published_at: Date | string;
  published_by: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

/** 读取 Prisma 错误里的约束信息；没有信息时返回空串。 */
function constraintOf(error: unknown): string {
  if (error === null || typeof error !== "object") return "";
  const meta = (error as { meta?: unknown }).meta;
  if (meta === null || typeof meta !== "object") return "";
  const record = meta as Record<string, unknown>;
  if (typeof record.target === "string") return record.target;
  if (Array.isArray(record.target)) {
    return record.target.map((part) => String(part)).join(",");
  }
  return typeof record.constraint === "string" ? record.constraint : "";
}

/** 驱动/适配器可能返回 Date 或时间字符串，统一成 Date 再编码游标。 */
function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function configSchemaVersion(config: unknown): number {
  if (!isRecord(config)) return 0;
  const version = config.schemaVersion;
  return typeof version === "number" ? version : 0;
}

function toVersionSummary(row: VersionRow): GenericTemplateVersionSummary {
  return {
    id: row.id,
    versionNo: row.versionNo,
    schemaVersion: configSchemaVersion(row.configJson),
    sourceVersionId: row.sourceVersionId,
    changeNote: row.changeNote,
    publishedAt: asDate(row.publishedAt),
    publishedBy: row.publishedBy ?? "",
  };
}

function toSummary(
  row: TemplateSummaryRow,
  hasUnpublishedChanges: boolean,
): GenericTemplateSummary {
  return {
    id: row.id,
    // 未归类旧模板没有 gameId：契约里 game 非空，用空 id/name 显式表达“未归类”。
    game: { id: row.game_id ?? "", name: row.game_name ?? "" },
    name: row.name,
    description: row.description,
    status: row.derived_status,
    activeVersionNo: row.active_version_no ?? null,
    revision: row.revision,
    isDefault: row.is_default,
    lastUsedAt: row.last_used_at === null ? null : asDate(row.last_used_at),
    updatedAt: asDate(row.updated_at),
    updatedBy: row.updated_by,
    hasUnpublishedChanges,
  };
}

function toDraftView(
  row: TemplateRow,
  game: { id: string; name: string } | null,
  activeVersion: GenericTemplateVersionSummary | null,
  hasUnpublishedChanges: boolean,
): GenericTemplateDraftView {
  return {
    ...toSummary(
      {
        id: row.id,
        name: row.name,
        description: row.description,
        revision: row.revision,
        is_default: row.isDefault,
        last_used_at: row.lastUsedAt,
        updated_at: asDate(row.updatedAt),
        updated_by: row.updatedBy,
        game_id: row.gameId,
        normalized_name: row.name,
        game_name: game?.name ?? null,
        active_version_no: activeVersion?.versionNo ?? null,
        has_unpublished_changes: hasUnpublishedChanges,
        derived_status:
          row.archivedAt !== null
            ? "ARCHIVED"
            : row.status === "DRAFT"
              ? "DRAFT"
              : hasUnpublishedChanges
                ? "UNPUBLISHED_CHANGES"
                : "PUBLISHED",
      },
      hasUnpublishedChanges,
    ),
    config: (row.draftConfigJson ?? {}) as GenericTemplateDraftView["config"],
    activeVersion,
  };
}

export class PrismaGenericGameTemplateRepository implements GenericGameTemplateRepository {
  constructor(private readonly client: PrismaClient) {}

  async list(
    tenantId: string,
    query: GenericTemplateListQuery,
  ): Promise<GenericTemplateListPage> {
    const decoded = query.cursor
      ? decodeTemplateCursor(query.cursor, query.sort)
      : null;
    const cursorId = decoded?.id ?? null;
    const cursorUpdatedAt =
      decoded && (query.sort === "UPDATED_DESC" || query.sort === "UPDATED_ASC")
        ? requireCursorDate(decoded.value)
        : null;
    const cursorName =
      decoded && query.sort === "NAME_ASC"
        ? requireCursorText(decoded.value)
        : null;
    const cursorLastUsedAt =
      decoded && query.sort === "LAST_USED_DESC"
        ? optionalCursorDate(decoded.value)
        : null;

    const limit = Math.min(Math.max(query.limit, 1), 100);
    const statusFilter: GenericTemplateStatus | "ANY" = query.status ?? "ANY";
    const archivedOnly = statusFilter === "ARCHIVED";
    const q = query.q === undefined ? null : query.q;
    const gameId = query.gameId ?? null;
    // 未归类旧模板：契约新增 gameScope=UNCLASSIFIED，按 game_id 为空过滤。
    const unclassified = query.gameScope === "UNCLASSIFIED";

    const rows = await this.client.$queryRaw<TemplateSummaryRow[]>`
      WITH candidate AS (
        SELECT
          t.id,
          t.name,
          t.description,
          t.normalized_name,
          t.revision,
          t.is_default,
          t.last_used_at,
          t.updated_at,
          t.updated_by,
          t.game_id,
          g.name AS game_name,
          v.version_no AS active_version_no,
          (
            t.draft_config_json IS NOT NULL
            AND t.draft_schema_version = 2
            AND v.id IS NOT NULL
            AND (t.draft_config_json - 'legacyCompatibility'::text)
              IS DISTINCT FROM (v.config_json - 'documentRendererVersion'::text)
          ) AS has_unpublished_changes,
          CASE
            WHEN t.archived_at IS NOT NULL THEN 'ARCHIVED'
            WHEN t.status = 'DRAFT' THEN 'DRAFT'
            WHEN (
              t.draft_config_json IS NOT NULL
              AND t.draft_schema_version = 2
              AND v.id IS NOT NULL
              AND (t.draft_config_json - 'legacyCompatibility'::text)
                IS DISTINCT FROM (v.config_json - 'documentRendererVersion'::text)
            ) THEN 'UNPUBLISHED_CHANGES'
            ELSE 'PUBLISHED'
          END AS derived_status
        FROM game_dispatch_templates t
        LEFT JOIN games g
          ON g.tenant_id = t.tenant_id AND g.id = t.game_id
        LEFT JOIN game_dispatch_template_versions v
          ON v.tenant_id = t.tenant_id AND v.id = t.active_version_id
        WHERE t.tenant_id = ${tenantId}::uuid
          AND (${archivedOnly}::boolean = true OR t.archived_at IS NULL)
          AND (${archivedOnly}::boolean = false OR t.archived_at IS NOT NULL)
          AND (${gameId}::uuid IS NULL OR t.game_id = ${gameId}::uuid)
          AND (${unclassified}::boolean IS NOT TRUE OR t.game_id IS NULL)
          AND (
            ${q}::text IS NULL
            OR strpos(lower(t.name), lower(${q}::text)) > 0
            OR strpos(lower(COALESCE(t.description, '')), lower(${q}::text)) > 0
          )
          AND (
            ${cursorId}::uuid IS NULL
            OR (
              ${query.sort}::text = 'UPDATED_DESC'
              AND (t.updated_at, t.id)
                < (${cursorUpdatedAt}::timestamp, ${cursorId}::uuid)
            )
            OR (
              ${query.sort}::text = 'UPDATED_ASC'
              AND (t.updated_at, t.id)
                > (${cursorUpdatedAt}::timestamp, ${cursorId}::uuid)
            )
            OR (
              ${query.sort}::text = 'NAME_ASC'
              AND (t.normalized_name, t.id)
                > (${cursorName}::text, ${cursorId}::uuid)
            )
            OR (
              ${query.sort}::text = 'LAST_USED_DESC'
              AND ${cursorLastUsedAt}::timestamp IS NOT NULL
              AND (
                t.last_used_at < ${cursorLastUsedAt}::timestamp
                OR (
                  t.last_used_at = ${cursorLastUsedAt}::timestamp
                  AND t.id < ${cursorId}::uuid
                )
                OR t.last_used_at IS NULL
              )
            )
            OR (
              ${query.sort}::text = 'LAST_USED_DESC'
              AND ${cursorLastUsedAt}::timestamp IS NULL
              AND t.last_used_at IS NULL
              AND t.id < ${cursorId}::uuid
            )
          )
      )
      SELECT *
      FROM candidate
      WHERE (${statusFilter}::text = 'ANY' OR derived_status = ${statusFilter}::text)
      ORDER BY
        CASE WHEN ${query.sort}::text = 'UPDATED_DESC' THEN updated_at END DESC NULLS LAST,
        CASE WHEN ${query.sort}::text = 'UPDATED_ASC' THEN updated_at END ASC NULLS LAST,
        CASE WHEN ${query.sort}::text = 'NAME_ASC' THEN normalized_name END ASC NULLS LAST,
        CASE WHEN ${query.sort}::text = 'LAST_USED_DESC' THEN last_used_at END DESC NULLS LAST,
        CASE
          WHEN ${query.sort}::text IN ('UPDATED_DESC', 'LAST_USED_DESC') THEN id
        END DESC NULLS LAST,
        CASE
          WHEN ${query.sort}::text IN ('UPDATED_ASC', 'NAME_ASC') THEN id
        END ASC NULLS LAST
      LIMIT ${limit + 1}
    `;

    const page = rows.slice(0, limit);
    const nextCursor =
      rows.length > limit && page.length > 0
        ? encodeTemplateCursor(
            cursorValueOf(
              query.sort,
              page[page.length - 1] as TemplateSummaryRow,
            ),
          )
        : null;
    return {
      data: page.map((row) =>
        toSummary(row, row.has_unpublished_changes === true),
      ),
      page: { nextCursor },
    };
  }

  async createDraft(
    tenantId: string,
    actorId: string,
    input: CreateGenericTemplateInput,
  ): Promise<GenericTemplateDraftView> {
    return await this.client.$transaction(async (tx) => {
      const game = await tx.game.findFirst({
        where: { tenantId, id: input.gameId },
        select: { id: true, name: true },
      });
      if (!game) {
        throw new GenericTemplateError(
          "TEMPLATE_BINDING_INVALID",
          "游戏不存在或不属于当前租户",
          { gameId: input.gameId },
        );
      }

      let created: TemplateRow;
      try {
        created = (await tx.gameDispatchTemplate.create({
          data: {
            tenantId,
            gameId: game.id,
            name: input.name,
            description: input.description ?? null,
            status: "DRAFT",
            revision: 1,
            isDefault: false,
            activeVersionId: null,
            copyLines: JSON.parse(JSON.stringify([])),
            blockLabels: JSON.parse(JSON.stringify({})),
            draftConfigJson: JSON.parse(
              JSON.stringify(MINIMAL_DRAFT_CONFIG_V2),
            ),
            draftSchemaVersion: 2,
            createdBy: actorId,
            updatedBy: actorId,
          },
        })) as unknown as TemplateRow;
      } catch (error) {
        // 只映射已确认的约束：插入时唯一冲突只可能来自名称索引，
        // 外键冲突只可能来自 (tenant_id, game_id) → games；其余继续抛出。
        if (hasErrorCode(error, "P2002")) {
          const constraint = constraintOf(error);
          if (constraint === "" || /name/i.test(constraint)) {
            throw new GenericTemplateError(
              "TEMPLATE_NAME_CONFLICT",
              "同一游戏下已存在同名模板",
              { gameId: input.gameId, name: input.name },
            );
          }
        }
        if (hasErrorCode(error, "P2003")) {
          const constraint = constraintOf(error);
          if (constraint === "" || /game/i.test(constraint)) {
            throw new GenericTemplateError(
              "TEMPLATE_BINDING_INVALID",
              "游戏不存在或不属于当前租户",
              { gameId: input.gameId },
            );
          }
        }
        throw error;
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: "tenant_account",
          actorId,
          action: "game_template.v2.create",
          resourceType: "game_dispatch_template",
          resourceId: created.id,
          summary: `创建通用模板「${created.name}」`,
        },
      });

      return toDraftView(created, game, null, false);
    });
  }

  async getDraft(
    tenantId: string,
    id: string,
  ): Promise<GenericTemplateDraftView> {
    const row = (await this.client.gameDispatchTemplate.findFirst({
      where: { tenantId, id },
    })) as unknown as TemplateRow | null;
    if (!row) throw notFound(id);
    if (row.draftSchemaVersion !== 2 || row.draftConfigJson == null) {
      throw new GenericTemplateError(
        "TEMPLATE_VERSION_UNAVAILABLE",
        "模板没有可用的 v2 草稿，无法按最新版本读取",
        { templateId: id, draftSchemaVersion: row.draftSchemaVersion },
      );
    }

    const game =
      row.gameId === null
        ? null
        : await this.client.game.findFirst({
            where: { tenantId, id: row.gameId },
            select: { id: true, name: true },
          });
    const activeVersionRow =
      row.activeVersionId === null
        ? null
        : ((await this.client.gameDispatchTemplateVersion.findFirst({
            where: {
              tenantId,
              templateId: row.id,
              id: row.activeVersionId,
            },
          })) as unknown as VersionRow | null);

    const activeSummary = activeVersionRow
      ? toVersionSummary(activeVersionRow)
      : null;
    const hasUnpublishedChanges =
      activeVersionRow === null
        ? false
        : // 列表用 SQL 规范化比较；详情用同一规范化规则（去掉服务端专属字段）
          // 比较草稿与生效版本，避免把 rendererVersion/legacyCompatibility 当成改动。
          JSON.stringify(withoutLegacy(row.draftConfigJson)) !==
          JSON.stringify(withoutRenderer(activeVersionRow.configJson));

    return toDraftView(row, game ?? null, activeSummary, hasUnpublishedChanges);
  }

  async saveDraft(
    tenantId: string,
    actorId: string,
    id: string,
    input: SaveGenericTemplateDraftInput,
  ): Promise<SaveGenericTemplateDraftResult> {
    return await this.client.$transaction(async (tx) => {
      const current = await lockTemplate(tx, tenantId, id);

      assertNotArchived(current, id, "保存草稿");
      if (current.draft_schema_version !== 2) {
        throw new GenericTemplateError(
          "TEMPLATE_VERSION_UNAVAILABLE",
          "模板没有可用的 v2 草稿，无法保存",
          {
            templateId: id,
            draftSchemaVersion: current.draft_schema_version,
          },
        );
      }
      assertRevision(current, input.expectedRevision);

      const nextRevision = current.revision + 1;
      const saved = await tx.gameDispatchTemplate.update({
        where: { id: current.id },
        data: {
          draftConfigJson: JSON.parse(JSON.stringify(input.config)),
          draftSchemaVersion: 2,
          revision: nextRevision,
          updatedBy: actorId,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: "tenant_account",
          actorId,
          action: "game_template.v2.draft_save",
          resourceType: "game_dispatch_template",
          resourceId: current.id,
          summary: `保存通用模板草稿「${current.name}」r${nextRevision}`,
        },
      });

      return {
        revision: saved.revision,
        updatedAt: asDate(saved.updatedAt),
        updatedBy: saved.updatedBy ?? actorId,
        validationWarnings: [],
      };
    });
  }

  async publish(
    tenantId: string,
    actorId: string,
    id: string,
    input: PublishGenericTemplateInput,
    buildPublishedConfig: (draft: unknown) => PublishedConfigV2,
  ): Promise<GenericTemplateDraftView> {
    return await this.client.$transaction(async (tx) => {
      const current = await lockTemplate(tx, tenantId, id);

      const lockedAt = asDate(current.updated_at);
      assertNotArchived(current, id, "发布");
      if (
        current.draft_schema_version !== 2 ||
        current.draft_config_json == null
      ) {
        throw new GenericTemplateError(
          "TEMPLATE_VERSION_UNAVAILABLE",
          "模板没有可用的 v2 草稿，无法发布",
          {
            templateId: id,
            draftSchemaVersion: current.draft_schema_version,
          },
        );
      }
      assertRevision(current, input.expectedRevision);

      // 候选发布配置只从服务端当前草稿生成；校验失败即整事务回滚，
      // 不创建版本、不改 activeVersionId/revision、不写审计。
      const publishedConfig = buildPublishedConfig(current.draft_config_json);

      let sourceVersionId: string | null = null;
      if (input.sourceVersionId != null) {
        // sourceVersionId 只用于版本溯源，不参与授权，也不决定本次发布配置。
        const source = await tx.gameDispatchTemplateVersion.findFirst({
          where: { tenantId, templateId: id, id: input.sourceVersionId },
          select: { id: true },
        });
        if (!source) {
          throw new GenericTemplateError(
            "TEMPLATE_VERSION_UNAVAILABLE",
            "来源版本不存在或不属于该模板",
            { sourceVersionId: input.sourceVersionId },
          );
        }
        sourceVersionId = source.id;
      }

      const nextVersionRows = await tx.$queryRaw<
        Array<{ next_version_no: number }>
      >`
        SELECT COALESCE(MAX(version_no), 0) + 1 AS next_version_no
        FROM game_dispatch_template_versions
        WHERE tenant_id = ${tenantId}::uuid AND template_id = ${id}::uuid`;
      const nextVersionNo = Number(nextVersionRows[0]?.next_version_no ?? 1);

      let version: VersionRow;
      try {
        version = (await tx.gameDispatchTemplateVersion.create({
          data: {
            tenantId,
            templateId: id,
            versionNo: nextVersionNo,
            configJson: JSON.parse(JSON.stringify(publishedConfig)),
            changeNote: input.changeNote ?? null,
            publishedBy: actorId,
            sourceVersionId,
          },
        })) as unknown as VersionRow;
      } catch (error) {
        // 行锁下版本号不可能重复；真出现该约束冲突按并发发布处理。
        if (
          hasErrorCode(error, "P2002") &&
          /version/i.test(constraintOf(error))
        ) {
          throw new GameTemplateRevisionConflictError(
            input.expectedRevision,
            current.revision,
            current.updated_by,
            lockedAt.toISOString(),
          );
        }
        throw error;
      }

      const updated = (await tx.gameDispatchTemplate.update({
        where: { id: current.id },
        data: {
          activeVersionId: version.id,
          status: "PUBLISHED",
          revision: current.revision + 1,
          updatedBy: actorId,
        },
      })) as unknown as TemplateRow;

      const note = input.changeNote?.trim();
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: "tenant_account",
          actorId,
          action: "game_template.v2.publish",
          resourceType: "game_dispatch_template",
          resourceId: current.id,
          summary: `发布通用模板「${current.name}」v${version.versionNo} r${updated.revision}${
            note ? `：${note.slice(0, 200)}` : ""
          }`,
        },
      });

      return await this.draftViewAfterMutation(tx, tenantId, updated.id);
    });
  }

  async listVersions(
    tenantId: string,
    templateId: string,
    query: GenericTemplateVersionsQuery,
  ): Promise<GenericTemplateVersionsPage> {
    const exists = await this.client.gameDispatchTemplate.findFirst({
      where: { tenantId, id: templateId },
      select: { id: true },
    });
    if (!exists) throw notFound(templateId);

    const decoded = query.cursor ? decodeVersionCursor(query.cursor) : null;
    const limit = Math.min(Math.max(Math.trunc(query.limit), 1), 100);
    const cursorPublishedAt = decoded?.publishedAt ?? null;
    const cursorId = decoded?.id ?? null;

    const rows = await this.client.$queryRaw<VersionHistoryRow[]>`
      SELECT
        id,
        version_no,
        (config_json ->> 'schemaVersion') AS schema_version,
        source_version_id,
        change_note,
        published_at,
        published_by
      FROM game_dispatch_template_versions
      WHERE tenant_id = ${tenantId}::uuid
        AND template_id = ${templateId}::uuid
        AND (
          ${cursorPublishedAt}::timestamp IS NULL
          OR (published_at, id)
            < (${cursorPublishedAt}::timestamp, ${cursorId}::uuid)
        )
      ORDER BY published_at DESC, id DESC
      LIMIT ${limit + 1}
    `;

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor: CursorPage["nextCursor"] =
      rows.length > limit && last
        ? encodeVersionCursor({
            publishedAt: asDate(last.published_at).toISOString(),
            id: last.id,
          })
        : null;

    return {
      data: page.map((row) => ({
        id: row.id,
        versionNo: row.version_no,
        schemaVersion:
          row.schema_version === null ? 0 : Number(row.schema_version),
        sourceVersionId: row.source_version_id,
        changeNote: row.change_note,
        publishedAt: asDate(row.published_at),
        publishedBy: row.published_by ?? "",
      })),
      page: { nextCursor },
    };
  }

  async restoreVersion(
    tenantId: string,
    actorId: string,
    id: string,
    input: RestoreGenericTemplateInput,
    buildDraftConfig: (versionConfig: unknown) => DraftConfigV2,
  ): Promise<GenericTemplateDraftView & { sourceVersionId: string }> {
    return await this.client.$transaction(async (tx) => {
      const current = await lockTemplate(tx, tenantId, id);
      assertNotArchived(current, id, "恢复草稿");
      assertRevision(current, input.expectedRevision);

      const version = (await tx.gameDispatchTemplateVersion.findFirst({
        where: { tenantId, templateId: id, id: input.versionId },
      })) as unknown as VersionRow | null;
      if (!version) {
        throw new GenericTemplateError(
          "TEMPLATE_VERSION_UNAVAILABLE",
          "版本不存在或不属于该模板",
          { templateId: id, versionId: input.versionId },
        );
      }
      // 版本配置在事务内由应用层转换并校验；v1 版本在这里被显式拒绝。
      const draftConfig = buildDraftConfig(version.configJson);

      // 恢复只改草稿与 revision：activeVersion/status 不变，不直接上线。
      await tx.gameDispatchTemplate.update({
        where: { id: current.id },
        data: {
          draftConfigJson: JSON.parse(JSON.stringify(draftConfig)),
          draftSchemaVersion: 2,
          revision: current.revision + 1,
          updatedBy: actorId,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: "tenant_account",
          actorId,
          action: "game_template.v2.restore",
          resourceType: "game_dispatch_template",
          resourceId: current.id,
          summary: `从 v${version.versionNo} 恢复通用模板草稿「${current.name}」r${current.revision + 1}`,
        },
      });

      const view = await this.draftViewAfterMutation(tx, tenantId, current.id);
      return { ...view, sourceVersionId: version.id };
    });
  }

  async copyTemplate(
    tenantId: string,
    actorId: string,
    id: string,
    input: CopyGenericTemplateInput,
  ): Promise<GenericTemplateDraftView> {
    return await this.client.$transaction(async (tx) => {
      // 源模板可以是归档状态，但必须有可用的 v2 草稿。
      const source = (await tx.gameDispatchTemplate.findFirst({
        where: { tenantId, id },
      })) as unknown as TemplateRow | null;
      if (!source) throw notFound(id);
      if (source.draftSchemaVersion !== 2 || source.draftConfigJson == null) {
        throw new GenericTemplateError(
          "TEMPLATE_VERSION_UNAVAILABLE",
          "源模板没有可用的 v2 草稿，无法复制",
          { templateId: id, draftSchemaVersion: source.draftSchemaVersion },
        );
      }

      const game = await tx.game.findFirst({
        where: { tenantId, id: input.targetGameId },
        select: { id: true, name: true },
      });
      if (!game) {
        throw new GenericTemplateError(
          "TEMPLATE_BINDING_INVALID",
          "游戏不存在或不属于当前租户",
          { gameId: input.targetGameId },
        );
      }

      let created: TemplateRow;
      try {
        created = (await tx.gameDispatchTemplate.create({
          data: {
            tenantId,
            gameId: game.id,
            name: input.newName,
            description: source.description,
            status: "DRAFT",
            revision: 1,
            isDefault: false,
            activeVersionId: null,
            lastUsedAt: null,
            archivedAt: null,
            // 旧固定模块（copyLines/blockLabels）与版本历史都不复制。
            copyLines: JSON.parse(JSON.stringify([])),
            blockLabels: JSON.parse(JSON.stringify({})),
            // 深拷贝草稿，避免与源模板共享 JSON 对象引用。
            draftConfigJson: JSON.parse(JSON.stringify(source.draftConfigJson)),
            draftSchemaVersion: 2,
            createdBy: actorId,
            updatedBy: actorId,
          },
        })) as unknown as TemplateRow;
      } catch (error) {
        if (hasErrorCode(error, "P2002")) {
          const constraint = constraintOf(error);
          if (constraint === "" || /name/i.test(constraint)) {
            throw new GenericTemplateError(
              "TEMPLATE_NAME_CONFLICT",
              "同一游戏下已存在同名模板",
              { gameId: input.targetGameId, name: input.newName },
            );
          }
        }
        if (hasErrorCode(error, "P2003")) {
          throw new GenericTemplateError(
            "TEMPLATE_BINDING_INVALID",
            "游戏不存在或不属于当前租户",
            { gameId: input.targetGameId },
          );
        }
        throw error;
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: "tenant_account",
          actorId,
          action: "game_template.v2.copy",
          resourceType: "game_dispatch_template",
          resourceId: created.id,
          summary: `复制通用模板「${source.name}」→「${created.name}」`,
        },
      });

      return toDraftView(created, game, null, false);
    });
  }

  async setDefault(
    tenantId: string,
    actorId: string,
    id: string,
    input: ExpectedRevisionInput,
  ): Promise<GenericTemplateDraftView> {
    try {
      return await this.client.$transaction(async (tx) => {
        const current = await lockTemplate(tx, tenantId, id);
        assertNotArchived(current, id, "设为默认");
        assertRevision(current, input.expectedRevision);

        if (current.game_id === null) {
          throw new GenericTemplateError(
            "TEMPLATE_BINDING_INVALID",
            "未归类模板不能设为默认",
            { templateId: id },
          );
        }
        if (
          current.status !== "PUBLISHED" ||
          current.active_version_id === null
        ) {
          throw new GenericTemplateError(
            "TEMPLATE_VERSION_UNAVAILABLE",
            "只有已发布且存在生效版本的模板可以设为默认",
            {
              templateId: id,
              status: current.status,
              activeVersionId: current.active_version_id,
            },
          );
        }

        // 锁定游戏行，串行化同游戏的默认切换，避免部分唯一索引竞态。
        await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM games
        WHERE tenant_id = ${tenantId}::uuid AND id = ${current.game_id}::uuid
        FOR UPDATE`;

        // 先清除同游戏旧默认（不改旧模板 revision），再设置目标模板。
        await tx.gameDispatchTemplate.updateMany({
          where: {
            tenantId,
            gameId: current.game_id,
            isDefault: true,
            id: { not: current.id },
          },
          data: { isDefault: false },
        });
        await tx.gameDispatchTemplate.update({
          where: { id: current.id },
          data: {
            isDefault: true,
            revision: current.revision + 1,
            updatedBy: actorId,
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId,
            actorType: "tenant_account",
            actorId,
            action: "game_template.v2.set_default",
            resourceType: "game_dispatch_template",
            resourceId: current.id,
            summary: `设置通用模板默认「${current.name}」r${current.revision + 1}`,
          },
        });

        return await this.draftViewAfterMutation(tx, tenantId, current.id);
      });
    } catch (error) {
      const conflict = mapConcurrentConflict(error, id);
      if (conflict) throw conflict;
      throw error;
    }
  }

  async archiveTemplate(
    tenantId: string,
    actorId: string,
    id: string,
    input: ExpectedRevisionInput,
  ): Promise<GenericTemplateDraftView> {
    return await this.client.$transaction(async (tx) => {
      const current = await lockTemplate(tx, tenantId, id);
      assertNotArchived(current, id, "归档");
      assertRevision(current, input.expectedRevision);

      // 归档保留草稿、生效版本与历史，只清除默认并推进 revision。
      await tx.gameDispatchTemplate.update({
        where: { id: current.id },
        data: {
          status: "ARCHIVED",
          archivedAt: new Date(),
          isDefault: false,
          revision: current.revision + 1,
          updatedBy: actorId,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: "tenant_account",
          actorId,
          action: "game_template.v2.archive",
          resourceType: "game_dispatch_template",
          resourceId: current.id,
          summary: `归档通用模板「${current.name}」r${current.revision + 1}`,
        },
      });

      return await this.draftViewAfterMutation(tx, tenantId, current.id);
    });
  }

  async unarchiveTemplate(
    tenantId: string,
    actorId: string,
    id: string,
    input: ExpectedRevisionInput,
  ): Promise<GenericTemplateDraftView> {
    return await this.client.$transaction(async (tx) => {
      const current = await lockTemplate(tx, tenantId, id);
      assertRevision(current, input.expectedRevision);

      // 有生效版本回到 PUBLISHED，否则回到 DRAFT；不改变任何版本数据。
      const nextStatus =
        current.active_version_id === null ? "DRAFT" : "PUBLISHED";
      await tx.gameDispatchTemplate.update({
        where: { id: current.id },
        data: {
          status: nextStatus,
          archivedAt: null,
          revision: current.revision + 1,
          updatedBy: actorId,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: "tenant_account",
          actorId,
          action: "game_template.v2.unarchive",
          resourceType: "game_dispatch_template",
          resourceId: current.id,
          summary: `取消归档通用模板「${current.name}」→ ${nextStatus}`,
        },
      });

      return await this.draftViewAfterMutation(tx, tenantId, current.id);
    });
  }

  async deleteTemplate(
    tenantId: string,
    actorId: string,
    id: string,
    input: ExpectedRevisionInput,
  ): Promise<void> {
    await this.client.$transaction(async (tx) => {
      const current = await lockTemplate(tx, tenantId, id);
      assertRevision(current, input.expectedRevision);

      const versions = await tx.gameDispatchTemplateVersion.findMany({
        where: { tenantId, templateId: id },
        select: { id: true },
      });
      const snapshotCount = await tx.gameDispatchTemplateSnapshot.count({
        where: { tenantId, templateId: id },
      });
      const orderCount =
        versions.length === 0
          ? 0
          : await tx.gameDispatchOrder.count({
              where: {
                tenantId,
                templateVersionId: { in: versions.map((row) => row.id) },
              },
            });

      if (
        current.active_version_id !== null ||
        versions.length > 0 ||
        snapshotCount > 0 ||
        orderCount > 0
      ) {
        throw new GenericTemplateError(
          "TEMPLATE_DELETE_RESTRICTED",
          "模板已发布或已被引用，请改为归档",
          {
            templateId: id,
            versionCount: versions.length,
            snapshotCount,
            orderCount,
          },
        );
      }

      // audit_logs 只有 tenant_id 外键、没有模板级 cascade；
      // 审计与删除在同一事务内完成，删除后审计仍然保留。
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: "tenant_account",
          actorId,
          action: "game_template.v2.delete",
          resourceType: "game_dispatch_template",
          resourceId: current.id,
          summary: `删除未发布的通用模板「${current.name}」`,
        },
      });
      await tx.gameDispatchTemplate.delete({ where: { id: current.id } });
    });
  }

  private async draftViewAfterMutation(
    tx: DbTransaction,
    tenantId: string,
    templateId: string,
  ): Promise<GenericTemplateDraftView> {
    const row = (await tx.gameDispatchTemplate.findFirstOrThrow({
      where: { tenantId, id: templateId },
    })) as unknown as TemplateRow;
    const game =
      row.gameId === null
        ? null
        : await tx.game.findFirst({
            where: { tenantId, id: row.gameId },
            select: { id: true, name: true },
          });
    const activeVersion =
      row.activeVersionId === null
        ? null
        : ((await tx.gameDispatchTemplateVersion.findFirst({
            where: { tenantId, templateId: row.id, id: row.activeVersionId },
          })) as unknown as VersionRow | null);
    const hasUnpublishedChanges =
      activeVersion === null
        ? false
        : JSON.stringify(withoutLegacy(row.draftConfigJson)) !==
          JSON.stringify(withoutRenderer(activeVersion.configJson));
    return toDraftView(
      row,
      game ?? null,
      activeVersion ? toVersionSummary(activeVersion) : null,
      hasUnpublishedChanges,
    );
  }

  /** 该游戏可派单的模板摘要（未归档 + 有生效版本），顺序由领域规则决定。 */
  async listPublishedTemplates(
    tenantId: string,
    gameId: string,
  ): Promise<PublishedTemplateSummary[]> {
    const templates = await this.client.gameDispatchTemplate.findMany({
      where: {
        tenantId,
        gameId,
        archivedAt: null,
        activeVersionId: { not: null },
      },
      select: {
        id: true,
        gameId: true,
        name: true,
        description: true,
        activeVersionId: true,
        isDefault: true,
        lastUsedAt: true,
        updatedAt: true,
        archivedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: PUBLISHED_TEMPLATE_LIMIT,
    });
    const versionIds = templates
      .map((row) => row.activeVersionId)
      .filter((id): id is string => id !== null);
    const versions =
      versionIds.length === 0
        ? []
        : await this.client.gameDispatchTemplateVersion.findMany({
            where: { tenantId, id: { in: versionIds } },
            select: { id: true, versionNo: true },
          });
    const versionNoById = new Map(
      versions.map((row) => [row.id, row.versionNo] as const),
    );

    return selectPublishedTemplates(
      templates.map((row) => ({
        ...row,
        activeVersionNo:
          row.activeVersionId === null
            ? null
            : (versionNoById.get(row.activeVersionId) ?? null),
      })),
    );
  }

  /** 锁定版本的发布表单：版本不存在或发布配置不可用时返回 null。 */
  async findPublishedVersionForm(
    tenantId: string,
    versionId: string,
  ): Promise<PublishedTemplateForm | null> {
    const version = await this.client.gameDispatchTemplateVersion.findFirst({
      where: { tenantId, id: versionId },
      select: {
        id: true,
        templateId: true,
        versionNo: true,
        configJson: true,
      },
    });
    if (!version) return null;
    const template = await this.client.gameDispatchTemplate.findFirst({
      where: { tenantId, id: version.templateId },
      select: { id: true, gameId: true },
    });
    if (!template) return null;
    const config = readPublishedConfig(version.configJson);
    if (config === null) return null;
    return {
      templateId: template.id,
      gameId: template.gameId,
      versionId: version.id,
      versionNo: version.versionNo,
      config,
    };
  }

  /** 客户可下单的游戏：按游戏去重后回查游戏名，筛选与排序交给领域规则。 */
  async listPublishedGames(tenantId: string): Promise<PublishedGameSummary[]> {
    // distinct 让上限约束的是「游戏数」而不是「模板行数」；
    // 停用（enabled=false）的游戏不在这里过滤，与按游戏读已发布模板的口径一致。
    const templates = await this.client.gameDispatchTemplate.findMany({
      where: {
        tenantId,
        gameId: { not: null },
        archivedAt: null,
        activeVersionId: { not: null },
      },
      select: { gameId: true, archivedAt: true, activeVersionId: true },
      distinct: ["gameId"],
      orderBy: { gameId: "asc" },
      take: PUBLISHED_GAME_LIMIT,
    });
    const gameIds = templates
      .map((row) => row.gameId)
      .filter((id): id is string => id !== null);
    const games =
      gameIds.length === 0
        ? []
        : await this.client.game.findMany({
            // 只回启用游戏：停用游戏不进客户侧列表（与客服端新建派单的选择器同口径）。
            where: { tenantId, id: { in: gameIds }, enabled: true },
            select: { id: true, name: true },
          });
    const nameById = new Map(
      games.map((game) => [game.id, game.name] as const),
    );

    return selectPublishedGames(
      templates.map((row) => ({
        gameId: row.gameId,
        gameName:
          row.gameId === null ? null : (nameById.get(row.gameId) ?? null),
        archivedAt: row.archivedAt,
        activeVersionId: row.activeVersionId,
      })),
    );
  }
}

/**
 * 并发写冲突 → 受控 409。
 *
 * 单机唯一索引/写冲突（P2002 唯一约束、P2034 序列化或死锁回滚）在不做映射时
 * 会变成 500；这类冲突对调用方就是"重试或重新加载"的语义，与服务端既有
 * TEMPLATE_REVISION_CONFLICT 一致（同文件其他写路径已有 P2002 → 409 的先例）。
 */
function mapConcurrentConflict(
  error: unknown,
  templateId: string,
): GenericTemplateError | null {
  const code = (error as { code?: unknown } | null)?.code;
  if (code !== "P2002" && code !== "P2034") return null;
  return new GenericTemplateError(
    "TEMPLATE_REVISION_CONFLICT",
    "并发写入冲突，请重新加载后重试",
    {
      templateId,
      reason: code === "P2002" ? "UNIQUE_CONFLICT" : "WRITE_CONFLICT",
    },
  );
}
function notFound(id: string): GenericTemplateError {
  return new GenericTemplateError("TEMPLATE_NOT_FOUND", "模板不存在", {
    templateId: id,
  });
}

function invalidCursor(): GenericTemplateError {
  return new GenericTemplateError(
    "TEMPLATE_CURSOR_INVALID",
    "模板列表游标无效或与排序不匹配",
  );
}

/** 所有生命周期动作共用的 tenant-scoped 行锁。 */
async function lockTemplate(
  tx: DbTransaction,
  tenantId: string,
  id: string,
): Promise<LockedTemplateRow> {
  const rows = await tx.$queryRaw<LockedTemplateRow[]>`
    SELECT
      id,
      name,
      revision,
      status,
      archived_at,
      updated_by,
      updated_at,
      draft_schema_version,
      draft_config_json,
      game_id,
      active_version_id,
      is_default,
      last_used_at
    FROM game_dispatch_templates
    WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid
    FOR UPDATE`;
  const row = rows[0];
  if (!row) throw notFound(id);
  return row;
}

function assertNotArchived(
  row: LockedTemplateRow,
  id: string,
  action: string,
): void {
  if (row.archived_at !== null || row.status === "ARCHIVED") {
    throw new GenericTemplateError(
      "TEMPLATE_ARCHIVED",
      `模板已归档，不能${action}`,
      { templateId: id },
    );
  }
}

/** 所有生命周期动作共用的 revision 冲突映射。 */
function assertRevision(
  row: LockedTemplateRow,
  expectedRevision: number,
): void {
  if (row.revision !== expectedRevision) {
    throw new GameTemplateRevisionConflictError(
      expectedRevision,
      row.revision,
      row.updated_by,
      asDate(row.updated_at).toISOString(),
    );
  }
}

function requireCursorDate(value: string | null): string {
  if (value === null || Number.isNaN(Date.parse(value))) throw invalidCursor();
  return value;
}

function requireCursorText(value: string | null): string {
  if (value === null || value.length === 0) throw invalidCursor();
  return value;
}

function optionalCursorDate(value: string | null): string | null {
  if (value === null) return null;
  if (Number.isNaN(Date.parse(value))) throw invalidCursor();
  return value;
}

/** 版本历史游标：按 (publishedAt, id) 稳定分页，与模板列表游标相互独立。 */
function encodeVersionCursor(value: {
  publishedAt: string;
  id: string;
}): string {
  return Buffer.from(
    JSON.stringify({ v: 1, publishedAt: value.publishedAt, id: value.id }),
    "utf8",
  ).toString("base64url");
}

function decodeVersionCursor(cursor: string): {
  publishedAt: string;
  id: string;
} {
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (!isRecord(decoded) || Object.keys(decoded).length !== 3) {
      throw invalidCursor();
    }
    const publishedAt = decoded.publishedAt;
    const id = decoded.id;
    if (
      decoded.v !== 1 ||
      typeof publishedAt !== "string" ||
      Number.isNaN(Date.parse(publishedAt)) ||
      typeof id !== "string" ||
      !UUID_PATTERN.test(id)
    ) {
      throw invalidCursor();
    }
    return { publishedAt, id };
  } catch (error) {
    if (error instanceof GenericTemplateError) throw error;
    throw invalidCursor();
  }
}

function cursorValueOf(
  sort: GenericTemplateSort,
  row: TemplateSummaryRow,
): { sort: GenericTemplateSort; value: string | null; id: string } {
  if (sort === "NAME_ASC") {
    return { sort, value: row.normalized_name, id: row.id };
  }
  if (sort === "LAST_USED_DESC") {
    return {
      sort,
      value:
        row.last_used_at === null
          ? null
          : asDate(row.last_used_at).toISOString(),
      id: row.id,
    };
  }
  return { sort, value: asDate(row.updated_at).toISOString(), id: row.id };
}

function withoutLegacy(config: unknown): unknown {
  if (!isRecord(config)) return config;
  const copy: Record<string, unknown> = { ...config };
  delete copy.legacyCompatibility;
  return copy;
}

function withoutRenderer(config: unknown): unknown {
  if (!isRecord(config)) return config;
  const copy: Record<string, unknown> = { ...config };
  delete copy.documentRendererVersion;
  return copy;
}

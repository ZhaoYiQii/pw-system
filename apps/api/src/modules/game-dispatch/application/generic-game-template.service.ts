import type {
  DraftConfigV2,
  PublishedConfigV2,
  TemplateConfigIssue,
} from "../domain/game-template-config-v2.js";
import {
  collectPublishBlockingIssuesV2,
  validateDraftConfigV2,
  validatePublishedConfigV2,
  visibleConfigV2,
  type TemplateAudienceV2,
} from "../domain/game-template-config-v2.js";
import { GenericTemplateError } from "../domain/errors.js";
import {
  TEMPLATE_EVENTS,
  emitTemplateEvent,
  withTemplateTiming,
} from "./game-template-observability.js";
import {
  type CursorPage,
  decodeTemplateCursor,
  type CopyGenericTemplateInput,
  type CreateGenericTemplateInput,
  type ExpectedRevisionInput,
  type GenericTemplateDraftView,
  type GenericTemplateListPage,
  type GenericTemplateListQuery,
  type GenericTemplateVersionSummary,
  type PublishGenericTemplateInput,
  type RestoreGenericTemplateInput,
  type SaveGenericTemplateDraftInput,
  type SaveGenericTemplateDraftResult,
} from "../domain/game-template-management.js";
import {
  type PublishedTemplateForm,
  type PublishedTemplateSummary,
} from "../domain/game-template-published-read.js";

/** 版本历史的查询与分页形状（版本游标按 publishedAt+id 排序）。 */
export interface GenericTemplateVersionsQuery {
  cursor?: string;
  limit: number;
}

export interface GenericTemplateVersionsPage {
  data: GenericTemplateVersionSummary[];
  page: CursorPage;
}

/**
 * S2 通用模板管理的持久化端口。所有入口的第一个参数都是 tenantId，
 * 由 tenantGuarded 在同一事务内绑定 RLS 上下文。
 */
export interface GenericGameTemplateRepository {
  list(
    tenantId: string,
    query: GenericTemplateListQuery,
  ): Promise<GenericTemplateListPage>;
  createDraft(
    tenantId: string,
    actorId: string,
    input: CreateGenericTemplateInput,
  ): Promise<GenericTemplateDraftView>;
  getDraft(tenantId: string, id: string): Promise<GenericTemplateDraftView>;
  saveDraft(
    tenantId: string,
    actorId: string,
    id: string,
    input: SaveGenericTemplateDraftInput,
  ): Promise<SaveGenericTemplateDraftResult>;
  publish(
    tenantId: string,
    actorId: string,
    id: string,
    input: PublishGenericTemplateInput,
    buildPublishedConfig: (draft: unknown) => PublishedConfigV2,
  ): Promise<GenericTemplateDraftView>;
  listVersions(
    tenantId: string,
    templateId: string,
    query: GenericTemplateVersionsQuery,
  ): Promise<GenericTemplateVersionsPage>;
  restoreVersion(
    tenantId: string,
    actorId: string,
    id: string,
    input: RestoreGenericTemplateInput,
    buildDraftConfig: (versionConfig: unknown) => DraftConfigV2,
  ): Promise<GenericTemplateDraftView & { sourceVersionId: string }>;
  copyTemplate(
    tenantId: string,
    actorId: string,
    id: string,
    input: CopyGenericTemplateInput,
  ): Promise<GenericTemplateDraftView>;
  setDefault(
    tenantId: string,
    actorId: string,
    id: string,
    input: ExpectedRevisionInput,
  ): Promise<GenericTemplateDraftView>;
  archiveTemplate(
    tenantId: string,
    actorId: string,
    id: string,
    input: ExpectedRevisionInput,
  ): Promise<GenericTemplateDraftView>;
  unarchiveTemplate(
    tenantId: string,
    actorId: string,
    id: string,
    input: ExpectedRevisionInput,
  ): Promise<GenericTemplateDraftView>;
  deleteTemplate(
    tenantId: string,
    actorId: string,
    id: string,
    input: ExpectedRevisionInput,
  ): Promise<void>;
  listPublishedTemplates(
    tenantId: string,
    gameId: string,
  ): Promise<PublishedTemplateSummary[]>;
  findPublishedVersionForm(
    tenantId: string,
    versionId: string,
  ): Promise<PublishedTemplateForm | null>;
}

const DEFAULT_LIMIT = 30;
const DEFAULT_VERSION_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_REPORTED_ISSUES = 20;
const MAX_ISSUE_MESSAGE = 200;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const VALIDATION_MESSAGES: Record<TemplateConfigIssue["code"], string> = {
  TEMPLATE_COMPONENT_INVALID: "模板组件配置无效",
  TEMPLATE_BINDING_INVALID: "模板业务绑定无效",
  TEMPLATE_PRICE_RULE_INVALID: "模板价格规则无效",
  TEMPLATE_LEGACY_REVIEW_REQUIRED: "模板仍包含待人工确认的旧规则",
};

/** 只回传受限的 issue 摘要，不带完整 config、不暴露内部实现。 */
function validationFailed(issues: TemplateConfigIssue[]): GenericTemplateError {
  const code = issues[0]?.code ?? "TEMPLATE_COMPONENT_INVALID";
  return new GenericTemplateError(code, VALIDATION_MESSAGES[code], {
    issues: issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => ({
      code: issue.code,
      path: issue.path,
      ...(issue.componentKey === undefined
        ? {}
        : { componentKey: issue.componentKey }),
      message: issue.message.slice(0, MAX_ISSUE_MESSAGE),
    })),
  });
}

/** 观测用：安全取受控错误码（非受控错误不写入日志）。 */
function errorCodeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);
}

function clampVersionLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_VERSION_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 由服务端当前草稿生成候选发布配置：
 * 加入受支持的文案渲染器版本、剔除仅用于迁移兼容的 legacyCompatibility，
 * 并用发布校验（含未处理旧价格规则）决定是否允许发布。
 */
function buildPublishedConfig(draft: unknown): PublishedConfigV2 {
  if (!isRecord(draft) || draft.schemaVersion !== 2) {
    throw new GenericTemplateError(
      "TEMPLATE_VERSION_UNAVAILABLE",
      "模板没有可用的 v2 草稿，无法发布",
    );
  }
  const candidate: Record<string, unknown> = {
    ...draft,
    documentRendererVersion: 1,
  };
  const issues = validatePublishedConfigV2(candidate);
  if (issues.length > 0) throw validationFailed(issues);
  // 发布专属阻断项：值类内容必须留给能填写下单的端口（读取与历史版本不受影响）。
  const publishBlocking = collectPublishBlockingIssuesV2(candidate);
  if (publishBlocking.length > 0) throw validationFailed(publishBlocking);

  const published: Record<string, unknown> = { ...candidate };
  delete published.legacyCompatibility;
  return published as unknown as PublishedConfigV2;
}

/**
 * 由不可变发布版本还原可编辑草稿：去掉服务端专属的渲染器版本；
 * schemaVersion 1 的历史版本不支持还原（不猜测、不隐式转换）。
 */
function buildDraftFromVersion(versionConfig: unknown): DraftConfigV2 {
  if (!isRecord(versionConfig) || versionConfig.schemaVersion !== 2) {
    throw new GenericTemplateError(
      "TEMPLATE_VERSION_UNAVAILABLE",
      "只有 v2 发布版本可以还原为草稿",
      {
        schemaVersion: isRecord(versionConfig)
          ? versionConfig.schemaVersion
          : null,
      },
    );
  }
  const draft: Record<string, unknown> = { ...versionConfig };
  delete draft.documentRendererVersion;
  const issues = validateDraftConfigV2(draft);
  if (issues.length > 0) throw validationFailed(issues);
  return draft as unknown as DraftConfigV2;
}

/** 路径参数不是 UUID 时按“不存在”处理，避免把数据库类型错误暴露成 500。 */
function requireTemplateId(id: string): string {
  if (!UUID_PATTERN.test(id)) {
    throw new GenericTemplateError("TEMPLATE_NOT_FOUND", "模板不存在", {
      templateId: id,
    });
  }
  return id;
}

/** 版本 id 同样先做形状校验，非法值按“版本不可用”返回 422。 */ function requireVersionId(
  id: string,
): string {
  if (!UUID_PATTERN.test(id)) {
    throw new GenericTemplateError(
      "TEMPLATE_VERSION_UNAVAILABLE",
      "发布版本不存在、不属于该模板或不受支持",
      { versionId: id },
    );
  }
  return id;
}

export class GenericGameTemplateService {
  constructor(private readonly repository: GenericGameTemplateRepository) {}

  async list(
    tenantId: string,
    query: GenericTemplateListQuery,
  ): Promise<GenericTemplateListPage> {
    // 游标必须与排序绑定；解码失败在进入数据库前就返回受控 400。
    if (query.cursor !== undefined) {
      decodeTemplateCursor(query.cursor, query.sort);
    }
    return withTemplateTiming(TEMPLATE_EVENTS.LIST, { tenantId }, () =>
      this.repository.list(tenantId, {
        ...query,
        limit: clampLimit(query.limit),
      }),
    );
  }

  async createDraft(
    tenantId: string,
    actorId: string,
    input: CreateGenericTemplateInput,
  ): Promise<GenericTemplateDraftView> {
    return this.repository.createDraft(tenantId, actorId, input);
  }

  async getDraft(
    tenantId: string,
    id: string,
  ): Promise<GenericTemplateDraftView> {
    return this.repository.getDraft(tenantId, requireTemplateId(id));
  }

  async saveDraft(
    tenantId: string,
    actorId: string,
    id: string,
    input: SaveGenericTemplateDraftInput,
  ): Promise<SaveGenericTemplateDraftResult> {
    // 先做纯领域校验，再锁行核对 revision；失败时数据库零写入。
    const issues = validateDraftConfigV2(input.config);
    if (issues.length > 0) {
      emitTemplateEvent(TEMPLATE_EVENTS.VALIDATION_ISSUE, {
        tenantId,
        actorId,
        templateId: id,
        issueCode: issues[0]?.code,
        outcome: "failed",
      });
      throw validationFailed(issues);
    }
    try {
      return await this.repository.saveDraft(
        tenantId,
        actorId,
        requireTemplateId(id),
        input,
      );
    } catch (error) {
      const code = errorCodeOf(error);
      emitTemplateEvent(TEMPLATE_EVENTS.DRAFT_SAVE_FAILED, {
        tenantId,
        actorId,
        templateId: id,
        code,
        outcome: "failed",
      });
      if (code === "TEMPLATE_REVISION_CONFLICT") {
        emitTemplateEvent(TEMPLATE_EVENTS.REVISION_CONFLICT, {
          tenantId,
          actorId,
          templateId: id,
          code,
          outcome: "failed",
        });
      }
      throw error;
    }
  }

  async publish(
    tenantId: string,
    actorId: string,
    id: string,
    input: PublishGenericTemplateInput,
  ): Promise<GenericTemplateDraftView> {
    // 行锁在 repository 内获取；发布配置只由服务端当前草稿生成。
    try {
      return await this.repository.publish(
        tenantId,
        actorId,
        requireTemplateId(id),
        input,
        buildPublishedConfig,
      );
    } catch (error) {
      const code = errorCodeOf(error);
      emitTemplateEvent(TEMPLATE_EVENTS.PUBLISH_FAILED, {
        tenantId,
        actorId,
        templateId: id,
        code,
        outcome: "failed",
      });
      if (code === "TEMPLATE_VERSION_UNAVAILABLE") {
        emitTemplateEvent(TEMPLATE_EVENTS.VERSION_MISMATCH, {
          tenantId,
          templateId: id,
          code,
          outcome: "failed",
        });
      }
      throw error;
    }
  }

  async listVersions(
    tenantId: string,
    id: string,
    query: GenericTemplateVersionsQuery,
  ): Promise<GenericTemplateVersionsPage> {
    return this.repository.listVersions(tenantId, requireTemplateId(id), {
      ...query,
      limit: clampVersionLimit(query.limit),
    });
  }

  async restoreVersion(
    tenantId: string,
    actorId: string,
    id: string,
    input: RestoreGenericTemplateInput,
  ): Promise<GenericTemplateDraftView & { sourceVersionId: string }> {
    try {
      return await this.repository.restoreVersion(
        tenantId,
        actorId,
        requireTemplateId(id),
        input,
        buildDraftFromVersion,
      );
    } catch (error) {
      const code = errorCodeOf(error);
      if (code === "TEMPLATE_VERSION_UNAVAILABLE") {
        emitTemplateEvent(TEMPLATE_EVENTS.VERSION_MISMATCH, {
          tenantId,
          actorId,
          templateId: id,
          versionId: input.versionId,
          code,
          outcome: "failed",
        });
      }
      throw error;
    }
  }

  async copyTemplate(
    tenantId: string,
    actorId: string,
    id: string,
    input: CopyGenericTemplateInput,
  ): Promise<GenericTemplateDraftView> {
    return this.repository.copyTemplate(
      tenantId,
      actorId,
      requireTemplateId(id),
      input,
    );
  }

  async setDefault(
    tenantId: string,
    actorId: string,
    id: string,
    input: ExpectedRevisionInput,
  ): Promise<GenericTemplateDraftView> {
    return this.repository.setDefault(
      tenantId,
      actorId,
      requireTemplateId(id),
      input,
    );
  }

  async archiveTemplate(
    tenantId: string,
    actorId: string,
    id: string,
    input: ExpectedRevisionInput,
  ): Promise<GenericTemplateDraftView> {
    return this.repository.archiveTemplate(
      tenantId,
      actorId,
      requireTemplateId(id),
      input,
    );
  }

  async unarchiveTemplate(
    tenantId: string,
    actorId: string,
    id: string,
    input: ExpectedRevisionInput,
  ): Promise<GenericTemplateDraftView> {
    return this.repository.unarchiveTemplate(
      tenantId,
      actorId,
      requireTemplateId(id),
      input,
    );
  }

  async deleteTemplate(
    tenantId: string,
    actorId: string,
    id: string,
    input: ExpectedRevisionInput,
  ): Promise<void> {
    await this.repository.deleteTemplate(
      tenantId,
      actorId,
      requireTemplateId(id),
      input,
    );
  }

  /** 该游戏可派单的模板摘要（默认优先、最近使用其次），不含 config。 */
  async listPublished(
    tenantId: string,
    gameId: string,
  ): Promise<PublishedTemplateSummary[]> {
    return this.repository.listPublishedTemplates(tenantId, gameId);
  }

  /** 读取锁定版本的发布表单；不存在或配置不可用时 422 TEMPLATE_VERSION_UNAVAILABLE。 */
  async getVersionForm(
    tenantId: string,
    versionId: string,
    audience: TemplateAudienceV2,
  ): Promise<PublishedTemplateForm> {
    const form = await this.repository.findPublishedVersionForm(
      tenantId,
      requireVersionId(versionId),
    );
    if (form === null) {
      throw new GenericTemplateError(
        "TEMPLATE_VERSION_UNAVAILABLE",
        "发布版本不存在、不属于该模板或不受支持",
        { versionId },
      );
    }
    // 按**入口**的端口过滤（V-5 / V-6 / C-9：过滤权威在服务端，端口不由客户端声明）。
    return { ...form, config: visibleConfigV2(form.config, audience) };
  }
}

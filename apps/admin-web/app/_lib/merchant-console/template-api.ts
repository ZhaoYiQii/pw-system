/**
 * S2 通用模板管理 API 的客户端封装（S3 模板管理界面的唯一数据入口）。
 *
 * 约定：
 * - 只依赖生成客户端（packages/api-client），不手写 URL、不手写响应类型；
 * - OpenAPI 未给这些 operation 声明 security，因此 Authorization 必须在这里注入；
 * - 所有失败统一转成 TemplateApiError，界面按 code 分支（409 冲突 / 422 校验 / 404 不存在…）；
 * - 列表与版本历史直接返回 `{ data, page }` 信封；单对象接口解开 `{ data }`。
 */
import {
  genericGameTemplateArchive,
  genericGameTemplateCopy,
  genericGameTemplateCreate,
  genericGameTemplateGetDraft,
  genericGameTemplateList,
  genericGameTemplateListVersions,
  genericGameTemplatePublish,
  genericGameTemplateRemove,
  genericGameTemplateRestore,
  genericGameTemplateSaveDraft,
  genericGameTemplateSetDefault,
  genericGameTemplateUnarchive,
} from "@pw/api-client";
import type {
  GenericGameTemplateArchiveResponses,
  GenericGameTemplateCopyData,
  GenericGameTemplateCopyResponses,
  GenericGameTemplateCreateData,
  GenericGameTemplateCreateResponses,
  GenericGameTemplateGetDraftResponses,
  GenericGameTemplateListData,
  GenericGameTemplateListResponses,
  GenericGameTemplateListVersionsData,
  GenericGameTemplateListVersionsResponses,
  GenericGameTemplatePublishData,
  GenericGameTemplatePublishResponses,
  GenericGameTemplateRemoveData,
  GenericGameTemplateRemoveResponses,
  GenericGameTemplateRestoreData,
  GenericGameTemplateRestoreResponses,
  GenericGameTemplateSaveDraftData,
  GenericGameTemplateSaveDraftResponses,
  GenericGameTemplateSetDefaultResponses,
  GenericGameTemplateUnarchiveResponses,
} from "@pw/api-client";
import { client } from "@pw/api-client/client";
import { getAccessToken } from "../api";

/* ------------------------------------------------------------------ 类型 */

export type TemplateSort =
  "UPDATED_DESC" | "UPDATED_ASC" | "NAME_ASC" | "LAST_USED_DESC";

export type TemplateStatusFilter =
  "DRAFT" | "PUBLISHED" | "UNPUBLISHED_CHANGES" | "ARCHIVED";

/** 可写草稿配置：直接复用契约生成的类型，避免镜像漂移。 */
export type TemplateDraftConfig =
  GenericGameTemplateSaveDraftData["body"]["config"];

export type TemplateListPage = GenericGameTemplateListResponses[200];
export type TemplateDraftView =
  GenericGameTemplateGetDraftResponses[200]["data"];
export type TemplateSaveResult =
  GenericGameTemplateSaveDraftResponses[200]["data"];
export type TemplateVersionPage = GenericGameTemplateListVersionsResponses[200];
export type TemplateRestoreResult =
  GenericGameTemplateRestoreResponses[201]["data"];
export type TemplateCreatedView =
  GenericGameTemplateCreateResponses[201]["data"];
export type TemplateCopiedView = GenericGameTemplateCopyResponses[201]["data"];
export type TemplatePublishedView =
  GenericGameTemplatePublishResponses[201]["data"];
export type TemplateDefaultView =
  GenericGameTemplateSetDefaultResponses[201]["data"];
export type TemplateArchivedView =
  GenericGameTemplateArchiveResponses[201]["data"];
export type TemplateUnarchivedView =
  GenericGameTemplateUnarchiveResponses[201]["data"];
export type TemplateDeleteResult =
  GenericGameTemplateRemoveResponses[200]["data"];

export interface TemplateListQuery {
  gameId?: string;
  status?: TemplateStatusFilter;
  q?: string;
  sort?: TemplateSort;
  cursor?: string;
  limit?: number;
}

export interface TemplateVersionsQuery {
  cursor?: string;
  limit?: number;
}

export interface TemplateIssue {
  code?: string;
  path?: string;
  componentKey?: string;
  message?: string;
}

export type TemplateErrorCode =
  | "TEMPLATE_CURSOR_INVALID"
  | "TEMPLATE_NOT_FOUND"
  | "TEMPLATE_REVISION_CONFLICT"
  | "TEMPLATE_ARCHIVED"
  | "TEMPLATE_NAME_CONFLICT"
  | "TEMPLATE_DELETE_RESTRICTED"
  | "TEMPLATE_VERSION_UNAVAILABLE"
  | "TEMPLATE_COMPONENT_INVALID"
  | "TEMPLATE_BINDING_INVALID"
  | "TEMPLATE_PRICE_RULE_INVALID"
  | "TEMPLATE_LEGACY_REVIEW_REQUIRED";

const TEMPLATE_ERROR_CODES: readonly string[] = [
  "TEMPLATE_CURSOR_INVALID",
  "TEMPLATE_NOT_FOUND",
  "TEMPLATE_REVISION_CONFLICT",
  "TEMPLATE_ARCHIVED",
  "TEMPLATE_NAME_CONFLICT",
  "TEMPLATE_DELETE_RESTRICTED",
  "TEMPLATE_VERSION_UNAVAILABLE",
  "TEMPLATE_COMPONENT_INVALID",
  "TEMPLATE_BINDING_INVALID",
  "TEMPLATE_PRICE_RULE_INVALID",
  "TEMPLATE_LEGACY_REVIEW_REQUIRED",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 受控 API 错误：界面按 code 分支，不解析 message 文本。 */
export class TemplateApiError extends Error {
  readonly code: TemplateErrorCode | "UNKNOWN";
  readonly status: number | undefined;
  readonly details: unknown;

  constructor(
    code: TemplateErrorCode | "UNKNOWN",
    message: string,
    status: number | undefined,
    details: unknown,
  ) {
    super(message);
    this.name = "TemplateApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /** 422/400 的 details.issues（界面据此定位到区块与席位）。 */
  issueList(): TemplateIssue[] {
    if (!isRecord(this.details)) return [];
    const issues = this.details.issues;
    if (!Array.isArray(issues)) return [];
    return issues.filter(isRecord).map((issue) => ({
      ...(typeof issue.code === "string" ? { code: issue.code } : {}),
      ...(typeof issue.path === "string" ? { path: issue.path } : {}),
      ...(typeof issue.componentKey === "string"
        ? { componentKey: issue.componentKey }
        : {}),
      ...(typeof issue.message === "string" ? { message: issue.message } : {}),
    }));
  }
}

/** 把任意抛出物转成受控错误；未知错误回退 UNKNOWN 并保留原始 message。 */
export function toTemplateApiError(error: unknown): TemplateApiError {
  if (error instanceof TemplateApiError) return error;
  if (isRecord(error)) {
    const rawCode = typeof error.code === "string" ? error.code : "";
    const code = TEMPLATE_ERROR_CODES.includes(rawCode)
      ? (rawCode as TemplateErrorCode)
      : "UNKNOWN";
    const message =
      typeof error.message === "string" && error.message.length > 0
        ? error.message
        : "请求失败";
    const status =
      typeof error.status === "number"
        ? error.status
        : typeof error.statusCode === "number"
          ? error.statusCode
          : undefined;
    return new TemplateApiError(code, message, status, error.details);
  }
  if (typeof error === "string")
    return new TemplateApiError("UNKNOWN", error, undefined, undefined);
  if (error instanceof Error)
    return new TemplateApiError("UNKNOWN", error.message, undefined, undefined);
  return new TemplateApiError("UNKNOWN", "请求失败", undefined, undefined);
}

/* ------------------------------------------------------------------ 装配 */

export interface TemplateClientConfig {
  /** API 源（NEXT_PUBLIC_API_ORIGIN）。 */
  origin: string;
  /** 每次请求实时读取 token，避免会话刷新后仍带旧 token。 */
  getToken: () => string | null;
  /** 仅测试注入；生产使用全局 fetch。 */
  fetch?: typeof fetch;
}

let currentConfig: TemplateClientConfig | null = null;

/**
 * 配置生成客户端：baseUrl + 动态 Authorization。
 * 可重复调用（会先清空旧拦截器），便于测试与运行时切换。
 */
export function configureTemplateClient(config: TemplateClientConfig): void {
  currentConfig = config;
  client.interceptors.request.clear();
  client.setConfig({
    baseUrl: config.origin.replace(/\/+$/, ""),
    throwOnError: true,
    responseStyle: "fields",
    ...(config.fetch ? { fetch: config.fetch } : {}),
  });
  client.interceptors.request.use((request) => {
    const token = currentConfig?.getToken() ?? null;
    if (token) request.headers.set("authorization", `Bearer ${token}`);
    else request.headers.delete("authorization");
    return request;
  });
}

/** API 兜底源，与 api.ts 保持一致（未配置 NEXT_PUBLIC_API_ORIGIN 时使用）。 */
const FALLBACK_API_ORIGIN = "http://127.0.0.1:3000";

/**
 * 模块加载即装配一次（本 S3 计划 Task 1 的装配点）。
 *
 * 生成单例默认没有 baseUrl，相对路径会打到 admin 自身 origin 并返回 404，
 * 且默认不带 Authorization；因此请求前必须完成装配。
 * 测试可再次调用 configureTemplateClient 覆盖（注入 fetch / 切换 origin）。
 */
configureTemplateClient({
  origin: process.env.NEXT_PUBLIC_API_ORIGIN ?? FALLBACK_API_ORIGIN,
  getToken: getAccessToken,
});

function toListQuery(
  query: TemplateListQuery,
): NonNullable<GenericGameTemplateListData["query"]> {
  return {
    ...(query.gameId ? { gameId: query.gameId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.q ? { q: query.q } : {}),
    ...(query.cursor ? { cursor: query.cursor } : {}),
    sort: query.sort ?? "UPDATED_DESC",
    limit: String(query.limit ?? 30),
  };
}

function toVersionsQuery(
  query: TemplateVersionsQuery,
): NonNullable<GenericGameTemplateListVersionsData["query"]> {
  return {
    ...(query.cursor ? { cursor: query.cursor } : {}),
    limit: String(query.limit ?? 20),
  };
}

/* ------------------------------------------------------- 模板摘要与草稿 */

export async function fetchTemplateList(
  query: TemplateListQuery = {},
): Promise<TemplateListPage> {
  try {
    const result = await genericGameTemplateList({
      query: toListQuery(query),
      throwOnError: true,
    });
    // openapi-ts 的返回类型是所有响应体的联合；throwOnError 下运行时只会是成功响应。
    return result.data as TemplateListPage;
  } catch (error) {
    throw toTemplateApiError(error);
  }
}

export async function createTemplate(input: {
  gameId: string;
  name: string;
  description?: string | null;
}): Promise<TemplateCreatedView> {
  const body: GenericGameTemplateCreateData["body"] = {
    gameId: input.gameId,
    name: input.name,
    description: input.description ?? null,
  };
  try {
    const result = await genericGameTemplateCreate({
      body,
      throwOnError: true,
    });
    return (result.data as GenericGameTemplateCreateResponses[201]).data;
  } catch (error) {
    throw toTemplateApiError(error);
  }
}

export async function fetchTemplateDraft(
  id: string,
): Promise<TemplateDraftView> {
  try {
    const result = await genericGameTemplateGetDraft({
      path: { id },
      throwOnError: true,
    });
    return (result.data as GenericGameTemplateGetDraftResponses[200]).data;
  } catch (error) {
    throw toTemplateApiError(error);
  }
}

export async function saveTemplateDraft(
  id: string,
  input: { expectedRevision: number; config: TemplateDraftConfig },
): Promise<TemplateSaveResult> {
  const body: GenericGameTemplateSaveDraftData["body"] = {
    expectedRevision: input.expectedRevision,
    config: input.config,
  };
  try {
    const result = await genericGameTemplateSaveDraft({
      path: { id },
      body,
      throwOnError: true,
    });
    return (result.data as GenericGameTemplateSaveDraftResponses[200]).data;
  } catch (error) {
    throw toTemplateApiError(error);
  }
}

/* --------------------------------------------------- 发布、版本与生命周期 */

export async function publishTemplate(
  id: string,
  input: {
    expectedRevision: number;
    changeNote?: string | null;
    sourceVersionId?: string | null;
  },
): Promise<TemplatePublishedView> {
  // 只发送调用方明确提供的字段：契约里 changeNote/sourceVersionId 都是可选的。
  const body: GenericGameTemplatePublishData["body"] = {
    expectedRevision: input.expectedRevision,
    ...(input.changeNote === undefined ? {} : { changeNote: input.changeNote }),
    ...(input.sourceVersionId === undefined
      ? {}
      : { sourceVersionId: input.sourceVersionId }),
  };
  try {
    const result = await genericGameTemplatePublish({
      path: { id },
      body,
      throwOnError: true,
    });
    return (result.data as GenericGameTemplatePublishResponses[201]).data;
  } catch (error) {
    throw toTemplateApiError(error);
  }
}

export async function fetchTemplateVersions(
  id: string,
  query: TemplateVersionsQuery = {},
): Promise<TemplateVersionPage> {
  try {
    const result = await genericGameTemplateListVersions({
      path: { id },
      query: toVersionsQuery(query),
      throwOnError: true,
    });
    return result.data as TemplateVersionPage;
  } catch (error) {
    throw toTemplateApiError(error);
  }
}

export async function restoreTemplate(
  id: string,
  input: { versionId: string; expectedRevision: number },
): Promise<TemplateRestoreResult> {
  const body: GenericGameTemplateRestoreData["body"] = {
    versionId: input.versionId,
    expectedRevision: input.expectedRevision,
  };
  try {
    const result = await genericGameTemplateRestore({
      path: { id },
      body,
      throwOnError: true,
    });
    return (result.data as GenericGameTemplateRestoreResponses[201]).data;
  } catch (error) {
    throw toTemplateApiError(error);
  }
}

export async function copyTemplate(
  id: string,
  input: { targetGameId: string; newName: string },
): Promise<TemplateCopiedView> {
  const body: GenericGameTemplateCopyData["body"] = {
    targetGameId: input.targetGameId,
    newName: input.newName,
  };
  try {
    const result = await genericGameTemplateCopy({
      path: { id },
      body,
      throwOnError: true,
    });
    return (result.data as GenericGameTemplateCopyResponses[201]).data;
  } catch (error) {
    throw toTemplateApiError(error);
  }
}

async function runRevisionAction(
  action: (args: {
    path: { id: string };
    body: { expectedRevision: number };
    throwOnError: true;
  }) => Promise<{ data: unknown }>,
  id: string,
  expectedRevision: number,
): Promise<unknown> {
  try {
    const result = await action({
      path: { id },
      body: { expectedRevision },
      throwOnError: true,
    });
    const body = result.data as { data: unknown };
    return body.data;
  } catch (error) {
    throw toTemplateApiError(error);
  }
}

export async function setDefaultTemplate(
  id: string,
  expectedRevision: number,
): Promise<TemplateDefaultView> {
  return (await runRevisionAction(
    genericGameTemplateSetDefault as never,
    id,
    expectedRevision,
  )) as TemplateDefaultView;
}

export async function archiveTemplate(
  id: string,
  expectedRevision: number,
): Promise<TemplateArchivedView> {
  return (await runRevisionAction(
    genericGameTemplateArchive as never,
    id,
    expectedRevision,
  )) as TemplateArchivedView;
}

export async function unarchiveTemplate(
  id: string,
  expectedRevision: number,
): Promise<TemplateUnarchivedView> {
  return (await runRevisionAction(
    genericGameTemplateUnarchive as never,
    id,
    expectedRevision,
  )) as TemplateUnarchivedView;
}

export async function deleteTemplate(
  id: string,
  expectedRevision: number,
): Promise<TemplateDeleteResult> {
  const query: GenericGameTemplateRemoveData["query"] = {
    expectedRevision: String(expectedRevision),
  };
  try {
    const result = await genericGameTemplateRemove({
      path: { id },
      query,
      throwOnError: true,
    });
    return (result.data as GenericGameTemplateRemoveResponses[200]).data;
  } catch (error) {
    throw toTemplateApiError(error);
  }
}

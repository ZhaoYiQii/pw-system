/**
 * S4「新建派单」弹窗的 API 封装（唯一数据入口）。
 *
 * 约定与 S3 的 template-api 一致：
 * - 只依赖生成客户端，不手写 URL、不手写响应类型；
 * - 复用 configureTemplateClient 的装配（baseUrl + 动态 Authorization）；
 * - 所有失败统一转成 TemplateApiError，界面按 code 分支。
 */
import {
  gameDispatchTemplateOrderCreate,
  genericGameTemplateGetVersionForm,
  genericGameTemplateListPublished,
} from "@pw/api-client";
import type {
  GameDispatchTemplateOrderCreateData,
  GameDispatchTemplateOrderCreateResponses,
  GenericGameTemplateGetVersionFormResponses,
  GenericGameTemplateListPublishedResponses,
} from "@pw/api-client";
import { toTemplateApiError } from "./template-api";

/** 该游戏可派单的模板摘要（published 列表元素）。 */
export type PublishedTemplateOption =
  GenericGameTemplateListPublishedResponses[200]["data"][number];
/** 锁定版本的发布表单。 */
export type PublishedVersionForm =
  GenericGameTemplateGetVersionFormResponses[200]["data"];
/** 创建派单结果（含服务端计算与自动文案）。 */
export type CreatedTemplateOrder =
  GameDispatchTemplateOrderCreateResponses[201]["data"];

export interface TemplateOrderRequest {
  gameId: string;
  templateId: string;
  templateVersionId: string;
  customerProfileId: string;
  values: Record<string, unknown>;
  durationMinutes?: number;
  desiredStartAt?: string | null;
}

/** 该游戏未归档且有生效版本的模板（默认优先，其次最近使用）。 */
export async function fetchPublishedTemplates(
  gameId: string,
): Promise<PublishedTemplateOption[]> {
  try {
    const result = await genericGameTemplateListPublished({
      query: { gameId },
      throwOnError: true,
    });
    return (result.data as GenericGameTemplateListPublishedResponses[200]).data;
  } catch (error) {
    throw toTemplateApiError(error);
  }
}

/** 读取锁定发布版本的派单表单（配置来自该版本快照）。 */
export async function fetchPublishedVersionForm(
  versionId: string,
): Promise<PublishedVersionForm> {
  try {
    const result = await genericGameTemplateGetVersionForm({
      path: { versionId },
      throwOnError: true,
    });
    return (result.data as GenericGameTemplateGetVersionFormResponses[200])
      .data;
  } catch (error) {
    throw toTemplateApiError(error);
  }
}

/** 创建派单：幂等键来自调用方的「一次意图」，服务端据此回放或拒绝。 */
export async function createTemplateOrder(
  input: TemplateOrderRequest,
  idempotencyKey: string,
): Promise<CreatedTemplateOrder> {
  const body: GameDispatchTemplateOrderCreateData["body"] = {
    gameId: input.gameId,
    templateId: input.templateId,
    templateVersionId: input.templateVersionId,
    customerProfileId: input.customerProfileId,
    values: input.values,
    ...(input.desiredStartAt === undefined
      ? {}
      : { desiredStartAt: input.desiredStartAt }),
    ...(input.durationMinutes === undefined
      ? {}
      : { durationMinutes: input.durationMinutes }),
  };
  try {
    const result = await gameDispatchTemplateOrderCreate({
      body,
      headers: { "idempotency-key": idempotencyKey },
      throwOnError: true,
    });
    return (result.data as GameDispatchTemplateOrderCreateResponses[201]).data;
  } catch (error) {
    throw toTemplateApiError(error);
  }
}

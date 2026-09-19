/**
 * S4「新建派单」弹窗的纯逻辑（新建派单三阶段 + 幂等意图）。
 *
 * 设计边界（设计规格 §10 / §11.2）：
 * - 阶段由已选项**派生**，不额外存 stage，避免状态漂移；
 * - 切换游戏清空模板与值；切换模板由调用方先确认，再用会话缓存恢复；
 * - 幂等键按「一次创建意图」生成：同一请求体复用，请求体变化或成功/重置后换新键；
 * - 值收集与校验只做即时提示，服务端仍是唯一事实源（人数与价格由服务端计算）。
 *
 * 本模块不依赖 React、DOM 与网络，便于直接单测。
 */
import type {
  DraftConfigV2,
  DraftFieldComponentV2,
} from "./template-draft-state";

/** 弹窗里可选的一个「已发布模板」选项（来自 published 列表接口）。 */
export interface NewOrderTemplateOption {
  templateId: string;
  name: string;
  /** 契约里 description 可选，缺失时按无说明渲染。 */
  description?: string | null;
  versionId: string;
  versionNo: number;
  isDefault: boolean;
  lastUsedAt: string | null;
}

export type NewOrderStage = "PARTY" | "TEMPLATE" | "FORM";

export interface NewOrderIntent {
  key: string;
  signature: string;
}

export interface NewOrderState {
  customerId: string;
  gameId: string;
  template: NewOrderTemplateOption | null;
  values: Record<string, unknown>;
  durationMinutes: number;
  desiredStartAt: string | null;
  intent: NewOrderIntent | null;
}

export interface CreateOrderRequest {
  gameId: string;
  templateId: string;
  templateVersionId: string;
  customerProfileId: string;
  values: Record<string, unknown>;
  durationMinutes: number;
  desiredStartAt: string | null;
}

export type CreateErrorAction =
  "RESELECT_TEMPLATE" | "RELOAD_FORM" | "RESET_INTENT" | "NONE";

export interface CreateErrorHint {
  message: string;
  /** 所有失败都保留用户输入；这里显式表达，避免调用方各自猜测。 */
  keepValues: true;
  action: CreateErrorAction;
}

export const DEFAULT_ORDER_DURATION_MINUTES = 60;

/** 流程前置条件不满足时的受控错误（界面直接显示 message）。 */
export class NewOrderFlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NewOrderFlowError";
  }
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function initialNewOrderState(): NewOrderState {
  return {
    customerId: "",
    gameId: "",
    template: null,
    values: {},
    durationMinutes: DEFAULT_ORDER_DURATION_MINUTES,
    desiredStartAt: null,
    intent: null,
  };
}

/** 阶段由已选项派生，不存 stage。 */
export function newOrderStage(state: NewOrderState): NewOrderStage {
  if (!hasValue(state.customerId) || !hasValue(state.gameId)) return "PARTY";
  return state.template === null ? "TEMPLATE" : "FORM";
}

export function selectCustomer(
  state: NewOrderState,
  customerId: string,
): NewOrderState {
  if (customerId === state.customerId) return state;
  return { ...state, customerId, intent: null };
}

/** 切换游戏：模板与值都不再适用，一律清空（缓存由调用方按会话保存）。 */
export function selectGame(
  state: NewOrderState,
  gameId: string,
): NewOrderState {
  if (gameId === state.gameId) return state;
  return {
    ...state,
    gameId,
    template: null,
    values: {},
    desiredStartAt: null,
    intent: null,
  };
}

export function hasEnteredValues(state: NewOrderState): boolean {
  return Object.values(state.values).some(hasValue);
}

/** 已有输入且换了另一个模板时才需要确认；重复选同一个模板不算切换。 */
export function needsTemplateSwitchConfirm(
  state: NewOrderState,
  nextTemplateId: string,
): boolean {
  return (
    state.template !== null &&
    state.template.templateId !== nextTemplateId &&
    hasEnteredValues(state)
  );
}

export function selectTemplate(
  state: NewOrderState,
  template: NewOrderTemplateOption,
  cachedValues?: Record<string, unknown>,
): NewOrderState {
  return {
    ...state,
    template,
    values: cachedValues ? { ...cachedValues } : {},
    intent: null,
  };
}

export function updateValue(
  state: NewOrderState,
  stableKey: string,
  value: unknown,
): NewOrderState {
  return {
    ...state,
    values: { ...state.values, [stableKey]: value },
    intent: null,
  };
}

/**
 * 输入框文本 → 提交值：只有 NUMBER 需要转成数字——
 * 服务端对数字字段（文案渲染）与人数来源（NUMBER_FIELD）都要求 JS number，
 * 传字符串会 422；MONEY_FEN 必须是规范整数分字符串，其余字段保持文本原样。
 * 非法数字保留原文，让服务端给出受控错误，用户也能看到自己填了什么。
 */
export function coerceFieldValue(
  fieldType: DraftFieldComponentV2["fieldType"],
  text: string,
): unknown {
  if (fieldType !== "NUMBER") return text;
  const trimmed = text.trim();
  if (trimmed === "") return "";
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : text;
}

export function setDurationMinutes(
  state: NewOrderState,
  durationMinutes: number,
): NewOrderState {
  return { ...state, durationMinutes, intent: null };
}

export function setDesiredStartAt(
  state: NewOrderState,
  desiredStartAt: string | null,
): NewOrderState {
  return { ...state, desiredStartAt, intent: null };
}

export function resetIntent(state: NewOrderState): NewOrderState {
  return { ...state, intent: null };
}

/** 只收集启用区块内启用组件的必填项，供即时提示（服务端仍会再校验）。 */
export function missingRequiredKeys(
  config: DraftConfigV2,
  values: Record<string, unknown>,
): string[] {
  const activeSectionKeys = new Set(
    config.sections
      .filter((section) => section.enabled)
      .map((section) => section.stableKey),
  );
  return config.components
    .filter(
      (component) =>
        component.enabled &&
        activeSectionKeys.has(component.sectionKey) &&
        component.kind === "FIELD" &&
        component.required,
    )
    .map((component) => component.stableKey)
    .filter((stableKey) => !hasValue(values[stableKey]));
}

/** 构造创建请求；归属不齐时抛受控错误，绝不提交半成品。 */
export function buildCreateOrderRequest(
  state: NewOrderState,
): CreateOrderRequest {
  if (!hasValue(state.customerId))
    throw new NewOrderFlowError("请先选择老板客户");
  if (!hasValue(state.gameId)) throw new NewOrderFlowError("请先选择游戏");
  if (state.template === null)
    throw new NewOrderFlowError("请先选择该游戏的已发布模板");
  return {
    gameId: state.gameId,
    templateId: state.template.templateId,
    templateVersionId: state.template.versionId,
    customerProfileId: state.customerId,
    values: { ...state.values },
    durationMinutes: state.durationMinutes,
    desiredStartAt: state.desiredStartAt,
  };
}

/**
 * 一次创建意图的幂等键：请求体签名不变则复用，变化则换新键。
 * 请求体不完整时抛错——不存在「无效意图」的键。
 */
export function intentFor(
  state: NewOrderState,
  createKey: () => string,
): NewOrderIntent {
  const signature = stableStringify(buildCreateOrderRequest(state));
  if (state.intent !== null && state.intent.signature === signature) {
    return state.intent;
  }
  return { key: createKey(), signature };
}

/** 服务端错误码 → 界面文案与下一步动作；所有分支都保留用户输入。 */
export function describeCreateError(code: string): CreateErrorHint {
  switch (code) {
    case "TEMPLATE_ARCHIVED":
      return {
        message: "该模板已被归档，请重新选择可用模板（已填写的内容仍保留）。",
        keepValues: true,
        action: "RESELECT_TEMPLATE",
      };
    case "TEMPLATE_VERSION_UNAVAILABLE":
      return {
        message: "模板版本已不可用，请重新加载表单（已填写的内容仍保留）。",
        keepValues: true,
        action: "RELOAD_FORM",
      };
    case "TEMPLATE_IDEMPOTENCY_MISMATCH":
    case "TEMPLATE_IDEMPOTENCY_REQUIRED":
      return {
        message: "同一次提交的参数发生变化，已重新生成提交标识，请重试。",
        keepValues: true,
        action: "RESET_INTENT",
      };
    case "TEMPLATE_IDEMPOTENCY_IN_FLIGHT":
      return {
        message: "同一请求正在处理中，请稍后重试（已填写的内容仍保留）。",
        keepValues: true,
        action: "NONE",
      };
    case "TEMPLATE_COMPONENT_INVALID":
    case "TEMPLATE_BINDING_INVALID":
    case "TEMPLATE_PRICE_RULE_INVALID":
      return {
        message: "提交内容未通过服务端校验，请检查表单（已填写的内容仍保留）。",
        keepValues: true,
        action: "NONE",
      };
    default:
      return {
        message: "创建派单失败，请稍后重试（已填写的内容仍保留）。",
        keepValues: true,
        action: "NONE",
      };
  }
}

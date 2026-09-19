/**
 * 「业务绑定与计算」标签的领域逻辑（S3 Task 4）。
 *
 * 原则：
 * - 业务关系只用 stableKey，显示名与 fieldKey 都不参与绑定；
 * - 人数来源候选必须与发布校验（后端 validateDraftConfigV2）一致：
 *   只允许"启用区块中的启用组件"，且表格列必须是 STAFFING_COUNT 的数字列；
 * - 金额一律十进制字符串分；元只用于展示与输入换算（沿用 _lib/money.ts，不另立口径）；
 * - 这里做即时校验（界面反馈），服务端仍是唯一权威。
 */
import { fenToYuanText, yuanToFenString } from "../money";
import { WRITABLE_AUDIENCES } from "./template-draft-state";
import {
  billingComponentsOutsideEveryAudience,
  valueComponentsOutsideAudiences,
} from "./template-draft-state";
import type {
  DraftConfigV2,
  DraftFieldComponentV2,
  DraftStaffingSourceV2,
} from "./template-draft-state";

const DECIMAL_FEN = /^(?:0|[1-9][0-9]*)$/;

export type DraftIssueCode =
  | "TEMPLATE_BINDING_INVALID"
  | "TEMPLATE_COMPONENT_INVALID"
  | "TEMPLATE_PRICE_RULE_INVALID"
  | "TEMPLATE_LEGACY_REVIEW_REQUIRED"
  | "TEMPLATE_VERSION_UNAVAILABLE";

export interface DraftIssue {
  code: DraftIssueCode;
  path: string;
  componentKey?: string;
  message: string;
}

export interface LocatedIssue {
  code: string;
  tab: "content" | "binding";
  sectionKey?: string;
  componentKey?: string;
  message: string;
}

export interface StaffingCandidate {
  kind: "NUMBER_FIELD" | "REPEATABLE_TABLE_SUM";
  componentKey: string;
  /** 面向店长的可读名称（例如「位置与人数 · 人数」）。 */
  label: string;
  /** 展示用的稳定键，不参与绑定。 */
  stableKeyLabel: string;
  columnKey?: string;
}

export type BindingResult =
  { ok: true; config: DraftConfigV2 } | { ok: false; reason: string };

interface CandidateInputIssue {
  code: string;
  path: string;
  componentKey?: string;
  message: string;
}

function activeSectionKeys(config: DraftConfigV2): Set<string> {
  return new Set(
    config.sections
      .filter((section) => section.enabled)
      .map((section) => section.stableKey),
  );
}

/** 可作人数来源的候选：启用区块中的启用数字字段，以及 STAFFING_COUNT 数字列。 */
export function staffingCandidates(config: DraftConfigV2): StaffingCandidate[] {
  const active = activeSectionKeys(config);
  const candidates: StaffingCandidate[] = [];
  for (const component of config.components) {
    if (!component.enabled || !active.has(component.sectionKey)) continue;
    if (component.kind === "FIELD" && component.fieldType === "NUMBER") {
      candidates.push({
        kind: "NUMBER_FIELD",
        componentKey: component.stableKey,
        label: component.label,
        stableKeyLabel: component.stableKey,
      });
    }
    if (component.kind === "REPEATABLE_TABLE") {
      for (const column of component.columns) {
        if (
          column.columnType === "NUMBER" &&
          column.semanticRole === "STAFFING_COUNT"
        ) {
          candidates.push({
            kind: "REPEATABLE_TABLE_SUM",
            componentKey: component.stableKey,
            columnKey: column.stableKey,
            label: `${component.label} · ${column.label}`,
            stableKeyLabel: `${component.stableKey}.${column.stableKey}`,
          });
        }
      }
    }
  }
  return candidates;
}

function explainMissingCandidate(
  config: DraftConfigV2,
  source: DraftStaffingSourceV2,
): string {
  if (source.kind === "FIXED") return "固定人数必须是正整数。";
  const component = config.components.find(
    (candidate) => candidate.stableKey === source.componentKey,
  );
  if (!component) return "人数来源指向的组件已不存在，请重新选择。";
  if (!component.enabled) return "人数来源指向的组件已停用，请先启用或改选。";
  if (!activeSectionKeys(config).has(component.sectionKey)) {
    return "人数来源所在区块已停用，请先启用区块或改选。";
  }
  if (component.kind === "FIELD") {
    return "人数来源必须是数字字段（fieldType=NUMBER）。";
  }
  if (component.kind === "REPEATABLE_TABLE") {
    return "人数来源必须是表格里语义角色为“人数(STAFFING_COUNT)”的数字列。";
  }
  return "人数来源不可用，请重新选择。";
}

/** 设置人数来源；目标必须在候选集合内（与服务端发布校验一致）。 */
export function setStaffingSource(
  config: DraftConfigV2,
  source: DraftStaffingSourceV2,
): BindingResult {
  if (source.kind === "FIXED") {
    if (!Number.isInteger(source.count) || source.count <= 0) {
      return { ok: false, reason: "固定人数必须是正整数。" };
    }
    return { ok: true, config: { ...config, staffingSource: source } };
  }

  const matched = staffingCandidates(config).some((candidate) => {
    if (candidate.kind !== source.kind) return false;
    if (candidate.componentKey !== source.componentKey) return false;
    if (source.kind === "REPEATABLE_TABLE_SUM") {
      return candidate.columnKey === source.columnKey;
    }
    return true;
  });
  if (!matched)
    return { ok: false, reason: explainMissingCandidate(config, source) };
  return { ok: true, config: { ...config, staffingSource: source } };
}

/** 设置/清除选项加价：只接受十进制字符串分；null 表示清除。 */
export function setOptionPrice(
  config: DraftConfigV2,
  componentKey: string,
  optionValue: string,
  priceDeltaFen: string | null,
): BindingResult {
  const component = config.components.find(
    (candidate) => candidate.stableKey === componentKey,
  );
  if (!component || component.kind !== "FIELD") {
    return { ok: false, reason: "只有选择字段可以配置选项加价。" };
  }
  const field: DraftFieldComponentV2 = component;
  if (
    field.fieldType !== "SINGLE_SELECT" &&
    field.fieldType !== "MULTI_SELECT"
  ) {
    return { ok: false, reason: "只有选择字段可以配置选项加价。" };
  }
  const options = field.options ?? [];
  if (!options.some((option) => option.value === optionValue)) {
    return { ok: false, reason: "选项不存在，请先在内容设计里添加该选项。" };
  }
  // 注意：RegExp.test 会把 number 强制转成字符串，必须先判类型（金额禁止 number）
  if (
    priceDeltaFen !== null &&
    (typeof priceDeltaFen !== "string" || !DECIMAL_FEN.test(priceDeltaFen))
  ) {
    return {
      ok: false,
      reason: "加价必须是非负整数分的十进制字符串（例如 1500）。",
    };
  }

  const nextOptions = options.map((option) => {
    if (option.value !== optionValue) return option;
    const copy = { ...option };
    if (priceDeltaFen === null) {
      delete copy.priceDeltaFen;
    } else {
      copy.priceDeltaFen = priceDeltaFen;
    }
    return copy;
  });

  return {
    ok: true,
    config: {
      ...config,
      components: config.components.map((candidate) =>
        candidate.stableKey === componentKey
          ? ({ ...field, options: nextOptions } as DraftFieldComponentV2)
          : candidate,
      ),
    },
  };
}

/** 分 → 元展示文本（仅展示）。 */
export function formatFenToYuan(priceDeltaFen: string): string {
  return fenToYuanText(priceDeltaFen);
}

/** 元输入 → 分（十进制字符串）；非法返回 null。 */
export function parseYuanToFen(text: string): string | null {
  return yuanToFenString(text);
}

/** 即时校验：界面用来在发布前就把问题摆出来（服务端仍会再校验一次）。 */
export function collectDraftIssues(config: DraftConfigV2): DraftIssue[] {
  const issues: DraftIssue[] = [];

  config.sections.forEach((section, index) => {
    if (section.audiences !== undefined && section.audiences.length === 0) {
      issues.push({
        code: "TEMPLATE_COMPONENT_INVALID",
        path: `$.sections[${index}].audiences`,
        message: "分组至少要对一个端口可见（客服或客户）",
      });
    }
  });

  // 值类内容必须留给能填写的端口之一；两端的顺序统一用「客服·客户」表述。
  const writableLabel = WRITABLE_AUDIENCES.map((audience) =>
    audience === "CS" ? "客服" : "客户",
  ).join("、");
  for (const component of valueComponentsOutsideAudiences(
    config,
    WRITABLE_AUDIENCES,
  )) {
    const index = config.components.indexOf(component);
    issues.push({
      code: "TEMPLATE_COMPONENT_INVALID",
      path: `$.components[${index}].audiences`,
      componentKey: component.stableKey,
      message: `「${component.label || "未命名"}」没留给能填写的端口：请让它对${writableLabel}中的至少一个可见，或改成说明类内容`,
    });
  }

  // C-4 同口径：参与算价/人数的内容必须对**每个**能填写的端口可见，
  // 否则对应入口下单会失败或算错（与后端 collectPublishBlockingIssuesV2 一致）。
  for (const component of billingComponentsOutsideEveryAudience(
    config,
    WRITABLE_AUDIENCES,
  )) {
    const index = config.components.indexOf(component);
    issues.push({
      code: "TEMPLATE_COMPONENT_INVALID",
      path: `$.components[${index}].audiences`,
      componentKey: component.stableKey,
      message: `「${component.label || "未命名"}」参与算价或人数，必须对每个能填写的端口（${writableLabel}）都可见，否则对应入口下单会失败或算错`,
    });
  }

  const source = config.staffingSource;
  if (source.kind === "FIXED") {
    if (!Number.isInteger(source.count) || source.count <= 0) {
      issues.push({
        code: "TEMPLATE_BINDING_INVALID",
        path: "$.staffingSource.count",
        message: "固定人数必须是正整数",
      });
    }
  } else {
    const matched = staffingCandidates(config).some((candidate) => {
      if (candidate.kind !== source.kind) return false;
      if (candidate.componentKey !== source.componentKey) return false;
      if (source.kind === "REPEATABLE_TABLE_SUM") {
        return candidate.columnKey === source.columnKey;
      }
      return true;
    });
    if (!matched) {
      issues.push({
        code: "TEMPLATE_BINDING_INVALID",
        path:
          source.kind === "NUMBER_FIELD"
            ? "$.staffingSource.componentKey"
            : "$.staffingSource",
        componentKey: source.componentKey,
        message: `人数来源不可用：${explainMissingCandidate(config, source)}`,
      });
    }
  }

  config.components.forEach((component, index) => {
    if (component.audiences !== undefined && component.audiences.length === 0) {
      issues.push({
        code: "TEMPLATE_COMPONENT_INVALID",
        path: `$.components[${index}].audiences`,
        componentKey: component.stableKey,
        message: "内容至少要对一个端口可见（客服或客户）",
      });
    }
    if (component.kind === "FIELD") {
      const choice =
        component.fieldType === "SINGLE_SELECT" ||
        component.fieldType === "MULTI_SELECT";
      if (choice && (component.options ?? []).length === 0) {
        issues.push({
          code: "TEMPLATE_COMPONENT_INVALID",
          path: `$.components[${index}].options`,
          componentKey: component.stableKey,
          message: "选择字段必须至少有一个选项",
        });
      }
      if (
        component.fieldType === "MULTI_SELECT" &&
        !component.aggregationPolicy
      ) {
        issues.push({
          code: "TEMPLATE_COMPONENT_INVALID",
          path: `$.components[${index}].aggregationPolicy`,
          componentKey: component.stableKey,
          message: "多选字段必须声明 SUM 或 MAX 聚合策略",
        });
      }
      (component.options ?? []).forEach((option, optionIndex) => {
        if (
          option.priceDeltaFen !== undefined &&
          (typeof option.priceDeltaFen !== "string" ||
            !DECIMAL_FEN.test(option.priceDeltaFen))
        ) {
          issues.push({
            code: "TEMPLATE_PRICE_RULE_INVALID",
            path: `$.components[${index}].options[${optionIndex}].priceDeltaFen`,
            componentKey: component.stableKey,
            message: "选项加价必须为非负整数分字符串",
          });
        }
      });
    }
  });

  const legacyRules = config.legacyCompatibility?.unboundPriceRules ?? [];
  if (legacyRules.length > 0) {
    issues.push({
      code: "TEMPLATE_LEGACY_REVIEW_REQUIRED",
      path: "$.legacyCompatibility.unboundPriceRules",
      message: `有 ${legacyRules.length} 条旧价格规则需要人工确认后才能发布`,
    });
  }

  return issues;
}

function tabFor(path: string): "content" | "binding" {
  return path.includes("staffingSource") ||
    path.includes(".options") ||
    path.includes("legacyCompatibility")
    ? "binding"
    : "content";
}

/** 把契约 issue（含下标路径）定位到编辑器的标签与 stableKey。 */
export function mapIssuesToLocation(
  config: DraftConfigV2,
  issues: readonly CandidateInputIssue[],
): LocatedIssue[] {
  return issues.map((issue) => {
    const componentMatch = /\$\.components\[(\d+)\]/.exec(issue.path);
    const sectionMatch = /\$\.sections\[(\d+)\]/.exec(issue.path);
    const componentKey =
      issue.componentKey ??
      (componentMatch
        ? config.components[Number(componentMatch[1])]?.stableKey
        : undefined);
    const sectionKey = sectionMatch
      ? config.sections[Number(sectionMatch[1])]?.stableKey
      : undefined;
    return {
      code: issue.code,
      tab: tabFor(issue.path),
      ...(sectionKey === undefined ? {} : { sectionKey }),
      ...(componentKey === undefined ? {} : { componentKey }),
      message: issue.message,
    };
  });
}

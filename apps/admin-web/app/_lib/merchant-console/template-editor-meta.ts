import { collectDraftIssues } from "./template-binding";
import {
  ALL_AUDIENCES,
  DEFAULT_AUDIENCES,
  effectiveAudiencesOf,
  sanitizeAudiences,
  type TemplateAudience,
} from "./template-draft-state";
import type {
  DraftComponentV2,
  DraftConfigV2,
  DraftFieldTypeV2,
  DraftSemanticRoleV2,
  DraftTableColumnTypeV2,
} from "./template-draft-state";

// 端口可见性的类型与「读一份声明」住在模型层（template-draft-state）；
// 这里转出去，保持 Task 1 已有的引用面不变。
export { ALL_AUDIENCES, DEFAULT_AUDIENCES, sanitizeAudiences };
export type { TemplateAudience };
/**
 * 模板编辑器（内容设计）视图层的纯函数与文案表。
 *
 * 设计规格 v0.2 的 D-13 / D-15 / D-18 / D-19：
 * - 只给原语，不给预设：这里不定义任何预置字段或预置区块，只有中性的绑定取值。
 * - 行保持安静：行上显示的是类型、属性摘要与问题数，细节留给展开后的属性面板。
 * - 不新造校验：问题数一律来自既有 collectDraftIssues 的输出。
 * - 不暴露工程概念：语义角色只以「不用 / 人数 / 时长」三个中性取值出现。
 */
/** 说明文字在行摘要里最多显示多少个字。 */
const NOTE_SUMMARY_LIMIT = 18;
export const FIELD_TYPE_LABELS: Record<DraftFieldTypeV2, string> = {
  TEXT: "单行文本",
  TEXTAREA: "多行文本",
  NUMBER: "数字",
  MONEY_FEN: "金额",
  DATETIME: "日期时间",
  SINGLE_SELECT: "单选",
  MULTI_SELECT: "多选",
};
export const TABLE_COLUMN_TYPE_LABELS: Record<DraftTableColumnTypeV2, string> =
  {
    TEXT: "文本",
    NUMBER: "数字",
    SINGLE_SELECT: "单选",
  };
export const COMPONENT_KIND_LABELS: Record<DraftComponentV2["kind"], string> = {
  FIELD: "字段",
  REPEATABLE_TABLE: "表格",
  NOTE: "说明",
};
/** 算价绑定只暴露三个中性取值；不绑也能保存与发布。 */
export const BINDING_OPTIONS: ReadonlyArray<{
  role: DraftSemanticRoleV2 | null;
  label: string;
}> = [
  { role: null, label: "不用" },
  { role: "STAFFING_COUNT", label: "人数" },
  { role: "DURATION_MINUTES", label: "时长" },
];
export function componentOf(
  config: DraftConfigV2,
  stableKey: string,
): DraftComponentV2 | null {
  return config.components.find((item) => item.stableKey === stableKey) ?? null;
}
/** 行上显示的一行属性摘要。 */
export function componentSummary(
  config: DraftConfigV2,
  stableKey: string,
): string {
  const component = componentOf(config, stableKey);
  if (!component) return "";
  if (component.kind === "FIELD") {
    const parts = [FIELD_TYPE_LABELS[component.fieldType]];
    if (
      component.fieldType === "SINGLE_SELECT" ||
      component.fieldType === "MULTI_SELECT"
    ) {
      const options = component.options ?? [];
      parts.push(`${options.length} 个选项`);
      const paid = options.filter(
        (option) => option.priceDeltaFen !== undefined,
      ).length;
      if (paid > 0) parts.push(`${paid} 项加价`);
    }
    return parts.join(" · ");
  }
  if (component.kind === "REPEATABLE_TABLE") {
    return `${component.columns.length} 列 · 默认 ${component.defaultRows.length} 行`;
  }
  return component.text.length > NOTE_SUMMARY_LIMIT
    ? `${component.text.slice(0, NOTE_SUMMARY_LIMIT)}…`
    : component.text;
}
/** 每个组件各有多少条待处理问题；区块级问题不计入组件。 */
export function issueCountByComponent(
  config: DraftConfigV2,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const issue of collectDraftIssues(config)) {
    if (!issue.componentKey) continue;
    counts.set(issue.componentKey, (counts.get(issue.componentKey) ?? 0) + 1);
  }
  return counts;
}
/** 某个算价取值当前被谁占用；已停用的组件不算占用。 */
export function bindingOwner(
  config: DraftConfigV2,
  role: DraftSemanticRoleV2,
  exceptStableKey: string,
): string | null {
  for (const component of config.components) {
    if (component.kind !== "FIELD" || !component.enabled) continue;
    if (component.stableKey === exceptStableKey) continue;
    if (component.semanticRole === role) return component.label || "未命名字段";
  }
  for (const component of config.components) {
    if (component.kind !== "REPEATABLE_TABLE" || !component.enabled) continue;
    if (component.stableKey === exceptStableKey) continue;
    if (component.columns.some((column) => column.semanticRole === role)) {
      return component.label || "未命名表格";
    }
  }
  return null;
}

/**
 * 元 ↔ 分的转换：金额一律按整数分存储，转换不经过浮点。
 * `{ ok: false }` 表示输入不是合法金额；空字符串表示「不加价」。
 */
export function yuanToFenString(input: string): { ok: boolean; fen?: string } {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: true };
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(trimmed)) return { ok: false };
  const [whole, fraction = ""] = trimmed.split(".");
  const fen = `${whole}${`${fraction}00`.slice(0, 2)}`.replace(/^0+(?=\d)/, "");
  return { ok: true, fen };
}

/** 分 → 元输入框显示值。 */
export function fenToYuanInput(fen: string | undefined): string {
  if (fen === undefined) return "";
  const padded = fen.padStart(3, "0");
  const whole = padded.slice(0, -2).replace(/^0+(?=\d)/, "");
  const fraction = padded.slice(-2);
  return fraction === "00" ? whole : `${whole}.${fraction}`;
}

/* ── 端口可见性（设计规格 v0.1，V-1 至 V-11）────────────────────────── */

const AUDIENCE_LABELS: Record<TemplateAudience, string> = {
  CS: "客服",
  CUSTOMER: "客户",
};

/** 单个端口的中文短名，给开关与行内标签用。 */
export function audienceLabel(audience: TemplateAudience): string {
  return AUDIENCE_LABELS[audience];
}

/** 对任意对象解析生效端口：解析规则住在模型层（effectiveAudiencesOf）。 */
export function audiencesOf(
  component: unknown,
  section?: unknown,
): TemplateAudience[] {
  return effectiveAudiencesOf(component, section);
}

/** 这个端口能不能看见这个组件（V-5：看不见的端口也不记录）。 */
export function canSee(
  component: unknown,
  section: unknown,
  audience: TemplateAudience,
): boolean {
  return audiencesOf(component, section).includes(audience);
}

/**
 * 按端口过滤：只保留该端口可见的组件；过滤后为空的分组不再返回。
 * 装箱规则交给 layoutV2Rows，本函数只决定"谁能看见什么"。
 */
export function visibleForAudience(
  config: DraftConfigV2,
  audience: TemplateAudience,
): DraftConfigV2 {
  const sections = config.sections.filter((section) =>
    config.components.some(
      (component) =>
        component.sectionKey === section.stableKey &&
        canSee(component, section, audience),
    ),
  );
  const components = config.components.filter((component) =>
    canSee(
      component,
      config.sections.find((item) => item.stableKey === component.sectionKey) ??
        null,
      audience,
    ),
  );
  return { ...config, sections, components };
}

/**
 * 行标签用的白话文案。固定按 ALL_AUDIENCES 的顺序渲染，
 * 免得"先去掉客服再点回来"之后显示成「客户·客服」这种顺序漂移。
 */
export function describeAudiences(list: readonly TemplateAudience[]): string {
  return ALL_AUDIENCES.filter((audience) => list.includes(audience))
    .map((audience) => AUDIENCE_LABELS[audience])
    .join("·");
}

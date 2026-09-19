import { collectDraftIssues } from "./template-binding";
import type {
  DraftComponentV2,
  DraftConfigV2,
  DraftFieldTypeV2,
  DraftSemanticRoleV2,
  DraftTableColumnTypeV2,
} from "./template-draft-state";
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

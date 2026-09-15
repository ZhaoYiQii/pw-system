/**
 * 派单表单的栅格布局（2×N）。
 *
 * 约定（2026-09-12 用户确认）：默认每行 2 个字段，行数随字段数量增长；
 * 多行文本与说明文字独占一整行，避免长内容被压成半宽。
 * 这里的 span 是"占几列"，不是像素；窄屏由 CSS 降为单列。
 */

export const DEFAULT_FORM_COLUMNS = 2;

export interface FormFieldLike {
  fieldKey: string;
  fieldType: string;
  enabled?: boolean;
  required?: boolean;
  sectionId?: string | null;
  colSpan?: number;
  rowBreakBefore?: boolean;
}

export interface FormSectionLike {
  id: string;
  name?: string;
  columns?: number;
  enabled?: boolean;
  sortOrder?: number;
}

export interface LayoutSlot<T> {
  field: T;
  /** 占用的列数，范围 1..columns。 */
  span: number;
}

export type LayoutRow<T> = LayoutSlot<T>[];

/** 宽字段（多行文本、说明文字）独占整行，其余占 1 列。 */
export function fieldSpan(
  field: FormFieldLike,
  columns: number = DEFAULT_FORM_COLUMNS,
): number {
  const safeColumns = clampColumns(columns);
  if (Number.isInteger(field.colSpan)) {
    return Math.min(safeColumns, Math.max(1, field.colSpan ?? 1));
  }
  if (field.fieldType === "multiline" || field.fieldType === "note") {
    return safeColumns;
  }
  return 1;
}

export function clampColumns(columns: number): number {
  if (!Number.isFinite(columns)) return DEFAULT_FORM_COLUMNS;
  return Math.min(4, Math.max(1, Math.trunc(columns)));
}

/**
 * 把字段按顺序装箱成行：从左到右填满一行再换行；
 * 当前行放不下（剩余列数小于 span）时，先换行再放置。
 */
export function layoutFormRows<T extends FormFieldLike>(
  fields: readonly T[],
  columns: number = DEFAULT_FORM_COLUMNS,
): Array<LayoutRow<T>> {
  const safeColumns = clampColumns(columns);
  const rows: Array<LayoutRow<T>> = [];
  let current: LayoutRow<T> = [];
  let used = 0;

  for (const field of fields) {
    const span = Math.min(fieldSpan(field, safeColumns), safeColumns);
    if (field.rowBreakBefore && current.length > 0) {
      rows.push(current);
      current = [];
      used = 0;
    }
    if (used + span > safeColumns && current.length > 0) {
      rows.push(current);
      current = [];
      used = 0;
    }
    current.push({ field, span });
    used += span;
    if (used >= safeColumns) {
      rows.push(current);
      current = [];
      used = 0;
    }
  }

  if (current.length > 0) rows.push(current);
  return rows;
}

/** 需要在下单表单里渲染的字段：时长由下单页统一填写，不占格位。 */
export function isFormField(field: FormFieldLike): boolean {
  return field.enabled !== false && field.fieldType !== "duration";
}

/** 说明文字只负责解释，不参与必填和值提交。 */
export function isValueField(field: FormFieldLike): boolean {
  return isFormField(field) && field.fieldType !== "note";
}

const FALLBACK_FORM_SECTION: FormSectionLike = {
  id: "",
  name: "",
  columns: DEFAULT_FORM_COLUMNS,
  enabled: true,
  sortOrder: 0,
};

/** 启用分区按展示顺序返回；老模板回落为无标题双列表单。 */
export function formSections<T extends FormSectionLike>(
  sections: readonly T[],
): Array<T | FormSectionLike> {
  if (sections.length === 0) return [FALLBACK_FORM_SECTION];
  return [...sections]
    .filter((section) => section.enabled !== false)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

/** 某个启用分区中真正可见的字段；无 sectionId 的老字段归入首区块。 */
export function fieldsForSection<T extends FormFieldLike>(
  section: FormSectionLike,
  sections: readonly FormSectionLike[],
  fields: readonly T[],
): T[] {
  const firstSectionId = sections[0]?.id ?? "";
  return fields.filter(
    (field) =>
      isFormField(field) &&
      (section.id === "" || (field.sectionId || firstSectionId) === section.id),
  );
}

/** 返回创建派单时真正可填写的字段，停用字段和停用区块不参与校验。 */
export function activeFormFields<T extends FormFieldLike>(
  sections: readonly FormSectionLike[],
  fields: readonly T[],
): T[] {
  if (sections.length === 0) return fields.filter(isValueField);
  const sortedSections = [...sections].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
  );
  const firstSectionId = sortedSections[0]?.id ?? "";
  const activeSectionIds = new Set(
    sortedSections
      .filter((section) => section.enabled !== false)
      .map((section) => section.id),
  );
  return fields.filter((field) => {
    if (!isValueField(field)) return false;
    return activeSectionIds.has(field.sectionId || firstSectionId);
  });
}

/** 保持其他区块原位，只和当前区块的相邻字段交换。 */
export function moveFieldWithinSection<T extends { sectionKey: string }>(
  fields: readonly T[],
  index: number,
  direction: -1 | 1,
): readonly T[] {
  const field = fields[index];
  if (!field) return fields;
  const siblings = fields
    .map((item, itemIndex) => ({ item, itemIndex }))
    .filter(({ item }) => item.sectionKey === field.sectionKey);
  const siblingIndex = siblings.findIndex((entry) => entry.itemIndex === index);
  const target = siblings[siblingIndex + direction];
  if (!target) return fields;
  const next = [...fields];
  [next[index], next[target.itemIndex]] = [
    next[target.itemIndex]!,
    next[index]!,
  ];
  return next;
}

export type SectionVariant = "card" | "plain" | "divider";
export type SectionDensity = "comfortable" | "compact";
export type SectionAlign = "left" | "center";

export interface FormSectionStyle {
  variant: SectionVariant;
  density: SectionDensity;
  align: SectionAlign;
}

export const DEFAULT_SECTION_STYLE: FormSectionStyle = {
  variant: "card",
  density: "comfortable",
  align: "left",
};

/**
 * 读取区块外观配置。服务端存在模板的 `blockLabels.sections[区块名]`，
 * 设计器与下单表单共用同一份解析，避免两处样式不一致。
 */
export function formSectionStyle(
  blockLabels: Record<string, unknown> | undefined,
  name: string,
): FormSectionStyle {
  const rawSections = blockLabels?.["sections"];
  const entry =
    rawSections &&
    typeof rawSections === "object" &&
    !Array.isArray(rawSections)
      ? (rawSections as Record<string, unknown>)[name]
      : undefined;
  const record =
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? (entry as Record<string, unknown>)
      : {};
  const variant = record["variant"];
  const density = record["density"];
  const align = record["align"];
  return {
    variant: variant === "plain" || variant === "divider" ? variant : "card",
    density: density === "compact" ? "compact" : "comfortable",
    align: align === "center" ? "center" : "left",
  };
}

/**
 * 模板没配岗位席位时的兜底位置行。
 * 派单领域要求"至少一个位置行"（否则陪玩无法报名），所以这里给一行通用「陪玩 ×1」，
 * 而不是强迫门店先去配置岗位名称。
 */
export const DEFAULT_POSITION_LABEL = "陪玩";

export interface PositionLike {
  id: string;
  label: string;
  defaultCount: number;
}

export interface DispatchLine {
  positionLabel: string;
  requiredCount: number;
}

export function dispatchLines(
  positions: readonly PositionLike[],
  counts: Readonly<Record<string, number>> = {},
): DispatchLine[] {
  if (positions.length === 0) {
    return [{ positionLabel: DEFAULT_POSITION_LABEL, requiredCount: 1 }];
  }
  return positions.map((position) => ({
    positionLabel: position.label,
    requiredCount: Math.max(1, counts[position.id] ?? position.defaultCount),
  }));
}

/* ------------------------------------------------------------------ *
 * v2 通用模板布局规则（S3）：区块列数 + 组件 colSpan/rowBreakBefore 装箱。
 * 与 v1 的 layoutFormRows 并存，不改变旧调用方行为。
 * ------------------------------------------------------------------ */

export interface LayoutV2ComponentLike {
  stableKey: string;
  sectionKey: string;
  enabled: boolean;
  sortOrder: number;
  layout: { colSpan: number; rowBreakBefore: boolean };
}

export interface LayoutV2SectionLike {
  stableKey: string;
  enabled: boolean;
  sortOrder: number;
  layout: { columns: number };
}

export interface LayoutV2Row<C> {
  components: C[];
  widthUsed: number;
}

export interface LayoutV2Section<S, C> {
  section: S;
  columns: number;
  rows: Array<LayoutV2Row<C>>;
}

/** 按区块列数把组件装箱成行；默认跳过停用组件（编辑器可显式包含）。 */
export function layoutV2Rows<
  C extends LayoutV2ComponentLike,
  S extends LayoutV2SectionLike,
>(
  sections: readonly S[],
  components: readonly C[],
  options: { includeDisabled?: boolean } = {},
): Array<LayoutV2Section<S, C>> {
  const includeDisabled = options.includeDisabled === true;
  return [...sections]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((section) => {
      const columns = clampColumns(section.layout.columns);
      const rows: Array<LayoutV2Row<C>> = [];
      let current: LayoutV2Row<C> = { components: [], widthUsed: 0 };
      const inSection = components
        .filter((component) => component.sectionKey === section.stableKey)
        .filter((component) => includeDisabled || component.enabled)
        .sort((a, b) => a.sortOrder - b.sortOrder);

      for (const component of inSection) {
        const span = Math.min(
          Math.max(Math.trunc(component.layout.colSpan), 1),
          columns,
        );
        const mustBreak =
          current.widthUsed > 0 &&
          (component.layout.rowBreakBefore ||
            current.widthUsed + span > columns);
        if (mustBreak) {
          rows.push(current);
          current = { components: [], widthUsed: 0 };
        }
        current.components.push(component);
        current.widthUsed += span;
      }
      if (current.components.length > 0) rows.push(current);
      return { section, columns, rows };
    });
}

/** 列宽标签按真实列数计算，不写死"半宽/整行"。 */
export function columnSpanLabel(columns: number, colSpan: number): string {
  const total = clampColumns(columns);
  const span = Math.min(Math.max(Math.trunc(colSpan), 1), total);
  if (span >= total) return "整行";
  if (total === 2) return "半宽";
  return `${span}/${total}`;
}

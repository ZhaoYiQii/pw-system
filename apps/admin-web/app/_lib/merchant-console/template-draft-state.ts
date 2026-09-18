/**
 * 通用模板草稿的纯函数状态模型（S3 编辑器的心脏）。
 *
 * 约定：
 * - 所有业务关系都用 stableKey（显示名、fieldKey 都不参与绑定）；
 * - stableKey 在区块、组件、表格列之间全局唯一；
 * - 禁用保留配置，只有显式删除才移除；
 * - 被人数来源引用的组件/列不能删除，必须先解除绑定；
 * - 参数与返回值都使用契约生成的 DraftConfig 类型，避免与 S2 契约漂移。
 */
import type { TemplateDraftConfig } from "./template-api";

/**
 * 编辑器内部的精确模型。
 *
 * 为什么需要镜像：S2 生成的契约类型把判别字段渲染成 `kind: string`（oneOf 未带 discriminator），
 * 导致 `kind === "FIELD"` 这类收窄失效。这里用字面量判别联合作为编辑器的“工作类型”，
 * 只在读写边界（草稿接口）做一次转换，并用编译期断言保证与契约一致（见 spec）。
 */
export type DraftFieldTypeV2 =
  | "TEXT"
  | "TEXTAREA"
  | "NUMBER"
  | "MONEY_FEN"
  | "DATETIME"
  | "SINGLE_SELECT"
  | "MULTI_SELECT";

export type DraftSemanticRoleV2 =
  | "CUSTOM"
  | "MODE"
  | "TARGET_RANK"
  | "CURRENT_RANK"
  | "DURATION_MINUTES"
  | "SERVER_REGION"
  | "CONTACT"
  | "ORDER_NOTE"
  | "STAFFING_LABEL"
  | "STAFFING_COUNT";

export type DraftTableColumnTypeV2 = "TEXT" | "NUMBER" | "SINGLE_SELECT";
export type DraftGridSpan = 1 | 2 | 3 | 4;

export interface DraftLayoutV2 {
  colSpan: DraftGridSpan;
  rowBreakBefore: boolean;
}

export interface DraftChoiceOptionV2 {
  value: string;
  label: string;
  priceDeltaFen?: string;
}

export interface DraftSectionV2 {
  stableKey: string;
  label: string;
  description?: string;
  enabled: boolean;
  sortOrder: number;
  layout: {
    columns: DraftGridSpan;
    density?: "comfortable" | "compact";
    align?: "left" | "center";
  };
}

export interface DraftFieldComponentV2 {
  kind: "FIELD";
  stableKey: string;
  sectionKey: string;
  label: string;
  description?: string;
  enabled: boolean;
  sortOrder: number;
  layout: DraftLayoutV2;
  fieldType: DraftFieldTypeV2;
  semanticRole: DraftSemanticRoleV2;
  required: boolean;
  placeholder?: string;
  options?: DraftChoiceOptionV2[];
  aggregationPolicy?: "SUM" | "MAX";
}

export interface DraftTableColumnV2 {
  stableKey: string;
  label: string;
  columnType: DraftTableColumnTypeV2;
  semanticRole: DraftSemanticRoleV2;
  required: boolean;
  options?: DraftChoiceOptionV2[];
}

export interface DraftTableComponentV2 {
  kind: "REPEATABLE_TABLE";
  stableKey: string;
  sectionKey: string;
  label: string;
  description?: string;
  enabled: boolean;
  sortOrder: number;
  layout: DraftLayoutV2;
  columns: DraftTableColumnV2[];
  defaultRows: Array<Record<string, unknown>>;
}

export interface DraftNoteComponentV2 {
  kind: "NOTE";
  stableKey: string;
  sectionKey: string;
  label: string;
  description?: string;
  enabled: boolean;
  sortOrder: number;
  layout: DraftLayoutV2;
  text: string;
}

export type DraftComponentV2 =
  DraftFieldComponentV2 | DraftTableComponentV2 | DraftNoteComponentV2;

export type DraftStaffingSourceV2 =
  | { kind: "FIXED"; count: number }
  | { kind: "NUMBER_FIELD"; componentKey: string }
  | { kind: "REPEATABLE_TABLE_SUM"; componentKey: string; columnKey: string };

export interface DraftConfigV2 {
  schemaVersion: 2;
  sections: DraftSectionV2[];
  components: DraftComponentV2[];
  staffingSource: DraftStaffingSourceV2;
  legacyCompatibility?: {
    unboundPriceRules: Array<{
      label: string;
      priceDeltaFen: string;
      sortOrder: number;
    }>;
  };
}

/** 服务端草稿 → 编辑器模型（结构一致，运行时零转换）。 */
export function toDraftConfig(config: TemplateDraftConfig): DraftConfigV2 {
  return config as unknown as DraftConfigV2;
}

/** 编辑器模型 → 契约类型（保存草稿时使用）。 */
export function toContractConfig(config: DraftConfigV2): TemplateDraftConfig {
  return config as unknown as TemplateDraftConfig;
}

type Section = DraftSectionV2;
type Component = DraftComponentV2;
type TableComponent = DraftTableComponentV2;
type TableColumn = DraftTableColumnV2;
type FieldComponent = DraftFieldComponentV2;

export type DraftResult =
  { ok: true; config: DraftConfigV2 } | { ok: false; reason: string };

export type DraftCreateResult =
  | { ok: true; config: DraftConfigV2; stableKey: string }
  | { ok: false; reason: string };

export type MoveDirection = "up" | "down";
export type DraftPreset = "STAFFING_TABLE" | "OPTION_PRICE";

const STABLE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

function cloneConfig(config: DraftConfigV2): DraftConfigV2 {
  return JSON.parse(JSON.stringify(config)) as DraftConfigV2;
}

function usedKeys(config: DraftConfigV2): Set<string> {
  const used = new Set<string>();
  for (const section of config.sections) used.add(section.stableKey);
  for (const component of config.components) {
    used.add(component.stableKey);
    if (component.kind === "REPEATABLE_TABLE") {
      for (const column of component.columns) used.add(column.stableKey);
    }
  }
  return used;
}

/** 生成全局唯一 stableKey：`hint`、`hint_2`、`hint_3`… */
export function nextStableKey(config: DraftConfigV2, hint: string): string {
  const base =
    hint
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^[^a-z]+/, "")
      .replace(/_+$/, "")
      .slice(0, 48) || "item";
  const used = usedKeys(config);
  if (!used.has(base) && STABLE_KEY_PATTERN.test(base)) return base;
  let index = 2;
  while (used.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

function clampColumns(columns: number): 1 | 2 | 3 | 4 {
  const value = Math.round(columns);
  if (value <= 1) return 1;
  if (value >= 4) return 4;
  return value as 2 | 3;
}

function labelOf(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed === "" ? fallback : trimmed.slice(0, 50);
}

/** 统一重排：区块与组件都按 sortOrder 连续编号，组件数组顺序与逻辑顺序一致。 */
function reindex(config: DraftConfigV2): DraftConfigV2 {
  const sections = [...config.sections]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((section, index) => ({ ...section, sortOrder: index }));

  const components: Component[] = [];
  for (const section of sections) {
    const inSection = config.components
      .filter((component) => component.sectionKey === section.stableKey)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((component, index) => ({ ...component, sortOrder: index }));
    components.push(...inSection);
  }
  // 区块丢失的组件（理论上不该出现）保留在末尾，避免静默丢数据
  const orphan = config.components.filter(
    (component) => !sections.some((s) => s.stableKey === component.sectionKey),
  );
  return { ...config, sections, components: [...components, ...orphan] };
}

function sectionOf(
  config: DraftConfigV2,
  sectionKey: string,
): Section | undefined {
  return config.sections.find((section) => section.stableKey === sectionKey);
}

function componentOf(
  config: DraftConfigV2,
  stableKey: string,
): Component | undefined {
  return config.components.find(
    (component) => component.stableKey === stableKey,
  );
}

function replaceComponent(
  config: DraftConfigV2,
  stableKey: string,
  next: Component,
): DraftConfigV2 {
  return {
    ...config,
    components: config.components.map((component) =>
      component.stableKey === stableKey ? next : component,
    ),
  };
}

/** 人数来源引用的组件（业务规则引用先只覆盖人数来源）。 */
export function referencedComponentKeys(config: DraftConfigV2): Set<string> {
  const referenced = new Set<string>();
  const source = config.staffingSource;
  if (source.kind === "NUMBER_FIELD") referenced.add(source.componentKey);
  if (source.kind === "REPEATABLE_TABLE_SUM") {
    referenced.add(source.componentKey);
  }
  return referenced;
}

export function guardRemoveComponent(
  config: DraftConfigV2,
  stableKey: string,
): { ok: true } | { ok: false; reason: string } {
  if (referencedComponentKeys(config).has(stableKey)) {
    return {
      ok: false,
      reason: "该组件被“人数来源”引用，请先解除绑定再删除。",
    };
  }
  return { ok: true };
}

export function guardRemoveTableColumn(
  config: DraftConfigV2,
  componentKey: string,
  columnKey: string,
): { ok: true } | { ok: false; reason: string } {
  const source = config.staffingSource;
  if (
    source.kind === "REPEATABLE_TABLE_SUM" &&
    source.componentKey === componentKey &&
    source.columnKey === columnKey
  ) {
    return {
      ok: false,
      reason: "该列是“人数来源”的目标列，请先解除绑定再删除。",
    };
  }
  return { ok: true };
}

/* --------------------------------------------------------------- 区块 */

export function addSection(
  config: DraftConfigV2,
  input: { label: string; columns: number },
): DraftCreateResult {
  const next = cloneConfig(config);
  const stableKey = nextStableKey(next, "section");
  const section: Section = {
    stableKey,
    label: labelOf(input.label, "新分区"),
    enabled: true,
    sortOrder: next.sections.length,
    layout: { columns: clampColumns(input.columns) },
  };
  return {
    ok: true,
    stableKey,
    config: reindex({ ...next, sections: [...next.sections, section] }),
  };
}

export function updateSection(
  config: DraftConfigV2,
  sectionKey: string,
  patch: { label?: string; enabled?: boolean; columns?: number },
): DraftConfigV2 {
  return reindex({
    ...config,
    sections: config.sections.map((section) =>
      section.stableKey === sectionKey
        ? {
            ...section,
            ...(patch.label === undefined
              ? {}
              : { label: labelOf(patch.label, section.label) }),
            ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
            ...(patch.columns === undefined
              ? {}
              : {
                  layout: {
                    ...section.layout,
                    columns: clampColumns(patch.columns),
                  },
                }),
          }
        : section,
    ),
  });
}

export function moveSection(
  config: DraftConfigV2,
  sectionKey: string,
  direction: MoveDirection,
): DraftConfigV2 {
  const ordered = [...config.sections].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  const index = ordered.findIndex(
    (section) => section.stableKey === sectionKey,
  );
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= ordered.length) return config;
  const swapped = [...ordered];
  const current = swapped[index]!;
  swapped[index] = swapped[target]!;
  swapped[target] = current;
  return reindex({
    ...config,
    sections: swapped.map((section, order) => ({
      ...section,
      sortOrder: order,
    })),
  });
}

export function removeSection(
  config: DraftConfigV2,
  sectionKey: string,
): DraftResult {
  const doomed = config.components.filter(
    (component) => component.sectionKey === sectionKey,
  );
  const referenced = referencedComponentKeys(config);
  const blocked = doomed.find((component) =>
    referenced.has(component.stableKey),
  );
  if (blocked) {
    return {
      ok: false,
      reason: `区块内的「${blocked.label}」被“人数来源”引用，请先解除绑定。`,
    };
  }
  return {
    ok: true,
    config: reindex({
      ...config,
      sections: config.sections.filter(
        (section) => section.stableKey !== sectionKey,
      ),
      components: config.components.filter(
        (component) => component.sectionKey !== sectionKey,
      ),
    }),
  };
}

/* --------------------------------------------------------------- 组件 */

export function addComponent(
  config: DraftConfigV2,
  kind: Component["kind"],
  sectionKey: string,
): DraftCreateResult {
  if (!sectionOf(config, sectionKey)) {
    return { ok: false, reason: "目标区块不存在或已被删除。" };
  }
  const next = cloneConfig(config);
  const stableKey = nextStableKey(next, kind.toLowerCase());
  const sortOrder = next.components.filter(
    (component) => component.sectionKey === sectionKey,
  ).length;
  const base = {
    stableKey,
    sectionKey,
    enabled: true,
    sortOrder,
    layout: { colSpan: 1 as const, rowBreakBefore: false },
  };

  let component: Component;
  if (kind === "FIELD") {
    component = {
      ...base,
      kind: "FIELD",
      label: "新字段",
      fieldType: "TEXT",
      semanticRole: "CUSTOM",
      required: false,
    };
  } else if (kind === "NOTE") {
    component = {
      ...base,
      kind: "NOTE",
      label: "说明",
      text: "在此填写给客服看的说明（纯文本）。",
    };
  } else {
    component = {
      ...base,
      kind: "REPEATABLE_TABLE",
      label: "新表格",
      columns: [
        {
          stableKey: nextStableKey(next, "column"),
          label: "第 1 列",
          columnType: "TEXT",
          semanticRole: "CUSTOM",
          required: false,
        },
      ],
      defaultRows: [],
    };
  }

  return {
    ok: true,
    stableKey,
    config: reindex({
      ...next,
      components: [...next.components, component],
    }),
  };
}

export function removeComponent(
  config: DraftConfigV2,
  stableKey: string,
): DraftConfigV2 {
  return reindex({
    ...config,
    components: config.components.filter(
      (component) => component.stableKey !== stableKey,
    ),
  });
}

export function toggleComponentEnabled(
  config: DraftConfigV2,
  stableKey: string,
  enabled: boolean,
): DraftConfigV2 {
  const target = componentOf(config, stableKey);
  if (!target) return config;
  return replaceComponent(config, stableKey, { ...target, enabled });
}

export function updateComponent(
  config: DraftConfigV2,
  stableKey: string,
  patch: {
    label?: string;
    description?: string;
    required?: boolean;
    colSpan?: number;
    rowBreakBefore?: boolean;
    text?: string;
    fieldType?: FieldComponent["fieldType"];
    semanticRole?: FieldComponent["semanticRole"];
    placeholder?: string;
  },
): DraftConfigV2 {
  const target = componentOf(config, stableKey);
  if (!target) return config;
  const layout = {
    ...target.layout,
    ...(patch.colSpan === undefined
      ? {}
      : { colSpan: clampColumns(patch.colSpan) }),
    ...(patch.rowBreakBefore === undefined
      ? {}
      : { rowBreakBefore: patch.rowBreakBefore }),
  };
  const patched: Component = {
    ...target,
    ...(patch.label === undefined
      ? {}
      : { label: labelOf(patch.label, target.label) }),
    ...(patch.description === undefined
      ? {}
      : { description: patch.description.slice(0, 500) }),
    layout,
    ...(target.kind === "FIELD" && patch.required !== undefined
      ? { required: patch.required }
      : {}),
    ...(target.kind === "FIELD" && patch.semanticRole !== undefined
      ? { semanticRole: patch.semanticRole }
      : {}),
    ...(target.kind === "FIELD" && patch.placeholder !== undefined
      ? { placeholder: patch.placeholder.slice(0, 200) }
      : {}),
    ...(target.kind === "NOTE" && patch.text !== undefined
      ? { text: patch.text.slice(0, 500) }
      : {}),
  };

  if (target.kind === "FIELD" && patch.fieldType !== undefined) {
    const nextFieldType = patch.fieldType;
    const choice =
      nextFieldType === "SINGLE_SELECT" || nextFieldType === "MULTI_SELECT";
    // 领域规则：选择类字段必须至少一个选项，非选择类字段不能带选项
    const options = choice
      ? target.options && target.options.length > 0
        ? target.options
        : [{ value: "option_1", label: "选项 1" }]
      : undefined;
    const withType: FieldComponent = {
      ...(patched as FieldComponent),
      fieldType: nextFieldType,
      ...(options === undefined ? {} : { options }),
      ...(nextFieldType === "MULTI_SELECT"
        ? { aggregationPolicy: target.aggregationPolicy ?? ("SUM" as const) }
        : {}),
    };
    const cleaned = { ...withType } as FieldComponent & { options?: unknown };
    if (options === undefined) delete cleaned.options;
    if (nextFieldType !== "MULTI_SELECT") {
      delete (cleaned as { aggregationPolicy?: unknown }).aggregationPolicy;
    }
    return replaceComponent(config, stableKey, cleaned as FieldComponent);
  }

  return replaceComponent(config, stableKey, patched);
}

export function moveComponent(
  config: DraftConfigV2,
  stableKey: string,
  direction: MoveDirection,
): DraftConfigV2 {
  const target = componentOf(config, stableKey);
  if (!target) return config;
  const siblings = config.components
    .filter((component) => component.sectionKey === target.sectionKey)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const index = siblings.findIndex(
    (component) => component.stableKey === stableKey,
  );
  const nextIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || nextIndex < 0 || nextIndex >= siblings.length) return config;

  const reordered = [...siblings];
  const current = reordered[index]!;
  reordered[index] = reordered[nextIndex]!;
  reordered[nextIndex] = current;

  const others = config.components.filter(
    (component) => component.sectionKey !== target.sectionKey,
  );
  // 先按新顺序重排 sortOrder，再交给 reindex（否则会被旧 sortOrder 还原）
  return reindex({
    ...config,
    components: [...others, ...reordered].map((component) =>
      component.sectionKey === target.sectionKey
        ? { ...component, sortOrder: reordered.indexOf(component) }
        : component,
    ),
  });
}

export function reorderComponent(
  config: DraftConfigV2,
  stableKey: string,
  targetKey: string,
  position: "before" | "after",
): DraftConfigV2 {
  if (stableKey === targetKey) return config;
  const moving = componentOf(config, stableKey);
  const anchor = componentOf(config, targetKey);
  if (!moving || !anchor) return config;
  const movingSection = moving.sectionKey;
  const targetSection = anchor.sectionKey;
  if (movingSection === targetSection) {
    const rest = config.components
      .filter(
        (component) =>
          component.sectionKey === targetSection &&
          component.stableKey !== stableKey,
      )
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const at = rest.findIndex((component) => component.stableKey === targetKey);
    if (at < 0) return config;
    const insertAt = position === "before" ? at : at + 1;
    const reordered = [
      ...rest.slice(0, insertAt),
      moving,
      ...rest.slice(insertAt),
    ].map((component, index) => ({ ...component, sortOrder: index }));
    const others = config.components.filter(
      (component) => component.sectionKey !== targetSection,
    );
    return reindex({ ...config, components: [...others, ...reordered] });
  }
  const source = config.components
    .filter(
      (component) =>
        component.sectionKey === movingSection &&
        component.stableKey !== stableKey,
    )
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((component, index) => ({ ...component, sortOrder: index }));
  const destination = config.components
    .filter((component) => component.sectionKey === targetSection)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const at = destination.findIndex(
    (component) => component.stableKey === targetKey,
  );
  if (at < 0) return config;
  const insertAt = position === "before" ? at : at + 1;
  const moved = { ...moving, sectionKey: targetSection };
  const nextDestination = [
    ...destination.slice(0, insertAt),
    moved,
    ...destination.slice(insertAt),
  ].map((component, index) => ({ ...component, sortOrder: index }));
  const others = config.components.filter(
    (component) =>
      component.sectionKey !== movingSection &&
      component.sectionKey !== targetSection,
  );
  return reindex({
    ...config,
    components: [...others, ...source, ...nextDestination],
  });
}
/* --------------------------------------------------------- 参考预设 */

export function insertPreset(
  config: DraftConfigV2,
  sectionKey: string,
  preset: DraftPreset,
): DraftCreateResult {
  if (!sectionOf(config, sectionKey)) {
    return { ok: false, reason: "目标区块不存在或已被删除。" };
  }
  const next = cloneConfig(config);
  const claimedRoles = new Set<string>();
  for (const component of next.components) {
    if (component.kind === "FIELD" && component.semanticRole !== "CUSTOM") {
      claimedRoles.add(component.semanticRole);
    }
    if (component.kind === "REPEATABLE_TABLE") {
      for (const column of component.columns) {
        if (column.semanticRole !== "CUSTOM")
          claimedRoles.add(column.semanticRole);
      }
    }
  }

  if (preset === "STAFFING_TABLE") {
    if (
      claimedRoles.has("STAFFING_COUNT") ||
      claimedRoles.has("STAFFING_LABEL")
    ) {
      return {
        ok: false,
        reason:
          "「岗位/人数」语义角色已被其他组件占用，请先解除绑定或删除旧表格。",
      };
    }
    const labelKey = nextStableKey(next, "staffing_label");
    const countKey = nextStableKey(next, "staffing_count");
    const componentKey = nextStableKey(next, "staffing_table");
    const table: TableComponent = {
      kind: "REPEATABLE_TABLE",
      stableKey: componentKey,
      sectionKey,
      label: "岗位与人数",
      enabled: true,
      sortOrder: next.components.filter((c) => c.sectionKey === sectionKey)
        .length,
      layout: { colSpan: 4, rowBreakBefore: true },
      columns: [
        {
          stableKey: labelKey,
          label: "位置",
          columnType: "TEXT",
          semanticRole: "STAFFING_LABEL",
          required: true,
        },
        {
          stableKey: countKey,
          label: "人数",
          columnType: "NUMBER",
          semanticRole: "STAFFING_COUNT",
          required: true,
        },
      ],
      defaultRows: [{ [labelKey]: "陪玩", [countKey]: 1 }],
    };
    return {
      ok: true,
      stableKey: componentKey,
      config: reindex({
        ...next,
        components: [...next.components, table],
        staffingSource: {
          kind: "REPEATABLE_TABLE_SUM",
          componentKey,
          columnKey: countKey,
        },
      }),
    };
  }

  const componentKey = nextStableKey(next, "option_price");
  const field: FieldComponent = {
    kind: "FIELD",
    stableKey: componentKey,
    sectionKey,
    label: "选项加价",
    enabled: true,
    sortOrder: next.components.filter((c) => c.sectionKey === sectionKey)
      .length,
    layout: { colSpan: 1, rowBreakBefore: false },
    fieldType: "SINGLE_SELECT",
    semanticRole: "CUSTOM",
    required: false,
    options: [
      { value: "standard", label: "标准", priceDeltaFen: "0" },
      { value: "express", label: "加急", priceDeltaFen: "1000" },
    ],
  };
  return {
    ok: true,
    stableKey: componentKey,
    config: reindex({ ...next, components: [...next.components, field] }),
  };
}

/* --------------------------------------------------------- 可重复表格 */

export function addTableColumn(
  config: DraftConfigV2,
  componentKey: string,
): DraftCreateResult {
  const target = componentOf(config, componentKey);
  if (!target || target.kind !== "REPEATABLE_TABLE") {
    return { ok: false, reason: "目标不是可重复表格组件。" };
  }
  const column: TableColumn = {
    stableKey: nextStableKey(config, "column"),
    label: `第 ${target.columns.length + 1} 列`,
    columnType: "TEXT",
    semanticRole: "CUSTOM",
    required: false,
  };
  return {
    ok: true,
    stableKey: column.stableKey,
    config: replaceComponent(config, componentKey, {
      ...target,
      columns: [...target.columns, column],
    }),
  };
}

export function removeTableColumn(
  config: DraftConfigV2,
  componentKey: string,
  columnKey: string,
): DraftResult {
  const guard = guardRemoveTableColumn(config, componentKey, columnKey);
  if (!guard.ok) return guard;
  const target = componentOf(config, componentKey);
  if (!target || target.kind !== "REPEATABLE_TABLE") {
    return { ok: false, reason: "目标不是可重复表格组件。" };
  }
  return {
    ok: true,
    config: replaceComponent(config, componentKey, {
      ...target,
      columns: target.columns.filter(
        (column) => column.stableKey !== columnKey,
      ),
      defaultRows: target.defaultRows.map((row) => {
        const next = { ...row };
        delete next[columnKey];
        return next;
      }),
    }),
  };
}

function defaultValueFor(column: TableColumn): unknown {
  if (column.columnType === "NUMBER") return 0;
  if (column.columnType === "SINGLE_SELECT") {
    return column.options?.[0]?.value ?? "";
  }
  return "";
}

export function addDefaultRow(
  config: DraftConfigV2,
  componentKey: string,
): DraftResult {
  const target = componentOf(config, componentKey);
  if (!target || target.kind !== "REPEATABLE_TABLE") {
    return { ok: false, reason: "目标不是可重复表格组件。" };
  }
  const row: Record<string, unknown> = {};
  for (const column of target.columns) {
    row[column.stableKey] = defaultValueFor(column);
  }
  return {
    ok: true,
    config: replaceComponent(config, componentKey, {
      ...target,
      defaultRows: [...target.defaultRows, row],
    }),
  };
}

export function removeDefaultRow(
  config: DraftConfigV2,
  componentKey: string,
  index: number,
): DraftConfigV2 {
  const target = componentOf(config, componentKey);
  if (!target || target.kind !== "REPEATABLE_TABLE") return config;
  return replaceComponent(config, componentKey, {
    ...target,
    defaultRows: target.defaultRows.filter(
      (_row, rowIndex) => rowIndex !== index,
    ),
  });
}

/* --------------------------------------------------------------- 脏检查 */

function normalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => normalize(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${normalize(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** 与服务器草稿比较；键序、空白差异不算改动。 */
export function isDirty(
  saved: DraftConfigV2 | null,
  draft: DraftConfigV2,
): boolean {
  if (saved === null) return true;
  return normalize(saved) !== normalize(draft);
}
/** 覆盖某个选择字段的选项列表（Task 4 的价格编辑在此之上）。 */
export function setComponentOptions(
  config: DraftConfigV2,
  stableKey: string,
  options: NonNullable<FieldComponent["options"]>,
): DraftConfigV2 {
  const target = componentOf(config, stableKey);
  if (!target || target.kind !== "FIELD") return config;
  // 只有选择类字段可以带选项；其他类型调用此处直接忽略，避免产出非法配置
  if (
    target.fieldType !== "SINGLE_SELECT" &&
    target.fieldType !== "MULTI_SELECT"
  ) {
    return config;
  }
  return replaceComponent(config, stableKey, { ...target, options });
}

/** 修改可重复表格某行某列的默认值（编辑器表单直接改这一格）。 */
export function setDefaultRowValue(
  config: DraftConfigV2,
  componentKey: string,
  rowIndex: number,
  columnKey: string,
  value: unknown,
): DraftConfigV2 {
  const target = componentOf(config, componentKey);
  if (!target || target.kind !== "REPEATABLE_TABLE") return config;
  return replaceComponent(config, componentKey, {
    ...target,
    defaultRows: target.defaultRows.map((row, index) =>
      index === rowIndex ? { ...row, [columnKey]: value } : row,
    ),
  });
}

/** 修改表格列的基础属性（名称/类型/必填）。 */
export function updateTableColumn(
  config: DraftConfigV2,
  componentKey: string,
  columnKey: string,
  patch: {
    label?: string;
    columnType?: TableColumn["columnType"];
    required?: boolean;
  },
): DraftConfigV2 {
  const target = componentOf(config, componentKey);
  if (!target || target.kind !== "REPEATABLE_TABLE") return config;
  const nextType = patch.columnType;
  return replaceComponent(config, componentKey, {
    ...target,
    columns: target.columns.map((column) => {
      if (column.stableKey !== columnKey) return column;
      const choice = nextType === "SINGLE_SELECT";
      const updated: TableColumn = {
        ...column,
        ...(patch.label === undefined
          ? {}
          : { label: labelOf(patch.label, column.label) }),
        ...(patch.required === undefined ? {} : { required: patch.required }),
        ...(nextType === undefined ? {} : { columnType: nextType }),
      };
      if (nextType === undefined) return updated;
      if (!choice) {
        const cleaned = { ...updated } as TableColumn & { options?: unknown };
        delete cleaned.options;
        return cleaned as TableColumn;
      }
      return {
        ...updated,
        options:
          column.options && column.options.length > 0
            ? column.options
            : [{ value: "option_1", label: "选项 1" }],
      };
    }),
  });
}

// 客户自助下单（v2）表单：草稿值 → 提交体。
//
// 值形状的权威在服务端（game-template-calculations.ts / game-template-document.ts），
// 这里只按同一口径做本地转换与即时提示，服务端仍是唯一事实源：
// - NUMBER 字段与表格 NUMBER 列必须是 JS number；
// - MONEY_FEN 必须是规范整数分字符串（无前导零、非负）；
// - DATETIME 必须是带时区的 ISO 字符串；
// - SINGLE_SELECT 是选项值字符串，MULTI_SELECT 是选项值数组（不得重复）；
// - 单选字段若是豁免语义角色（SERVER_REGION / TARGET_RANK / MODE），库外值放行：
//   预设库只是建议，库外值不加价、按基础价（ADR-0010 决定 4/6）；
// - 只收集「启用区块内的启用组件」的值：停用区块 / 停用组件 / 未知键一律不提交
//   （服务端只认这些键，多送会被判未知字段）；
// - 人数与价格不在这里计算，界面也不展示客户端算出来的数（规格 C-9）。
//
// 纯模块：不依赖 React、DOM、网络与平台 API，便于直接单测。

export type OrderFieldTypeV2 =
  | "TEXT"
  | "TEXTAREA"
  | "NUMBER"
  | "MONEY_FEN"
  | "DATETIME"
  | "SINGLE_SELECT"
  | "MULTI_SELECT";

export type OrderTableColumnTypeV2 = "TEXT" | "NUMBER" | "SINGLE_SELECT";

export interface OrderChoiceOptionLike {
  value: string;
  label: string;
  priceDeltaFen?: string;
}

export interface OrderFieldLike {
  kind: "FIELD";
  stableKey: string;
  sectionKey: string;
  label: string;
  placeholder?: string;
  enabled: boolean;
  sortOrder: number;
  fieldType: OrderFieldTypeV2;
  required: boolean;
  /** 语义角色（发布快照自带）：豁免角色允许库外值，见 ADR-0010 决定 4。 */
  semanticRole?: string | null;
  options?: readonly OrderChoiceOptionLike[];
}

export interface OrderTableColumnLike {
  stableKey: string;
  label: string;
  columnType: OrderTableColumnTypeV2;
  required: boolean;
  options?: readonly OrderChoiceOptionLike[];
}

export interface OrderTableLike {
  kind: "REPEATABLE_TABLE";
  stableKey: string;
  sectionKey: string;
  label: string;
  enabled: boolean;
  sortOrder: number;
  columns: readonly OrderTableColumnLike[];
}

export interface OrderNoteLike {
  kind: "NOTE";
  stableKey: string;
  sectionKey: string;
  label: string;
  enabled: boolean;
  sortOrder: number;
  text: string;
}

export type OrderComponentLike =
  OrderFieldLike | OrderTableLike | OrderNoteLike;

export interface OrderSectionLike {
  stableKey: string;
  label: string;
  enabled: boolean;
  sortOrder: number;
}

// 人数来源：FIXED 不需要值；NUMBER_FIELD / REPEATABLE_TABLE_SUM 指向具体组件。
export interface OrderStaffingSourceLike {
  kind: "FIXED" | "NUMBER_FIELD" | "REPEATABLE_TABLE_SUM";
  componentKey?: string;
  columnKey?: string;
  count?: number;
}

export interface OrderConfigLike {
  sections: readonly OrderSectionLike[];
  components: readonly OrderComponentLike[];
  staffingSource?: OrderStaffingSourceLike;
}

export interface OrderValuesResult {
  values: Record<string, unknown>;
  errors: string[];
}

// 与服务端 MAX_TEMPLATE_STAFFING_COUNT 同口径。
const MAX_STAFFING_COUNT = 500;
const NON_NEGATIVE_FEN = /^(?:0|[1-9][0-9]*)$/;
const MINUTE_PRECISION = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/;

// 豁免语义角色：这些字段的预设选项只是「建议」，库外值照样能提交（不加价、按基础价）。
// 与服务端 game-template-values.ts 的 FREE_INPUT_SEMANTIC_ROLES 保持同一集合（ADR-0010 决定 4）。
export const FREE_INPUT_SEMANTIC_ROLES: ReadonlySet<string> = new Set([
  "SERVER_REGION",
  "TARGET_RANK",
  "MODE",
]);

export function allowsFreeInput(field: {
  semanticRole?: string | null;
}): boolean {
  return (
    field.semanticRole != null &&
    FREE_INPUT_SEMANTIC_ROLES.has(field.semanticRole)
  );
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function asRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is Record<string, unknown> =>
      typeof row === "object" && row !== null && !Array.isArray(row),
  );
}

// 只保留「启用区块内的启用组件」：与服务端 activeComponents 同口径。
export function activeOrderComponents(
  config: OrderConfigLike,
): OrderComponentLike[] {
  const activeSectionKeys = new Set(
    config.sections
      .filter((section) => section.enabled)
      .map((section) => section.stableKey),
  );
  return config.components.filter(
    (component) =>
      component.enabled && activeSectionKeys.has(component.sectionKey),
  );
}

function staffingSourceOf(
  config: OrderConfigLike,
): OrderStaffingSourceLike | undefined {
  const source = config.staffingSource;
  return source === undefined || source.kind === "FIXED" ? undefined : source;
}

// 整行没填的不算一行：避免把用户点了「添加行」但没填的空行当成意图。
// 行号一律用用户看到的原始行号，避免提示与界面对不上。
function rowHasContent(
  table: OrderTableLike,
  row: Record<string, unknown>,
): boolean {
  return table.columns.some((column) => !isBlank(row[column.stableKey]));
}

export interface MissingRequirement {
  // 组件键：用于界面高亮（表格按整表高亮）。
  key: string;
  label: string;
}

// 提交前的必填提示（只针对该端口可见且启用的内容，服务端仍会再校验一次）。
export function missingRequirements(
  config: OrderConfigLike,
  values: Readonly<Record<string, unknown>>,
): MissingRequirement[] {
  const missing: MissingRequirement[] = [];
  const staffing = staffingSourceOf(config);
  for (const component of activeOrderComponents(config)) {
    if (component.kind === "NOTE") continue;
    if (component.kind === "FIELD") {
      if (component.required && isBlank(values[component.stableKey])) {
        missing.push({ key: component.stableKey, label: component.label });
      }
      continue;
    }
    const rows = asRows(values[component.stableKey]);
    const isStaffingTable = staffing?.componentKey === component.stableKey;
    if (rows.every((row) => !rowHasContent(component, row))) {
      if (isStaffingTable) {
        missing.push({ key: component.stableKey, label: component.label });
      }
      continue;
    }
    rows.forEach((row, index) => {
      if (!rowHasContent(component, row)) return;
      for (const column of component.columns) {
        if (!column.required) continue;
        if (isBlank(row[column.stableKey])) {
          missing.push({
            key: component.stableKey,
            label: `${component.label} 第 ${index + 1} 行 ${column.label}`,
          });
        }
      }
    });
  }
  return missing;
}

/** 只给提示文案的调用方：缺什么就报什么。 */
export function missingRequiredLabels(
  config: OrderConfigLike,
  values: Readonly<Record<string, unknown>>,
): string[] {
  return missingRequirements(config, values).map((item) => item.label);
}

type Conversion =
  | { ok: true; value: string | number | string[] }
  | { ok: false; message: string };

function convertDateTime(label: string, raw: string): Conversion {
  const text = raw.trim();
  if (text === "") return { ok: false, message: `请填写 ${label}` };
  // 「2026-09-19 20:00」按本地时区理解；带时区的 ISO 原样接受。
  const parsable = MINUTE_PRECISION.test(text) ? text.replace(" ", "T") : text;
  const parsed = new Date(parsable);
  if (Number.isNaN(parsed.getTime())) {
    return {
      ok: false,
      message: `${label} 需要时间，例如 2026-09-19 20:00`,
    };
  }
  return { ok: true, value: parsed.toISOString() };
}

function convertStaffingCount(label: string, raw: string): Conversion {
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 1 || value > MAX_STAFFING_COUNT) {
    return {
      ok: false,
      message: `${label} 必须是 1-${MAX_STAFFING_COUNT} 的整数`,
    };
  }
  return { ok: true, value };
}

function convertChoice(
  label: string,
  raw: string,
  options: readonly OrderChoiceOptionLike[],
  allowFreeValue: boolean,
): Conversion {
  const value = raw.trim();
  if (!allowFreeValue && !options.some((option) => option.value === value)) {
    return { ok: false, message: `${label} 的值不在模板选项中` };
  }
  return { ok: true, value };
}

function convertFieldValue(
  field: OrderFieldLike,
  raw: unknown,
  isStaffingField: boolean,
): Conversion {
  switch (field.fieldType) {
    case "TEXT":
    case "TEXTAREA": {
      const text = asText(raw).trim();
      return text === ""
        ? { ok: false, message: `请填写 ${field.label}` }
        : { ok: true, value: text };
    }
    case "NUMBER": {
      const text = asText(raw).trim();
      if (isStaffingField) return convertStaffingCount(field.label, text);
      const value = Number(text);
      return Number.isFinite(value)
        ? { ok: true, value }
        : { ok: false, message: `${field.label} 必须是数字` };
    }
    case "MONEY_FEN": {
      const text = asText(raw).trim();
      return NON_NEGATIVE_FEN.test(text)
        ? { ok: true, value: text }
        : { ok: false, message: `${field.label} 必须是非负整数分` };
    }
    case "DATETIME":
      return convertDateTime(field.label, asText(raw));
    case "SINGLE_SELECT":
      return convertChoice(
        field.label,
        asText(raw),
        field.options ?? [],
        allowsFreeInput(field),
      );
    case "MULTI_SELECT": {
      const selected = Array.isArray(raw)
        ? raw.filter((item): item is string => typeof item === "string")
        : [];
      if (selected.length === 0) {
        return { ok: false, message: `请选择 ${field.label}` };
      }
      if (new Set(selected).size !== selected.length) {
        return { ok: false, message: `${field.label} 不能重复选择同一选项` };
      }
      for (const item of selected) {
        // 多选不在豁免范围（ADR-0010 决定 4）：与服务端算价侧的封闭口径一致。
        const converted = convertChoice(
          field.label,
          item,
          field.options ?? [],
          false,
        );
        if (!converted.ok) return converted;
      }
      return { ok: true, value: selected };
    }
    default:
      return { ok: false, message: `${field.label} 的类型暂不支持` };
  }
}

function convertCellValue(
  table: OrderTableLike,
  column: OrderTableColumnLike,
  raw: unknown,
  rowIndex: number,
  isStaffingColumn: boolean,
): Conversion {
  const path = `${table.label} 第 ${rowIndex + 1} 行 ${column.label}`;
  const text = asText(raw).trim();
  if (text === "") {
    return { ok: false, message: `${path} 不能为空` };
  }
  if (column.columnType === "NUMBER") {
    // 只有「人数来源列」才受 1-500 整数约束（服务端 assertStaffingCount 也是只对它生效）；
    // 普通数字列只要求有限数字，别把人数口径硬套到「局数 / 时长」这类字段上。
    if (isStaffingColumn) return convertStaffingCount(path, text);
    const value = Number(text);
    return Number.isFinite(value)
      ? { ok: true, value }
      : { ok: false, message: `${path} 必须是数字` };
  }
  if (column.columnType === "SINGLE_SELECT") {
    // 表格列不属于本批豁免（服务端算价侧同样不覆盖列；文案侧对豁免角色的列已放行）。
    // 移动端此处仍按封闭口径预检，差异登记在 docs/unverified-and-deferred.md。
    return convertChoice(path, text, column.options ?? [], false);
  }
  return { ok: true, value: text };
}

// 草稿值 → 提交体：转换失败的组件不进入提交体，并回报可读错误；
// 上层只要看到 errors 非空就不提交（服务端仍会独立校验）。
export function collectOrderValues(
  config: OrderConfigLike,
  values: Readonly<Record<string, unknown>>,
): OrderValuesResult {
  const collected: Record<string, unknown> = {};
  const errors: string[] = [];
  const staffing = staffingSourceOf(config);

  for (const component of activeOrderComponents(config)) {
    if (component.kind === "NOTE") continue;

    if (component.kind === "FIELD") {
      const raw = values[component.stableKey];
      if (isBlank(raw)) {
        if (component.required) errors.push(`请填写 ${component.label}`);
        continue;
      }
      const converted = convertFieldValue(
        component,
        raw,
        staffing?.kind === "NUMBER_FIELD" &&
          staffing.componentKey === component.stableKey,
      );
      if (!converted.ok) {
        errors.push(converted.message);
        continue;
      }
      collected[component.stableKey] = converted.value;
      continue;
    }

    const isStaffingTable = staffing?.componentKey === component.stableKey;
    const rows = asRows(values[component.stableKey]);
    if (rows.every((row) => !rowHasContent(component, row))) {
      if (isStaffingTable) errors.push(`请至少添加一行 ${component.label}`);
      continue;
    }
    const wireRows: Record<string, unknown>[] = [];
    rows.forEach((row, index) => {
      if (!rowHasContent(component, row)) return;
      const wireRow: Record<string, unknown> = {};
      for (const column of component.columns) {
        const raw = row[column.stableKey];
        const isStaffingColumn =
          isStaffingTable && staffing?.columnKey === column.stableKey;
        if (isBlank(raw)) {
          if (column.required || isStaffingColumn) {
            errors.push(
              `${component.label} 第 ${index + 1} 行 ${column.label} 不能为空`,
            );
          }
          continue;
        }
        const converted = convertCellValue(
          component,
          column,
          raw,
          index,
          isStaffingColumn,
        );
        if (!converted.ok) {
          errors.push(converted.message);
          continue;
        }
        wireRow[column.stableKey] = converted.value;
      }
      wireRows.push(wireRow);
    });
    if (wireRows.length > 0) collected[component.stableKey] = wireRows;
  }

  return { values: collected, errors };
}

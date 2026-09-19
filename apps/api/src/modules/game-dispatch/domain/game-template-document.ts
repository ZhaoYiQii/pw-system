import { parseFenString } from "../../../common/money.js";
import {
  GAME_TEMPLATE_V2_LIMITS,
  type PublishedConfigV2,
  type TemplateChoiceOptionV2,
  type TemplateComponentV2,
  type TemplateFieldComponentV2,
  type TemplateRepeatableTableColumnV2,
  type TemplateRepeatableTableV2,
} from "./game-template-config-v2.js";
import type { TemplateRuntimeValues } from "./game-template-calculations.js";

export const TEMPLATE_DOCUMENT_LIMITS = {
  valueCharacters: 2_000,
  plainTextCharacters: 20_000,
} as const;

export interface DispatchDocumentRowV1 {
  sectionLabel: string;
  fieldLabel: string;
  value: string;
}

export interface DispatchDocumentV1 {
  schemaVersion: 1;
  rendererVersion: 1;
  rows: DispatchDocumentRowV1[];
  plainText: string;
}

export class TemplateDocumentError extends Error {
  constructor(
    public readonly code: "TEMPLATE_VALUE_INVALID",
    public readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = "TemplateDocumentError";
  }
}

function sanitizePlainText(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127 ? " " : character;
  }).join("");
}

function limitedValue(value: string): string {
  const safeValue = sanitizePlainText(value);
  if (safeValue.length <= TEMPLATE_DOCUMENT_LIMITS.valueCharacters) {
    return safeValue;
  }
  return `${safeValue.slice(0, TEMPLATE_DOCUMENT_LIMITS.valueCharacters)}…[已截断]`;
}

function findOption(
  source: {
    stableKey: string;
    label: string;
    options?: readonly TemplateChoiceOptionV2[];
  },
  value: unknown,
  path = `$.values.${source.stableKey}`,
): TemplateChoiceOptionV2 {
  if (typeof value !== "string") {
    throw new TemplateDocumentError(
      "TEMPLATE_VALUE_INVALID",
      path,
      `${source.label}必须选择有效选项`,
    );
  }
  const option = source.options?.find((candidate) => candidate.value === value);
  if (!option) {
    throw new TemplateDocumentError(
      "TEMPLATE_VALUE_INVALID",
      path,
      `${source.label}的值不在模板选项中`,
    );
  }
  return option;
}

function formatTableColumnValue(
  table: TemplateRepeatableTableV2,
  column: TemplateRepeatableTableColumnV2,
  rawValue: unknown,
  rowIndex: number,
): string {
  const path = `$.values.${table.stableKey}[${rowIndex}].${column.stableKey}`;
  if (column.columnType === "SINGLE_SELECT") {
    return limitedValue(findOption(column, rawValue, path).label);
  }
  if (column.columnType === "NUMBER") {
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
      throw new TemplateDocumentError(
        "TEMPLATE_VALUE_INVALID",
        path,
        `${column.label}必须是数字`,
      );
    }
    return String(rawValue);
  }
  if (typeof rawValue !== "string") {
    throw new TemplateDocumentError(
      "TEMPLATE_VALUE_INVALID",
      path,
      `${column.label}必须是文本`,
    );
  }
  return limitedValue(rawValue);
}

function tableRows(
  sectionLabel: string,
  table: TemplateRepeatableTableV2,
  rawValue: unknown,
): DispatchDocumentRowV1[] {
  const submittedRows = rawValue === undefined ? table.defaultRows : rawValue;
  if (
    !Array.isArray(submittedRows) ||
    submittedRows.length > GAME_TEMPLATE_V2_LIMITS.submittedRows
  ) {
    throw new TemplateDocumentError(
      "TEMPLATE_VALUE_INVALID",
      `$.values.${table.stableKey}`,
      `${table.label}必须提交不超过 ${GAME_TEMPLATE_V2_LIMITS.submittedRows} 行的表格`,
    );
  }
  const columnKeys = new Set(table.columns.map((column) => column.stableKey));
  return submittedRows.flatMap((rawRow, rowIndex) => {
    if (
      typeof rawRow !== "object" ||
      rawRow === null ||
      Array.isArray(rawRow)
    ) {
      throw new TemplateDocumentError(
        "TEMPLATE_VALUE_INVALID",
        `$.values.${table.stableKey}[${rowIndex}]`,
        `${table.label}的表格行结构无效`,
      );
    }
    const row = rawRow as Readonly<Record<string, unknown>>;
    if (Object.keys(row).some((key) => !columnKeys.has(key))) {
      throw new TemplateDocumentError(
        "TEMPLATE_VALUE_INVALID",
        `$.values.${table.stableKey}[${rowIndex}]`,
        `${table.label}包含未知列`,
      );
    }
    return table.columns.flatMap((column) => {
      const value = row[column.stableKey];
      if (isEmptyValue(value)) {
        if (column.required) {
          throw new TemplateDocumentError(
            "TEMPLATE_VALUE_INVALID",
            `$.values.${table.stableKey}[${rowIndex}].${column.stableKey}`,
            `请填写${table.label}第 ${rowIndex + 1} 行的${column.label}`,
          );
        }
        return [];
      }
      return [
        {
          sectionLabel,
          fieldLabel: `${table.label}[${rowIndex + 1}] · ${column.label}`,
          value: formatTableColumnValue(table, column, value, rowIndex),
        },
      ];
    });
  });
}

function formatFieldValue(
  field: TemplateFieldComponentV2,
  rawValue: unknown,
): string {
  if (field.fieldType === "SINGLE_SELECT") {
    return limitedValue(findOption(field, rawValue).label);
  }
  if (field.fieldType === "MULTI_SELECT") {
    if (!Array.isArray(rawValue)) {
      throw new TemplateDocumentError(
        "TEMPLATE_VALUE_INVALID",
        `$.values.${field.stableKey}`,
        `${field.label}必须提交选项数组`,
      );
    }
    return limitedValue(
      rawValue.map((value) => findOption(field, value).label).join("、"),
    );
  }
  if (field.fieldType === "NUMBER") {
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
      throw new TemplateDocumentError(
        "TEMPLATE_VALUE_INVALID",
        `$.values.${field.stableKey}`,
        `${field.label}必须是数字`,
      );
    }
    return String(rawValue);
  }
  if (field.fieldType === "MONEY_FEN") {
    const moneyFen = parseFenString(rawValue, true);
    if (moneyFen === null) {
      throw new TemplateDocumentError(
        "TEMPLATE_VALUE_INVALID",
        `$.values.${field.stableKey}`,
        `${field.label}必须是规范整数分`,
      );
    }
    return `${moneyFen} 分`;
  }
  if (field.fieldType === "DATETIME") {
    if (
      typeof rawValue !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(
        rawValue,
      )
    ) {
      throw new TemplateDocumentError(
        "TEMPLATE_VALUE_INVALID",
        `$.values.${field.stableKey}`,
        `${field.label}必须是包含时区的 ISO 时间`,
      );
    }
    const timestamp = Date.parse(rawValue);
    if (!Number.isFinite(timestamp)) {
      throw new TemplateDocumentError(
        "TEMPLATE_VALUE_INVALID",
        `$.values.${field.stableKey}`,
        `${field.label}必须是 ISO 时间`,
      );
    }
    return new Date(timestamp).toISOString();
  }
  if (typeof rawValue !== "string") {
    throw new TemplateDocumentError(
      "TEMPLATE_VALUE_INVALID",
      `$.values.${field.stableKey}`,
      `${field.label}必须是文本`,
    );
  }
  return limitedValue(rawValue);
}

function isEmptyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function componentRows(
  sectionLabel: string,
  component: TemplateComponentV2,
  values: TemplateRuntimeValues,
): DispatchDocumentRowV1[] {
  if (component.kind === "NOTE") {
    return [
      {
        sectionLabel,
        fieldLabel: component.label,
        value: limitedValue(component.text),
      },
    ];
  }
  if (component.kind === "REPEATABLE_TABLE") {
    return tableRows(sectionLabel, component, values[component.stableKey]);
  }

  const runtimeKind = (component as { kind: string }).kind;
  if (runtimeKind !== "FIELD") {
    return [
      {
        sectionLabel,
        fieldLabel: component.label,
        value: `[不支持的组件：${limitedValue(runtimeKind)}]`,
      },
    ];
  }
  const field = component as TemplateFieldComponentV2;

  const rawValue = values[field.stableKey];
  if (isEmptyValue(rawValue)) {
    if (field.required) {
      throw new TemplateDocumentError(
        "TEMPLATE_VALUE_INVALID",
        `$.values.${field.stableKey}`,
        `请填写${field.label}`,
      );
    }
    return [];
  }
  return [
    {
      sectionLabel,
      fieldLabel: field.label,
      value: formatFieldValue(field, rawValue),
    },
  ];
}

function renderPlainText(rows: readonly DispatchDocumentRowV1[]): string {
  const lines: string[] = [];
  let currentSection: string | undefined;
  for (const row of rows) {
    if (row.sectionLabel !== currentSection) {
      if (lines.length > 0) lines.push("");
      currentSection = row.sectionLabel;
      lines.push(`【${row.sectionLabel}】`);
    }
    lines.push(`${row.fieldLabel}：${row.value}`);
  }
  const plainText = lines.join("\n");
  if (plainText.length <= TEMPLATE_DOCUMENT_LIMITS.plainTextCharacters) {
    return plainText;
  }
  const marker = "…[已截断]";
  return `${plainText.slice(
    0,
    TEMPLATE_DOCUMENT_LIMITS.plainTextCharacters - marker.length,
  )}${marker}`;
}

export function renderDispatchDocument(
  config: PublishedConfigV2,
  values: TemplateRuntimeValues,
): DispatchDocumentV1 {
  const activeSectionKeys = new Set(
    config.sections
      .filter((section) => section.enabled)
      .map((section) => section.stableKey),
  );
  const allowedValueKeys = new Set(
    config.components
      .filter(
        (component) =>
          component.enabled &&
          activeSectionKeys.has(component.sectionKey) &&
          (component.kind === "FIELD" || component.kind === "REPEATABLE_TABLE"),
      )
      .map((component) => component.stableKey),
  );
  for (const key of Object.keys(values)) {
    if (!allowedValueKeys.has(key)) {
      throw new TemplateDocumentError(
        "TEMPLATE_VALUE_INVALID",
        `$.values.${key}`,
        `未知字段：${key}`,
      );
    }
  }

  const componentsBySection = new Map<string, TemplateComponentV2[]>();
  for (const component of config.components) {
    if (!component.enabled || !activeSectionKeys.has(component.sectionKey)) {
      continue;
    }
    const components = componentsBySection.get(component.sectionKey) ?? [];
    components.push(component);
    componentsBySection.set(component.sectionKey, components);
  }

  const rows = config.sections
    .filter((section) => section.enabled)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .flatMap((section) =>
      (componentsBySection.get(section.stableKey) ?? [])
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .flatMap((component) =>
          componentRows(section.label, component, values),
        ),
    );

  return {
    schemaVersion: 1,
    rendererVersion: 1,
    rows,
    plainText: renderPlainText(rows),
  };
}

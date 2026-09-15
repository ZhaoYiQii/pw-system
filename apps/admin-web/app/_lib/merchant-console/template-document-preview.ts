/**
 * 自动文案的前端镜像（S3 Task 5）。
 *
 * 为什么需要镜像：编辑器要在**没有订单**的情况下预览"派单文案长什么样"。
 * 规则逐条对齐服务端 `apps/api/.../game-template-document.ts`：
 * 区块/组件顺序、选择项显示选项名、金额 `N 分`、时间归一化为 UTC、
 * 值 2000 字符与纯文本 20000 字符的 `…[已截断]`、未知旧组件安全占位。
 *
 * 边界：服务端仍是唯一事实源；预览只用于界面展示，
 * 价格等编辑器提示放在 note 字段里，绝不进入文案 value/plainText。
 */
import type {
  DraftChoiceOptionV2,
  DraftConfigV2,
  DraftFieldComponentV2,
  DraftTableComponentV2,
  DraftTableColumnV2,
} from "./template-draft-state";

export const TEMPLATE_DOCUMENT_LIMITS = {
  valueCharacters: 2_000,
  plainTextCharacters: 20_000,
} as const;

export interface PreviewRow {
  sectionLabel: string;
  fieldLabel: string;
  value: string;
  /** 仅编辑器预览使用，不进入文案（例如选项加价提示）。 */
  note?: string;
}

export interface PreviewDocument {
  rows: PreviewRow[];
  plainText: string;
}

export class PreviewDocumentError extends Error {
  constructor(
    readonly code: "TEMPLATE_VALUE_INVALID",
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = "PreviewDocumentError";
  }
}

function sanitizePlainText(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127 ? " " : character;
  }).join("");
}

function limitedValue(value: string): string {
  const safe = sanitizePlainText(value);
  if (safe.length <= TEMPLATE_DOCUMENT_LIMITS.valueCharacters) return safe;
  return `${safe.slice(0, TEMPLATE_DOCUMENT_LIMITS.valueCharacters)}…[已截断]`;
}

function isEmptyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function findOption(
  source: {
    stableKey: string;
    label: string;
    options?: DraftChoiceOptionV2[];
  },
  value: unknown,
  path: string,
): DraftChoiceOptionV2 {
  if (typeof value !== "string") {
    throw new PreviewDocumentError(
      "TEMPLATE_VALUE_INVALID",
      path,
      `${source.label}必须选择有效选项`,
    );
  }
  const option = source.options?.find((candidate) => candidate.value === value);
  if (!option) {
    throw new PreviewDocumentError(
      "TEMPLATE_VALUE_INVALID",
      path,
      `${source.label}的值不在模板选项中`,
    );
  }
  return option;
}

function formatColumnValue(
  table: DraftTableComponentV2,
  column: DraftTableColumnV2,
  rawValue: unknown,
  rowIndex: number,
): string {
  const path = `$.values.${table.stableKey}[${rowIndex}].${column.stableKey}`;
  if (column.columnType === "SINGLE_SELECT") {
    return limitedValue(findOption(column, rawValue, path).label);
  }
  if (column.columnType === "NUMBER") {
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
      throw new PreviewDocumentError(
        "TEMPLATE_VALUE_INVALID",
        path,
        `${column.label}必须是数字`,
      );
    }
    return String(rawValue);
  }
  if (typeof rawValue !== "string") {
    throw new PreviewDocumentError(
      "TEMPLATE_VALUE_INVALID",
      path,
      `${column.label}必须是文本`,
    );
  }
  return limitedValue(rawValue);
}

function tableRows(
  sectionLabel: string,
  table: DraftTableComponentV2,
  rawValue: unknown,
): PreviewRow[] {
  const submitted = rawValue === undefined ? table.defaultRows : rawValue;
  if (!Array.isArray(submitted) || submitted.length > 50) {
    throw new PreviewDocumentError(
      "TEMPLATE_VALUE_INVALID",
      `$.values.${table.stableKey}`,
      `${table.label}必须提交不超过 50 行的表格`,
    );
  }
  const columnKeys = new Set(table.columns.map((column) => column.stableKey));
  return submitted.flatMap((rawRow, rowIndex) => {
    if (
      typeof rawRow !== "object" ||
      rawRow === null ||
      Array.isArray(rawRow)
    ) {
      throw new PreviewDocumentError(
        "TEMPLATE_VALUE_INVALID",
        `$.values.${table.stableKey}[${rowIndex}]`,
        `${table.label}的表格行结构无效`,
      );
    }
    const row = rawRow as Record<string, unknown>;
    if (Object.keys(row).some((key) => !columnKeys.has(key))) {
      throw new PreviewDocumentError(
        "TEMPLATE_VALUE_INVALID",
        `$.values.${table.stableKey}[${rowIndex}]`,
        `${table.label}包含未知列`,
      );
    }
    return table.columns.flatMap((column) => {
      const value = row[column.stableKey];
      if (isEmptyValue(value)) {
        if (column.required) {
          throw new PreviewDocumentError(
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
          value: formatColumnValue(table, column, value, rowIndex),
        },
      ];
    });
  });
}

function formatFieldValue(
  field: DraftFieldComponentV2,
  rawValue: unknown,
): string {
  if (field.fieldType === "SINGLE_SELECT") {
    return limitedValue(
      findOption(field, rawValue, `$.values.${field.stableKey}`).label,
    );
  }
  if (field.fieldType === "MULTI_SELECT") {
    if (!Array.isArray(rawValue)) {
      throw new PreviewDocumentError(
        "TEMPLATE_VALUE_INVALID",
        `$.values.${field.stableKey}`,
        `${field.label}必须提交选项数组`,
      );
    }
    return limitedValue(
      rawValue
        .map(
          (value) =>
            findOption(field, value, `$.values.${field.stableKey}`).label,
        )
        .join("、"),
    );
  }
  if (field.fieldType === "NUMBER") {
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
      throw new PreviewDocumentError(
        "TEMPLATE_VALUE_INVALID",
        `$.values.${field.stableKey}`,
        `${field.label}必须是数字`,
      );
    }
    return String(rawValue);
  }
  if (field.fieldType === "MONEY_FEN") {
    const moneyFen =
      typeof rawValue === "string" && /^(?:0|[1-9][0-9]*)$/.test(rawValue)
        ? rawValue
        : null;
    if (moneyFen === null) {
      throw new PreviewDocumentError(
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
      throw new PreviewDocumentError(
        "TEMPLATE_VALUE_INVALID",
        `$.values.${field.stableKey}`,
        `${field.label}必须是包含时区的 ISO 时间`,
      );
    }
    const timestamp = Date.parse(rawValue);
    if (!Number.isFinite(timestamp)) {
      throw new PreviewDocumentError(
        "TEMPLATE_VALUE_INVALID",
        `$.values.${field.stableKey}`,
        `${field.label}必须是 ISO 时间`,
      );
    }
    return new Date(timestamp).toISOString();
  }
  if (typeof rawValue !== "string") {
    throw new PreviewDocumentError(
      "TEMPLATE_VALUE_INVALID",
      `$.values.${field.stableKey}`,
      `${field.label}必须是文本`,
    );
  }
  return limitedValue(rawValue);
}

function renderPlainText(rows: readonly PreviewRow[]): string {
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

function componentRows(
  sectionLabel: string,
  component: DraftConfigV2["components"][number],
  values: Record<string, unknown>,
  lenient: boolean,
): PreviewRow[] {
  try {
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
          fieldLabel: (component as { label: string }).label,
          value: `[不支持的组件：${limitedValue(runtimeKind)}]`,
        },
      ];
    }
    const field = component as DraftFieldComponentV2;
    const rawValue = values[field.stableKey];
    if (isEmptyValue(rawValue)) {
      if (field.required && !lenient) {
        throw new PreviewDocumentError(
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
  } catch (error) {
    if (!lenient) throw error;
    const message = error instanceof Error ? error.message : "无法预览";
    return [
      {
        sectionLabel,
        fieldLabel: (component as { label: string }).label,
        value: "[无法预览]",
        note: message,
      },
    ];
  }
}

/** 与服务端同规则的渲染（strict 模式用于验证一致性；lenient 用于草稿预览）。 */
export function renderTemplateDocument(
  config: DraftConfigV2,
  values: Record<string, unknown>,
  options: { lenient?: boolean } = {},
): PreviewDocument {
  const lenient = options.lenient === true;
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
  if (!lenient) {
    for (const key of Object.keys(values)) {
      if (!allowedValueKeys.has(key)) {
        throw new PreviewDocumentError(
          "TEMPLATE_VALUE_INVALID",
          `$.values.${key}`,
          `未知字段：${key}`,
        );
      }
    }
  }

  const componentsBySection = new Map<string, DraftConfigV2["components"]>();
  for (const component of config.components) {
    if (!component.enabled || !activeSectionKeys.has(component.sectionKey))
      continue;
    const list = componentsBySection.get(component.sectionKey) ?? [];
    list.push(component);
    componentsBySection.set(component.sectionKey, list);
  }

  const rows = [...config.sections]
    .filter((section) => section.enabled)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .flatMap((section) =>
      (componentsBySection.get(section.stableKey) ?? [])
        .slice()
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .flatMap((component) =>
          componentRows(section.label, component, values, lenient),
        ),
    );

  return { rows, plainText: renderPlainText(rows) };
}

/** 草稿预览：无订单时用示例值填充，并给选择项加上价提示（note，不进文案）。 */
export function previewTemplateDocument(
  config: DraftConfigV2,
): PreviewDocument {
  const activeSectionKeys = new Set(
    config.sections
      .filter((section) => section.enabled)
      .map((section) => section.stableKey),
  );
  const samples: Record<string, unknown> = {};
  for (const component of config.components) {
    if (!component.enabled || !activeSectionKeys.has(component.sectionKey))
      continue;
    if (component.kind === "FIELD") {
      if (component.fieldType === "SINGLE_SELECT") {
        const first = component.options?.[0];
        if (first) samples[component.stableKey] = first.value;
      } else if (component.fieldType === "MULTI_SELECT") {
        const first = component.options?.[0];
        if (first) samples[component.stableKey] = [first.value];
      } else if (component.fieldType === "NUMBER") {
        samples[component.stableKey] = 1;
      } else if (component.fieldType === "MONEY_FEN") {
        samples[component.stableKey] = "0";
      } else if (component.fieldType === "DATETIME") {
        samples[component.stableKey] = new Date().toISOString();
      } else {
        samples[component.stableKey] = "（待填写）";
      }
    }
    // 可重复表格不给值：渲染时自动使用模板里的默认行
  }

  const document = renderTemplateDocument(config, samples, { lenient: true });
  const rows = document.rows.map((row) => {
    const component = config.components.find(
      (candidate) =>
        candidate.kind !== "NOTE" &&
        candidate.label !== "" &&
        row.fieldLabel.startsWith(candidate.label),
    );
    if (component?.kind !== "FIELD") return row;
    const option = component.options?.find(
      (candidate) => candidate.label === row.value,
    );
    if (!option?.priceDeltaFen || option.priceDeltaFen === "0") return row;
    return {
      ...row,
      note: `选项加价 +${option.priceDeltaFen} 分（发布后由服务端计入）`,
    };
  });
  return { rows, plainText: document.plainText };
}

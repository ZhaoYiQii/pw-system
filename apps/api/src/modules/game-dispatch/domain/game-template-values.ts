export interface TemplateValueSection {
  id: string;
  enabled: boolean;
  sortOrder: number;
}

export interface TemplateValueField {
  fieldKey: string;
  label: string;
  fieldType: string;
  required: boolean;
  enabled: boolean;
  sectionId: string | null;
  options: unknown;
}

/** 创建派单只消费启用区块中的启用填写字段。 */
export function activeTemplateFields<T extends TemplateValueField>(
  sections: readonly TemplateValueSection[],
  fields: readonly T[],
): T[] {
  if (sections.length === 0) {
    return fields.filter(
      (field) =>
        field.enabled &&
        field.fieldType !== "duration" &&
        field.fieldType !== "note",
    );
  }
  const sortedSections = [...sections].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  const firstSectionId = sortedSections[0]?.id ?? "";
  const activeSectionIds = new Set(
    sortedSections
      .filter((section) => section.enabled)
      .map((section) => section.id),
  );
  return fields.filter(
    (field) =>
      field.enabled &&
      field.fieldType !== "duration" &&
      field.fieldType !== "note" &&
      activeSectionIds.has(field.sectionId ?? firstSectionId),
  );
}

/** 只接收模板当前允许填写的键，避免停用字段或任意客户端键进入订单数据。 */
export function activeTemplateValues(
  fields: readonly TemplateValueField[],
  values: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const activeKeys = new Set(fields.map((field) => field.fieldKey));
  return Object.fromEntries(
    Object.entries(values).filter(
      (entry): entry is [string, string] =>
        activeKeys.has(entry[0]) && typeof entry[1] === "string",
    ),
  );
}

/** 返回可直接呈现给客服的第一个校验错误；null 表示值满足模板。 */
export function templateFormValueError(
  fields: readonly TemplateValueField[],
  values: Readonly<Record<string, unknown>>,
): string | null {
  for (const field of fields) {
    const raw = values[field.fieldKey];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (field.required && !value) return `请填写${field.label}`;
    if (
      value &&
      field.fieldType === "select" &&
      (!Array.isArray(field.options) || !field.options.includes(value))
    ) {
      return `${field.label}的值不在模板选项中`;
    }
  }
  return null;
}

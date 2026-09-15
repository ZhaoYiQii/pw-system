"use client";

import { cn } from "@/lib/utils";
import {
  clampColumns,
  columnSpanLabel,
  fieldsForSection,
  formSections,
  formSectionStyle,
  layoutFormRows,
  layoutV2Rows,
  type FormFieldLike,
  type FormSectionLike,
} from "./form-layout";
import type { DraftComponentV2, DraftSectionV2 } from "./template-draft-state";

export interface TemplateFormField extends FormFieldLike {
  label: string;
  options?: string[];
  placeholder?: string | null;
}

export interface TemplateFormSection extends FormSectionLike {
  name: string;
  columns: number;
}

export function TemplateFormRenderer({
  sections,
  fields,
  blockLabels,
  values = {},
  disabled = false,
  onValueChange,
}: {
  sections: readonly TemplateFormSection[];
  fields: readonly TemplateFormField[];
  blockLabels?: Record<string, unknown> | undefined;
  values?: Readonly<Record<string, string>>;
  disabled?: boolean;
  onValueChange?: (fieldKey: string, value: string) => void;
}) {
  const visibleSections = formSections(sections);

  return (
    <div className="mc-template-form">
      {visibleSections.map((section) => {
        const sectionFields = fieldsForSection(
          section,
          visibleSections,
          fields,
        );
        if (sectionFields.length === 0) return null;
        const columns = clampColumns(section.columns ?? 2);
        const name = section.name ?? "";
        const style = formSectionStyle(blockLabels, name);
        return (
          <section
            className={`mc-form-section is-${style.variant} is-${style.density} is-align-${style.align}`}
            key={section.id || "default"}
          >
            {name ? <div className="mc-form-section-head">{name}</div> : null}
            {layoutFormRows(sectionFields, columns).map((row, rowIndex) => (
              <div
                className="mc-form-grid"
                key={`${section.id || "default"}-row-${rowIndex}`}
                style={{
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                }}
              >
                {row.map(({ field, span }) => {
                  const label = (
                    <span>
                      {field.label}
                      {field.required ? " *" : ""}
                    </span>
                  );
                  if (field.fieldType === "note") {
                    return (
                      <div
                        className="mc-field mc-preview-note"
                        key={field.fieldKey}
                        style={{ gridColumn: `span ${span}` }}
                      >
                        {field.placeholder || field.label}
                      </div>
                    );
                  }
                  return (
                    <label
                      className="mc-field"
                      key={field.fieldKey}
                      style={{ gridColumn: `span ${span}` }}
                    >
                      {label}
                      {field.fieldType === "multiline" ? (
                        <textarea
                          name={field.fieldKey}
                          value={values[field.fieldKey] ?? ""}
                          placeholder={field.placeholder ?? undefined}
                          disabled={disabled}
                          aria-required={field.required || undefined}
                          onChange={(event) =>
                            onValueChange?.(field.fieldKey, event.target.value)
                          }
                        />
                      ) : field.fieldType === "select" ? (
                        <select
                          name={field.fieldKey}
                          value={values[field.fieldKey] ?? ""}
                          disabled={disabled}
                          aria-required={field.required || undefined}
                          onChange={(event) =>
                            onValueChange?.(field.fieldKey, event.target.value)
                          }
                        >
                          <option value="">请选择…</option>
                          {(field.options ?? []).map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          name={field.fieldKey}
                          type={
                            field.fieldType === "datetime"
                              ? "datetime-local"
                              : "text"
                          }
                          value={values[field.fieldKey] ?? ""}
                          placeholder={field.placeholder ?? undefined}
                          disabled={disabled}
                          aria-required={field.required || undefined}
                          onChange={(event) =>
                            onValueChange?.(field.fieldKey, event.target.value)
                          }
                        />
                      )}
                    </label>
                  );
                })}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * v2 通用模板渲染（S3）：FIELD / REPEATABLE_TABLE / NOTE，按区块列数装箱。
 * 与 v1 的 TemplateFormRenderer 并存：旧调用方（新建派单页）继续用 v1。
 * ------------------------------------------------------------------ */

export interface TemplateDraftRendererProps {
  sections: DraftSectionV2[];
  components: DraftComponentV2[];
  /** 编辑器需要看到停用项；预览默认不显示。 */
  includeDisabled?: boolean;
  className?: string;
}

export function TemplateDraftRenderer({
  sections,
  components,
  includeDisabled = false,
  className,
}: TemplateDraftRendererProps) {
  const layout = layoutV2Rows(sections, components, { includeDisabled });
  if (layout.length === 0) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        还没有内容区块。先添加一个分区，再往里加字段。
      </p>
    );
  }
  return (
    <div className={cn("space-y-6", className)}>
      {layout.map(({ section, columns, rows }) => (
        <section key={section.stableKey} className="space-y-2">
          <header className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">
              {section.label}
              {section.enabled ? "" : "（已停用）"}
            </h3>
            <span className="font-mono text-xs text-muted-foreground">
              {columns} 列
            </span>
          </header>
          {rows.length === 0 ? (
            <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              这个区块还是空的。
            </p>
          ) : null}
          <div className="space-y-2">
            {rows.map((row, rowIndex) => (
              <div
                key={`${section.stableKey}-row-${rowIndex}`}
                className="grid gap-2"
                style={{
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                }}
              >
                {row.components.map((component) => {
                  const span = Math.min(
                    Math.max(Math.trunc(component.layout.colSpan), 1),
                    columns,
                  );
                  const disabled = !component.enabled;
                  return (
                    <div
                      key={component.stableKey}
                      style={{ gridColumn: `span ${span} / span ${span}` }}
                      className={cn(
                        "rounded-lg border p-3",
                        disabled &&
                          "border-dashed bg-muted/40 text-muted-foreground",
                      )}
                    >
                      <p className="flex items-center justify-between gap-2 text-sm font-medium">
                        <span>{component.label}</span>
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {columnSpanLabel(columns, component.layout.colSpan)}
                        </span>
                      </p>
                      {component.description ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {component.description}
                        </p>
                      ) : null}
                      {component.kind === "NOTE" ? (
                        <p className="mt-2 whitespace-pre-wrap text-xs">
                          {component.text}
                        </p>
                      ) : null}
                      {component.kind === "FIELD" ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {component.fieldType}
                          {component.required ? " · 必填" : ""}
                          {component.semanticRole === "CUSTOM"
                            ? ""
                            : ` · ${component.semanticRole}`}
                          {component.options && component.options.length > 0
                            ? ` · ${component.options.length} 个选项`
                            : ""}
                        </p>
                      ) : null}
                      {component.kind === "REPEATABLE_TABLE" ? (
                        <div className="mt-2 overflow-hidden rounded border">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-muted">
                              <tr>
                                {component.columns.map((column) => (
                                  <th
                                    key={column.stableKey}
                                    className="px-2 py-1 font-medium"
                                  >
                                    {column.label}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {component.defaultRows.map((row, index) => (
                                <tr key={`${component.stableKey}-row-${index}`}>
                                  {component.columns.map((column) => (
                                    <td
                                      key={column.stableKey}
                                      className="px-2 py-1"
                                    >
                                      {String(row[column.stableKey] ?? "")}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

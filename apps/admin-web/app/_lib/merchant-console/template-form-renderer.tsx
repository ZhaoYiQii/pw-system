"use client";

import { cn } from "@/lib/utils";
import {
  clampColumns,
  fieldsForSection,
  formSections,
  formSectionStyle,
  layoutFormRows,
  layoutV2Rows,
  type FormFieldLike,
  type FormSectionLike,
} from "./form-layout";
import type { DraftComponentV2, DraftSectionV2 } from "./template-draft-state";
import { fenToYuanInput } from "./template-editor-meta";

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

/** 只读预览给输入框的提示：不暴露字段类型枚举。 */
const PREVIEW_HINTS: Record<string, string> = {
  TEXT: "请填写",
  TEXTAREA: "请填写",
  NUMBER: "请填写数字",
  MONEY_FEN: "¥ 0.00",
  DATETIME: "选择日期时间",
  SINGLE_SELECT: "请选择",
  MULTI_SELECT: "请选择",
};

export interface TemplateDraftRendererProps {
  sections: DraftSectionV2[];
  components: DraftComponentV2[];
  /** 编辑器需要看到停用项；预览默认不显示。 */
  includeDisabled?: boolean;
  className?: string;
  /** 与编辑器清单共用同一套编号；传入后每个组件左上角显示编号。 */
  numberOf?: (stableKey: string) => number | undefined;
  /** 当前与编辑器联动高亮的组件。 */
  activeKey?: string | null;
  /** 鼠标进出组件时回报给编辑器，实现双向联动。 */
  onHoverComponent?: (stableKey: string | null) => void;
}

export function TemplateDraftRenderer({
  sections,
  components,
  includeDisabled = false,
  className,
  numberOf,
  activeKey = null,
  onHoverComponent,
}: TemplateDraftRendererProps) {
  const layout = layoutV2Rows(sections, components, { includeDisabled });
  if (layout.length === 0) {
    return (
      <p className={cn("mc-preview-empty", className)}>
        还没有内容。加上字段后，这里会显示客户看到的样子。
      </p>
    );
  }
  return (
    <div className={cn("mc-preview", className)}>
      {layout.map(({ section, columns, rows }) => (
        <section key={section.stableKey} className="mc-preview-group">
          <header className="mc-preview-grouphead">
            <h3>{section.label || "未命名分组"}</h3>
            {section.enabled ? null : (
              <span className="mc-preview-off">已停用</span>
            )}
          </header>
          {rows.length === 0 ? (
            <p className="mc-preview-empty">这个分组还是空的。</p>
          ) : null}
          <div className="mc-preview-rows">
            {rows.map((row, rowIndex) => (
              <div
                key={`${section.stableKey}-row-${rowIndex}`}
                className="mc-preview-row"
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
                  const previewRows =
                    component.kind === "REPEATABLE_TABLE"
                      ? Math.max(
                          1,
                          Math.min(component.defaultRows.length || 1, 3),
                        )
                      : 0;
                  return (
                    <div
                      key={component.stableKey}
                      data-component-key={component.stableKey}
                      data-preview-item={component.stableKey}
                      style={{ gridColumn: `span ${span} / span ${span}` }}
                      onMouseEnter={() =>
                        onHoverComponent?.(component.stableKey)
                      }
                      onMouseLeave={() => onHoverComponent?.(null)}
                      className={cn(
                        "mc-preview-item",
                        disabled && "is-off",
                        activeKey === component.stableKey && "is-active",
                      )}
                    >
                      {component.kind === "NOTE" ? null : (
                        <p className="mc-preview-label">
                          {typeof numberOf?.(component.stableKey) ===
                          "number" ? (
                            <span
                              data-preview-number={component.stableKey}
                              className="mc-preview-no"
                            >
                              {numberOf(component.stableKey)}
                            </span>
                          ) : null}
                          {component.label || "未命名内容"}
                          {component.kind === "FIELD" && component.required ? (
                            <em>*</em>
                          ) : null}
                        </p>
                      )}
                      {component.description ? (
                        <p className="mc-preview-hint">
                          {component.description}
                        </p>
                      ) : null}
                      {component.kind === "NOTE" ? (
                        <p className="mc-preview-note">
                          {component.text || "（说明是空的）"}
                        </p>
                      ) : null}
                      {component.kind === "FIELD" ? (
                        component.fieldType === "SINGLE_SELECT" ||
                        component.fieldType === "MULTI_SELECT" ? (
                          <div className="mc-preview-choices">
                            {(component.options ?? []).length === 0 ? (
                              <span className="mc-preview-hint">
                                还没有选项
                              </span>
                            ) : null}
                            {(component.options ?? []).map((option) => (
                              <span
                                key={option.value}
                                className="mc-preview-choice"
                              >
                                {option.label || "未命名选项"}
                                {option.priceDeltaFen === undefined ? null : (
                                  <i>
                                    +¥{fenToYuanInput(option.priceDeltaFen)}
                                  </i>
                                )}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div
                            className={cn(
                              "mc-preview-stub",
                              component.fieldType === "TEXTAREA" && "is-area",
                            )}
                          >
                            {component.placeholder ||
                              PREVIEW_HINTS[component.fieldType] ||
                              "请填写"}
                          </div>
                        )
                      ) : null}
                      {component.kind === "REPEATABLE_TABLE" ? (
                        <div className="mc-preview-table">
                          <div className="mc-preview-thead">
                            {component.columns.length === 0 ? (
                              <span>还没有列</span>
                            ) : null}
                            {component.columns.map((column) => (
                              <span key={column.stableKey}>
                                {column.label || "未命名列"}
                                {column.required ? " *" : ""}
                              </span>
                            ))}
                          </div>
                          {[...Array(previewRows).keys()].map((index) => (
                            <div
                              key={`${component.stableKey}-prow-${index}`}
                              className="mc-preview-trow"
                            >
                              {component.columns.map((column) => (
                                <span key={column.stableKey}>
                                  {column.columnType === "NUMBER"
                                    ? "0"
                                    : "请填写"}
                                </span>
                              ))}
                            </div>
                          ))}
                          <div className="mc-preview-tadd">＋ 添加一行</div>
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

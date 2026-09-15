"use client";

/**
 * 「内容设计」标签：区块与组件的结构化编辑器（S3 Task 3）。
 *
 * 约束：
 * - 所有编辑走 template-draft-state 的纯函数；
 * - 禁用保留配置、只有显式删除才移除；
 * - 删除被“人数来源”引用的组件/列/区块会被阻止，并把原因交给调用方播报；
 * - 选项加价（分/元）与人数来源选择的完整 UX 在 Task 4，这里先保留数据不改语义。
 */
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { columnSpanLabel, layoutV2Rows } from "./form-layout";
import { announceOrderChange, focusSelectorAfterMove } from "./template-a11y";
import {
  addComponent,
  addDefaultRow,
  addSection,
  addTableColumn,
  guardRemoveComponent,
  insertPreset,
  moveComponent,
  moveSection,
  removeComponent,
  removeDefaultRow,
  removeSection,
  removeTableColumn,
  setComponentOptions,
  setDefaultRowValue,
  toggleComponentEnabled,
  updateComponent,
  updateSection,
  updateTableColumn,
  type DraftComponentV2,
  type DraftConfigV2,
  type DraftFieldComponentV2,
  type DraftPreset,
  type DraftSectionV2,
  type DraftTableComponentV2,
} from "./template-draft-state";

type Section = DraftSectionV2;
type Component = DraftComponentV2;
type TableComponent = DraftTableComponentV2;
type FieldComponent = DraftFieldComponentV2;

const FIELD_TYPE_LABELS: Record<FieldComponent["fieldType"], string> = {
  TEXT: "单行文本",
  TEXTAREA: "多行文本",
  NUMBER: "数字",
  MONEY_FEN: "金额（分）",
  DATETIME: "日期时间",
  SINGLE_SELECT: "单选",
  MULTI_SELECT: "多选",
};

const SEMANTIC_ROLE_LABELS: Record<FieldComponent["semanticRole"], string> = {
  CUSTOM: "自定义（不参与业务计算）",
  MODE: "模式",
  TARGET_RANK: "目标段位",
  CURRENT_RANK: "当前段位",
  DURATION_MINUTES: "时长（分钟）",
  SERVER_REGION: "区服",
  CONTACT: "联系方式",
  ORDER_NOTE: "订单备注",
  STAFFING_LABEL: "岗位名称",
  STAFFING_COUNT: "人数",
};

export interface TemplateEditorContentProps {
  draft: DraftConfigV2;
  onChange: (next: DraftConfigV2) => void;
  onNotice: (message: string) => void;
}

export function TemplateEditorContent({
  draft,
  onChange,
  onNotice,
}: TemplateEditorContentProps) {
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);

  /** 键盘/鼠标移动后把焦点放回同一个按钮，避免焦点跳到页面顶部。 */
  useEffect(() => {
    if (!pendingFocus) return;
    const target = document.querySelector<HTMLElement>(pendingFocus);
    target?.focus();
    setPendingFocus(null);
  }, [draft, pendingFocus]);

  const moveSectionBy = (sectionKey: string, direction: "up" | "down") => {
    setPendingFocus(focusSelectorAfterMove("section", sectionKey, direction));
    onNotice(
      announceOrderChange(
        draft.sections.map((item) => ({
          stableKey: item.stableKey,
          label: item.label,
        })),
        sectionKey,
        direction,
      ),
    );
    onChange(moveSection(draft, sectionKey, direction));
  };

  const moveComponentBy = (component: Component, direction: "up" | "down") => {
    setPendingFocus(
      focusSelectorAfterMove("component", component.stableKey, direction),
    );
    onNotice(
      announceOrderChange(
        draft.components
          .filter((item) => item.sectionKey === component.sectionKey)
          .map((item) => ({ stableKey: item.stableKey, label: item.label })),
        component.stableKey,
        direction,
      ),
    );
    onChange(moveComponent(draft, component.stableKey, direction));
  };

  const applyPreset = (sectionKey: string, preset: DraftPreset) => {
    const result = insertPreset(draft, sectionKey, preset);
    if (!result.ok) {
      onNotice(result.reason);
      return;
    }
    onChange(result.config);
  };

  const addNewSection = () => {
    const result = addSection(draft, { label: "新分区", columns: 2 });
    if (!result.ok) {
      onNotice(result.reason);
      return;
    }
    onChange(result.config);
    onNotice(`已添加区块「新分区」。`);
  };

  const deleteSection = (section: Section) => {
    const result = removeSection(draft, section.stableKey);
    if (!result.ok) {
      onNotice(result.reason);
      return;
    }
    onChange(result.config);
  };

  const addTo = (section: Section, kind: Component["kind"]) => {
    const result = addComponent(draft, kind, section.stableKey);
    if (!result.ok) {
      onNotice(result.reason);
      return;
    }
    onChange(result.config);
  };

  const deleteComponent = (component: Component) => {
    const guard = guardRemoveComponent(draft, component.stableKey);
    if (!guard.ok) {
      onNotice(guard.reason);
      return;
    }
    onChange(removeComponent(draft, component.stableKey));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={addNewSection}>
          + 新分区
        </Button>
        <span className="text-xs text-muted-foreground">
          参考预设（插入后就是普通组件，可继续改名/禁用/删除）：
        </span>
        {draft.sections[0] ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                applyPreset(draft.sections[0]!.stableKey, "STAFFING_TABLE")
              }
            >
              岗位与人数
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                applyPreset(draft.sections[0]!.stableKey, "OPTION_PRICE")
              }
            >
              选择项加价
            </Button>
          </>
        ) : null}
      </div>

      {draft.sections.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          还没有内容区块。先「+ 新分区」，再往里面加字段、表格或说明。
        </p>
      ) : null}

      {draft.sections.map((section) => {
        const layout = layoutV2Rows([section], draft.components, {
          includeDisabled: true,
        })[0];
        const columns = layout?.columns ?? 1;
        return (
          <section
            key={section.stableKey}
            data-section-key={section.stableKey}
            tabIndex={-1}
            className="space-y-3 rounded-xl border bg-card p-4"
          >
            <header className="flex flex-wrap items-center gap-2">
              <Input
                aria-label="区块名称"
                className="h-8 max-w-[220px]"
                value={section.label}
                onChange={(event) =>
                  onChange(
                    updateSection(draft, section.stableKey, {
                      label: event.target.value,
                    }),
                  )
                }
              />
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                列数
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  value={columns}
                  onChange={(event) =>
                    onChange(
                      updateSection(draft, section.stableKey, {
                        columns: Number(event.target.value),
                      }),
                    )
                  }
                >
                  {[1, 2, 3, 4].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={section.enabled}
                  onChange={(event) =>
                    onChange(
                      updateSection(draft, section.stableKey, {
                        enabled: event.target.checked,
                      }),
                    )
                  }
                />
                启用
              </label>
              <div className="ml-auto flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="区块上移"
                  data-action="move-up"
                  onClick={() => moveSectionBy(section.stableKey, "up")}
                >
                  ↑
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="区块下移"
                  data-action="move-down"
                  onClick={() => moveSectionBy(section.stableKey, "down")}
                >
                  ↓
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="删除区块"
                  data-action="delete"
                  onClick={() => deleteSection(section)}
                >
                  删除
                </Button>
              </div>
            </header>

            {layout && layout.rows.length > 0 ? (
              <div className="space-y-2">
                {layout.rows.map((row, rowIndex) => (
                  <div
                    key={`${section.stableKey}-row-${rowIndex}`}
                    className="grid gap-2"
                    style={{
                      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                    }}
                  >
                    {row.components.map((component) => (
                      <div
                        key={component.stableKey}
                        data-component-key={component.stableKey}
                        tabIndex={-1}
                        style={{
                          gridColumn: `span ${Math.min(
                            Math.max(Math.trunc(component.layout.colSpan), 1),
                            columns,
                          )} / span ${Math.min(
                            Math.max(Math.trunc(component.layout.colSpan), 1),
                            columns,
                          )}`,
                        }}
                        className={`space-y-2 rounded-lg border p-3 ${
                          component.enabled
                            ? ""
                            : "border-dashed bg-muted/40 text-muted-foreground"
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">
                            {component.kind === "FIELD"
                              ? "字段"
                              : component.kind === "REPEATABLE_TABLE"
                                ? "可重复表格"
                                : "说明"}
                          </Badge>
                          <Input
                            aria-label="组件名称"
                            className="h-8 max-w-[200px]"
                            value={component.label}
                            onChange={(event) =>
                              onChange(
                                updateComponent(draft, component.stableKey, {
                                  label: event.target.value,
                                }),
                              )
                            }
                          />
                          <label className="flex items-center gap-1 text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={component.enabled}
                              onChange={(event) =>
                                onChange(
                                  toggleComponentEnabled(
                                    draft,
                                    component.stableKey,
                                    event.target.checked,
                                  ),
                                )
                              }
                            />
                            {component.enabled ? "启用" : "已停用（配置保留）"}
                          </label>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {columnSpanLabel(columns, component.layout.colSpan)}
                          </span>
                          <div className="ml-auto flex gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label="组件上移"
                              data-action="move-up"
                              onClick={() => moveComponentBy(component, "up")}
                            >
                              ↑
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label="组件下移"
                              data-action="move-down"
                              onClick={() => moveComponentBy(component, "down")}
                            >
                              ↓
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label="删除组件"
                              data-action="delete"
                              onClick={() => deleteComponent(component)}
                            >
                              删除
                            </Button>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          <label className="flex items-center gap-1">
                            列宽
                            <select
                              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                              value={Math.min(
                                Math.max(
                                  Math.trunc(component.layout.colSpan),
                                  1,
                                ),
                                columns,
                              )}
                              onChange={(event) =>
                                onChange(
                                  updateComponent(draft, component.stableKey, {
                                    colSpan: Number(event.target.value),
                                  }),
                                )
                              }
                            >
                              {Array.from(
                                { length: columns },
                                (_unused, index) => index + 1,
                              ).map((value) => (
                                <option key={value} value={value}>
                                  {columnSpanLabel(columns, value)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={component.layout.rowBreakBefore}
                              onChange={(event) =>
                                onChange(
                                  updateComponent(draft, component.stableKey, {
                                    rowBreakBefore: event.target.checked,
                                  }),
                                )
                              }
                            />
                            另起一行
                          </label>
                        </div>

                        {component.kind === "NOTE" ? (
                          <textarea
                            aria-label="说明文本"
                            className="min-h-16 w-full rounded-md border border-input bg-background p-2 text-sm"
                            value={component.text}
                            onChange={(event) =>
                              onChange(
                                updateComponent(draft, component.stableKey, {
                                  text: event.target.value,
                                }),
                              )
                            }
                          />
                        ) : null}

                        {component.kind === "FIELD" ? (
                          <FieldEditor
                            draft={draft}
                            field={component}
                            onChange={onChange}
                          />
                        ) : null}

                        {component.kind === "REPEATABLE_TABLE" ? (
                          <TableEditor
                            draft={draft}
                            table={component}
                            onChange={onChange}
                            onNotice={onNotice}
                          />
                        ) : null}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                这个区块还是空的。
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => addTo(section, "FIELD")}
              >
                + 字段
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => addTo(section, "REPEATABLE_TABLE")}
              >
                + 可重复表格
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => addTo(section, "NOTE")}
              >
                + 说明
              </Button>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function FieldEditor({
  draft,
  field,
  onChange,
}: {
  draft: DraftConfigV2;
  field: FieldComponent;
  onChange: (next: DraftConfigV2) => void;
}) {
  const isChoice =
    field.fieldType === "SINGLE_SELECT" || field.fieldType === "MULTI_SELECT";
  return (
    <div className="space-y-2 rounded-md bg-muted/30 p-2">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <label className="flex items-center gap-1">
          类型
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            value={field.fieldType}
            onChange={(event) =>
              onChange(
                updateComponent(draft, field.stableKey, {
                  fieldType: event.target.value as FieldComponent["fieldType"],
                }),
              )
            }
          >
            {Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          业务用途
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            value={field.semanticRole}
            onChange={(event) =>
              onChange(
                updateComponent(draft, field.stableKey, {
                  semanticRole: event.target
                    .value as FieldComponent["semanticRole"],
                }),
              )
            }
          >
            {Object.entries(SEMANTIC_ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={field.required}
            onChange={(event) =>
              onChange(
                updateComponent(draft, field.stableKey, {
                  required: event.target.checked,
                }),
              )
            }
          />
          必填
        </label>
        <span className="font-mono text-[11px]">
          fieldKey: {field.stableKey}
        </span>
      </div>

      {isChoice ? (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            选项（加价与元换算在 S3 Task 4 接入）：
          </p>
          {(field.options ?? []).map((option, index) => (
            <div
              key={`${field.stableKey}-option-${index}`}
              className="flex gap-2"
            >
              <Input
                aria-label={`选项 ${index + 1} 名称`}
                className="h-8 max-w-[180px]"
                value={option.label}
                onChange={(event) => {
                  const next = [...(field.options ?? [])];
                  next[index] = { ...option, label: event.target.value };
                  onChange(setOptions(draft, field.stableKey, next));
                }}
              />
              <Input
                aria-label={`选项 ${index + 1} 值`}
                className="h-8 max-w-[180px] font-mono"
                value={option.value}
                onChange={(event) => {
                  const next = [...(field.options ?? [])];
                  next[index] = { ...option, value: event.target.value };
                  onChange(setOptions(draft, field.stableKey, next));
                }}
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  onChange(
                    setOptions(
                      draft,
                      field.stableKey,
                      (field.options ?? []).filter((_item, i) => i !== index),
                    ),
                  )
                }
              >
                删除
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onChange(
                setOptions(draft, field.stableKey, [
                  ...(field.options ?? []),
                  {
                    value: `option_${(field.options?.length ?? 0) + 1}`,
                    label: `选项 ${(field.options?.length ?? 0) + 1}`,
                  },
                ]),
              )
            }
          >
            + 选项
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** 选项编辑走 setComponentOptions（内部会拒绝非选择字段）。 */
function setOptions(
  draft: DraftConfigV2,
  stableKey: string,
  options: NonNullable<FieldComponent["options"]>,
): DraftConfigV2 {
  return setComponentOptions(draft, stableKey, options);
}

function TableEditor({
  draft,
  table,
  onChange,
  onNotice,
}: {
  draft: DraftConfigV2;
  table: TableComponent;
  onChange: (next: DraftConfigV2) => void;
  onNotice: (message: string) => void;
}) {
  return (
    <div className="space-y-2 rounded-md bg-muted/30 p-2">
      <p className="text-xs text-muted-foreground">表格列</p>
      {table.columns.map((column) => (
        <div
          key={column.stableKey}
          className="flex flex-wrap items-center gap-2"
        >
          <Input
            aria-label="列名称"
            className="h-8 max-w-[160px]"
            value={column.label}
            onChange={(event) =>
              onChange(
                updateTableColumn(draft, table.stableKey, column.stableKey, {
                  label: event.target.value,
                }),
              )
            }
          />
          <select
            aria-label="列类型"
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            value={column.columnType}
            onChange={(event) =>
              onChange(
                updateTableColumn(draft, table.stableKey, column.stableKey, {
                  columnType: event.target.value as typeof column.columnType,
                }),
              )
            }
          >
            <option value="TEXT">文本</option>
            <option value="NUMBER">数字</option>
            <option value="SINGLE_SELECT">单选</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={column.required}
              onChange={(event) =>
                onChange(
                  updateTableColumn(draft, table.stableKey, column.stableKey, {
                    required: event.target.checked,
                  }),
                )
              }
            />
            必填
          </label>
          <span className="font-mono text-[11px] text-muted-foreground">
            {column.semanticRole}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const result = removeTableColumn(
                draft,
                table.stableKey,
                column.stableKey,
              );
              if (!result.ok) {
                onNotice(result.reason);
                return;
              }
              onChange(result.config);
            }}
          >
            删除列
          </Button>
        </div>
      ))}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const result = addTableColumn(draft, table.stableKey);
            if (!result.ok) {
              onNotice(result.reason);
              return;
            }
            onChange(result.config);
          }}
        >
          + 列
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const result = addDefaultRow(draft, table.stableKey);
            if (!result.ok) {
              onNotice(result.reason);
              return;
            }
            onChange(result.config);
          }}
        >
          + 默认行
        </Button>
      </div>

      {table.defaultRows.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">默认行</p>
          {table.defaultRows.map((row, rowIndex) => (
            <div
              key={`${table.stableKey}-row-${rowIndex}`}
              className="flex flex-wrap gap-2"
            >
              {table.columns.map((column) => {
                const value = row[column.stableKey];
                if (column.columnType === "NUMBER") {
                  return (
                    <Input
                      key={column.stableKey}
                      aria-label={`${column.label} 默认值`}
                      className="h-8 max-w-[120px]"
                      type="number"
                      value={typeof value === "number" ? value : 0}
                      onChange={(event) =>
                        onChange(
                          setDefaultRowValue(
                            draft,
                            table.stableKey,
                            rowIndex,
                            column.stableKey,
                            Number(event.target.value),
                          ),
                        )
                      }
                    />
                  );
                }
                if (column.columnType === "SINGLE_SELECT") {
                  return (
                    <select
                      key={column.stableKey}
                      aria-label={`${column.label} 默认值`}
                      className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                      value={typeof value === "string" ? value : ""}
                      onChange={(event) =>
                        onChange(
                          setDefaultRowValue(
                            draft,
                            table.stableKey,
                            rowIndex,
                            column.stableKey,
                            event.target.value,
                          ),
                        )
                      }
                    >
                      <option value="">未选择</option>
                      {(column.options ?? []).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  );
                }
                return (
                  <Input
                    key={column.stableKey}
                    aria-label={`${column.label} 默认值`}
                    className="h-8 max-w-[160px]"
                    value={typeof value === "string" ? value : ""}
                    onChange={(event) =>
                      onChange(
                        setDefaultRowValue(
                          draft,
                          table.stableKey,
                          rowIndex,
                          column.stableKey,
                          event.target.value,
                        ),
                      )
                    }
                  />
                );
              })}
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  onChange(removeDefaultRow(draft, table.stableKey, rowIndex))
                }
              >
                删除行
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

"use client";

/**
 * 「内容设计」标签：原语优先的表单搭建设计器。
 *
 * 设计规格：docs/specs/派单模板表单设计器-设计规格-v0.2.md（决策 D-13 至 D-19）。
 *
 * 约束：
 * - 只给原语，不给预设：界面上不出现任何预置字段目录或预置区块入口（D-13 / D-14）；
 * - 行保持安静，属性落在展开面板里（D-15）；
 * - 所有编辑走 template-draft-state 的纯函数，本组件不直接改 draft；
 * - 停用保留配置，只有显式删除才移除；
 * - 删除被「人数来源」引用的组件会被拦截，原因交给调用方播报；
 * - 不暴露 stableKey 等工程概念；算价只以「不用 / 人数 / 时长」三个中性取值出现（D-19）。
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { announceOrderChange, focusSelectorAfterMove } from "./template-a11y";
import { previewTemplateDocument } from "./template-document-preview";
import { TemplateDraftRenderer } from "./template-form-renderer";
import {
  COMPONENT_KIND_LABELS,
  FIELD_TYPE_LABELS,
  TABLE_COLUMN_TYPE_LABELS,
  componentSummary,
  issueCountByComponent,
} from "./template-editor-meta";
import {
  addComponent,
  addDefaultRow,
  addSection,
  addTableColumn,
  guardRemoveComponent,
  moveComponent,
  moveSection,
  removeComponent,
  removeDefaultRow,
  removeSection,
  removeTableColumn,
  reorderComponent,
  setComponentOptions,
  toggleComponentEnabled,
  updateComponent,
  updateSection,
  updateTableColumn,
  type DraftChoiceOptionV2,
  type DraftComponentV2,
  type DraftConfigV2,
  type DraftFieldComponentV2,
  type DraftNoteComponentV2,
  type DraftSectionV2,
  type DraftTableComponentV2,
} from "./template-draft-state";

export interface TemplateEditorContentProps {
  draft: DraftConfigV2;
  onChange: (next: DraftConfigV2) => void;
  onNotice: (message: string) => void;
}

type MoveDirection = "up" | "down";

const CHOICE_TYPES: ReadonlySet<DraftFieldComponentV2["fieldType"]> = new Set([
  "SINGLE_SELECT",
  "MULTI_SELECT",
]);

function isChoiceField(component: DraftFieldComponentV2): boolean {
  return CHOICE_TYPES.has(component.fieldType);
}

/** 加价输入用元；金额一律按整数分存储，转换不经过浮点。 */
function yuanToFenString(input: string): { ok: boolean; fen?: string } {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: true };
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(trimmed)) return { ok: false };
  const [whole, fraction = ""] = trimmed.split(".");
  const fen = `${whole}${`${fraction}00`.slice(0, 2)}`.replace(/^0+(?=\d)/, "");
  return { ok: true, fen };
}

function fenToYuanInput(fen: string | undefined): string {
  if (fen === undefined) return "";
  const padded = fen.padStart(3, "0");
  const whole = padded.slice(0, -2).replace(/^0+(?=\d)/, "");
  const fraction = padded.slice(-2);
  return fraction === "00" ? whole : `${whole}.${fraction}`;
}

function OptionRows({
  component,
  onChange,
}: {
  component: DraftFieldComponentV2;
  onChange: (options: DraftChoiceOptionV2[]) => void;
}) {
  const options = component.options ?? [];
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">
        选项（每个选项可以单独加价）
      </p>
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          还没有选项，至少加两个客户才选得出来。
        </p>
      ) : null}
      {options.map((option, index) => (
        <div
          key={`${component.stableKey}-option-${index}`}
          className="flex items-center gap-2"
        >
          <Input
            aria-label={`选项 ${index + 1} 名称`}
            className="h-8 flex-1"
            placeholder={`选项 ${index + 1}`}
            value={option.label}
            onChange={(event) => {
              const next = [...options];
              next[index] = { ...option, label: event.target.value };
              onChange(next);
            }}
          />
          <span className="text-xs text-muted-foreground">加价 ¥</span>
          <Input
            aria-label={`选项 ${index + 1} 加价（元）`}
            className="h-8 w-24 text-right"
            inputMode="decimal"
            placeholder="0"
            value={fenToYuanInput(option.priceDeltaFen)}
            onChange={(event) => {
              const parsed = yuanToFenString(event.target.value);
              if (!parsed.ok) return;
              const next = [...options];
              const current = next[index]!;
              if (parsed.fen === undefined) {
                next[index] = { value: current.value, label: current.label };
              } else {
                next[index] = { ...current, priceDeltaFen: parsed.fen };
              }
              onChange(next);
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`删除选项 ${index + 1}`}
            onClick={() => onChange(options.filter((_, i) => i !== index))}
          >
            ✕
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() =>
          onChange([
            ...options,
            { value: `option_${options.length + 1}`, label: "" },
          ])
        }
      >
        + 添加选项
      </Button>
    </div>
  );
}

function FieldPanel({
  draft,
  component,
  onChange,
}: {
  draft: DraftConfigV2;
  component: DraftFieldComponentV2;
  onChange: (next: DraftConfigV2) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">填什么类型</p>
        <div className="flex flex-wrap gap-1">
          {(
            Object.keys(
              FIELD_TYPE_LABELS,
            ) as DraftFieldComponentV2["fieldType"][]
          ).map((fieldType) => (
            <Button
              key={fieldType}
              type="button"
              size="sm"
              variant={
                component.fieldType === fieldType ? "secondary" : "outline"
              }
              aria-pressed={component.fieldType === fieldType}
              onClick={() =>
                onChange(
                  updateComponent(draft, component.stableKey, { fieldType }),
                )
              }
            >
              {FIELD_TYPE_LABELS[fieldType]}
            </Button>
          ))}
        </div>
      </div>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">
          输入框里的提示（可留空）
        </span>
        <Input
          className="h-8"
          aria-label="占位提示"
          placeholder="例如 120"
          value={component.placeholder ?? ""}
          onChange={(event) =>
            onChange(
              updateComponent(draft, component.stableKey, {
                placeholder: event.target.value,
              }),
            )
          }
        />
      </label>
      {isChoiceField(component) ? (
        <OptionRows
          component={component}
          onChange={(options) =>
            onChange(setComponentOptions(draft, component.stableKey, options))
          }
        />
      ) : null}
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">
          给填写人的说明（可留空）
        </span>
        <Input
          className="h-8"
          aria-label="字段说明"
          placeholder="例如 按分钟计费"
          value={component.description ?? ""}
          onChange={(event) =>
            onChange(
              updateComponent(draft, component.stableKey, {
                description: event.target.value,
              }),
            )
          }
        />
      </label>
    </div>
  );
}

function TablePanel({
  draft,
  component,
  onChange,
  onNotice,
}: {
  draft: DraftConfigV2;
  component: DraftTableComponentV2;
  onChange: (next: DraftConfigV2) => void;
  onNotice: (message: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">
          表格的列（行由填单人自己增加）
        </p>
        {component.columns.map((column, index) => (
          <div key={column.stableKey} className="flex items-center gap-2">
            <Input
              aria-label={`列 ${index + 1} 名称`}
              className="h-8 flex-1"
              placeholder={`列 ${index + 1}`}
              value={column.label}
              onChange={(event) =>
                onChange(
                  updateTableColumn(
                    draft,
                    component.stableKey,
                    column.stableKey,
                    {
                      label: event.target.value,
                    },
                  ),
                )
              }
            />
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              aria-label={`列 ${index + 1} 类型`}
              value={column.columnType}
              onChange={(event) =>
                onChange(
                  updateTableColumn(
                    draft,
                    component.stableKey,
                    column.stableKey,
                    {
                      columnType: event.target
                        .value as DraftTableComponentV2["columns"][number]["columnType"],
                    },
                  ),
                )
              }
            >
              {(
                Object.keys(TABLE_COLUMN_TYPE_LABELS) as Array<
                  keyof typeof TABLE_COLUMN_TYPE_LABELS
                >
              ).map((columnType) => (
                <option key={columnType} value={columnType}>
                  {TABLE_COLUMN_TYPE_LABELS[columnType]}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={column.required}
                aria-label={`列 ${index + 1} 必填`}
                onChange={(event) =>
                  onChange(
                    updateTableColumn(
                      draft,
                      component.stableKey,
                      column.stableKey,
                      { required: event.target.checked },
                    ),
                  )
                }
              />
              必填
            </label>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={`删除列 ${index + 1}`}
              onClick={() => {
                const result = removeTableColumn(
                  draft,
                  component.stableKey,
                  column.stableKey,
                );
                if (!result.ok) {
                  onNotice(result.reason);
                  return;
                }
                onChange(result.config);
              }}
            >
              ✕
            </Button>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            const result = addTableColumn(draft, component.stableKey);
            if (!result.ok) {
              onNotice(result.reason);
              return;
            }
            onChange(result.config);
          }}
        >
          + 添加列
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          默认行数
        </span>
        <span className="font-mono text-sm">
          {component.defaultRows.length}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            const result = addDefaultRow(draft, component.stableKey);
            if (!result.ok) {
              onNotice(result.reason);
              return;
            }
            onChange(result.config);
          }}
        >
          + 一行
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={component.defaultRows.length === 0}
          onClick={() =>
            onChange(
              removeDefaultRow(
                draft,
                component.stableKey,
                component.defaultRows.length - 1,
              ),
            )
          }
        >
          − 一行
        </Button>
      </div>
    </div>
  );
}

function NotePanel({
  draft,
  component,
  onChange,
}: {
  draft: DraftConfigV2;
  component: DraftNoteComponentV2;
  onChange: (next: DraftConfigV2) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">
        说明内容（只展示，不收集）
      </span>
      <textarea
        className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        aria-label="说明内容"
        value={component.text}
        onChange={(event) =>
          onChange(
            updateComponent(draft, component.stableKey, {
              text: event.target.value,
            }),
          )
        }
      />
    </label>
  );
}

export function TemplateEditorContent({
  draft,
  onChange,
  onNotice,
}: TemplateEditorContentProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"form" | "doc">("form");
  const [narrowPreview, setNarrowPreview] = useState(false);
  const [collapsedKeys, setCollapsedKeys] = useState<string[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [renderOpen, setRenderOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  /** 与右侧预览共用的一套编号：按分组顺序、组内按 sortOrder。 */
  const numbers = useMemo(() => {
    const map = new Map<string, number>();
    let counter = 0;
    for (const section of draft.sections) {
      const list = draft.components
        .filter((item) => item.sectionKey === section.stableKey)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      for (const item of list) {
        counter += 1;
        map.set(item.stableKey, counter);
      }
    }
    return map;
  }, [draft]);
  const numberOf = (stableKey: string) => numbers.get(stableKey);
  const isCollapsed = (stableKey: string) => collapsedKeys.includes(stableKey);
  const toggleCollapsed = (stableKey: string) =>
    setCollapsedKeys((keys) =>
      keys.includes(stableKey)
        ? keys.filter((key) => key !== stableKey)
        : [...keys, stableKey],
    );

  /** 移动后把焦点放回同一个按钮，避免焦点跳到页面顶部。 */
  useEffect(() => {
    if (!pendingFocus) return;
    const target = document.querySelector<HTMLElement>(pendingFocus);
    target?.focus();
    setPendingFocus(null);
  }, [draft, pendingFocus]);

  useEffect(() => setMounted(true), []);

  /** Esc 关闭「渲染」弹层。 */
  useEffect(() => {
    if (!renderOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRenderOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [renderOpen]);

  const issues = issueCountByComponent(draft);

  const add = (kind: DraftComponentV2["kind"]) => {
    let base = draft;
    let sectionKey = base.sections[base.sections.length - 1]?.stableKey;
    if (!sectionKey) {
      const created = addSection(base, { label: "表单内容", columns: 2 });
      if (!created.ok) {
        onNotice(created.reason);
        return;
      }
      base = created.config;
      sectionKey = created.stableKey;
    }
    const result = addComponent(base, kind, sectionKey);
    if (!result.ok) {
      onNotice(result.reason);
      return;
    }
    onChange(result.config);
    setSelectedKey(result.stableKey);
  };

  const duplicate = (component: DraftComponentV2) => {
    const created = addComponent(draft, component.kind, component.sectionKey);
    if (!created.ok) {
      onNotice(created.reason);
      return;
    }
    let next = updateComponent(created.config, created.stableKey, {
      label: `${component.label || COMPONENT_KIND_LABELS[component.kind]} 副本`,
    });
    if (component.kind === "FIELD") {
      next = updateComponent(next, created.stableKey, {
        fieldType: component.fieldType,
        semanticRole: "CUSTOM",
      });
      if (component.options && component.options.length > 0) {
        next = setComponentOptions(
          next,
          created.stableKey,
          component.options.map((option) => ({ ...option })),
        );
      }
    }
    if (component.kind === "NOTE") {
      next = updateComponent(next, created.stableKey, { text: component.text });
    }
    onChange(next);
    setSelectedKey(created.stableKey);
  };

  const remove = (component: DraftComponentV2) => {
    const guard = guardRemoveComponent(draft, component.stableKey);
    if (!guard.ok) {
      onNotice(guard.reason);
      return;
    }
    onChange(removeComponent(draft, component.stableKey));
    if (selectedKey === component.stableKey) {
      setSelectedKey(null);
    }
  };

  const moveBy = (component: DraftComponentV2, direction: MoveDirection) => {
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

  const moveSectionBy = (section: DraftSectionV2, direction: MoveDirection) => {
    setPendingFocus(
      focusSelectorAfterMove("section", section.stableKey, direction),
    );
    onNotice(
      announceOrderChange(
        draft.sections.map((item) => ({
          stableKey: item.stableKey,
          label: item.label,
        })),
        section.stableKey,
        direction,
      ),
    );
    onChange(moveSection(draft, section.stableKey, direction));
  };

  const addGroup = () => {
    const result = addSection(draft, { label: "新分组", columns: 2 });
    if (!result.ok) {
      onNotice(result.reason);
      return;
    }
    onChange(result.config);
    onNotice("已添加分组「新分组」。");
  };

  const deleteSection = (section: DraftSectionV2) => {
    const result = removeSection(draft, section.stableKey);
    if (!result.ok) {
      onNotice(result.reason);
      return;
    }
    onChange(result.config);
  };

  return (
    <div className="space-y-4" data-template-editor>
      <div className="mc-te-toolbar">
        <button
          type="button"
          className="mc-te-new is-primary"
          onClick={() => add("FIELD")}
        >
          + 新建字段
        </button>
        <button
          type="button"
          className="mc-te-new"
          onClick={() => add("REPEATABLE_TABLE")}
        >
          + 新建表格
        </button>
        <button type="button" className="mc-te-new" onClick={() => add("NOTE")}>
          + 新建说明
        </button>
        <button type="button" className="mc-te-new" onClick={addGroup}>
          + 新建分组
        </button>
        <button
          type="button"
          className="mc-te-new is-render"
          onClick={() => setRenderOpen(true)}
        >
          渲染
        </button>
      </div>

      {draft.components.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          这个模板还是空的。用上面的按钮开始添加字段、表格或说明——内容全部由你自己定义。
        </p>
      ) : null}
      {draft.sections.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          还没有内容。直接加字段会自动建一个分组，你也可以先「+
          新建分组」自己给分组起名。
        </p>
      ) : null}

      {draft.sections.map((section) => {
        const list = draft.components.filter(
          (item) => item.sectionKey === section.stableKey,
        );
        return (
          <section
            key={section.stableKey}
            data-section-key={section.stableKey}
            className="space-y-3 rounded-xl border bg-card p-4"
          >
            <header className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label="收起或展开分组"
                aria-expanded={!isCollapsed(section.stableKey)}
                onClick={() => toggleCollapsed(section.stableKey)}
              >
                {isCollapsed(section.stableKey) ? "▸" : "▾"}
              </Button>
              <Input
                aria-label="分组名称"
                className="h-8 max-w-56"
                value={section.label}
                onChange={(event) =>
                  onChange(
                    updateSection(draft, section.stableKey, {
                      label: event.target.value,
                    }),
                  )
                }
              />
              <span className="text-xs text-muted-foreground">
                {list.length} 项
              </span>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                每行
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  aria-label="每行几列"
                  value={section.layout.columns}
                  onChange={(event) =>
                    onChange(
                      updateSection(draft, section.stableKey, {
                        columns: Number(event.target.value),
                      }),
                    )
                  }
                >
                  {[1, 2, 3, 4].map((columns) => (
                    <option key={columns} value={columns}>
                      {columns}
                    </option>
                  ))}
                </select>
                个
              </label>
              <div className="ml-auto flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant={section.enabled ? "ghost" : "secondary"}
                  aria-label={section.enabled ? "停用分组" : "启用分组"}
                  aria-pressed={!section.enabled}
                  onClick={() =>
                    onChange(
                      updateSection(draft, section.stableKey, {
                        enabled: !section.enabled,
                      }),
                    )
                  }
                >
                  {section.enabled ? "◐" : "◑"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label="分组上移"
                  data-section-action="move-up"
                  data-action="move-up"
                  onClick={() => moveSectionBy(section, "up")}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label="分组下移"
                  data-section-action="move-down"
                  data-action="move-down"
                  onClick={() => moveSectionBy(section, "down")}
                >
                  ↓
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label="删除分组"
                  onClick={() => deleteSection(section)}
                >
                  ✕
                </Button>
              </div>
            </header>

            <div
              className={
                isCollapsed(section.stableKey) ? "hidden" : "space-y-2"
              }
            >
              {list.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  这个分组还是空的，用上面的按钮往里加内容。
                </p>
              ) : null}

              {list.map((component) => (
                <div key={component.stableKey} className="space-y-2">
                  <div
                    data-component-key={component.stableKey}
                    draggable
                    onMouseEnter={() =>
                      setActiveKey((key) =>
                        key === component.stableKey ? key : component.stableKey,
                      )
                    }
                    onMouseLeave={() => setActiveKey(null)}
                    onFocus={() => setActiveKey(component.stableKey)}
                    onBlur={() => setActiveKey(null)}
                    onDragStart={(event) => {
                      setDraggingKey(component.stableKey);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData(
                        "text/plain",
                        component.stableKey,
                      );
                    }}
                    onDragEnd={() => setDraggingKey(null)}
                    onDragOver={(event) => {
                      if (!draggingKey || draggingKey === component.stableKey)
                        return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                      if (!draggingKey || draggingKey === component.stableKey)
                        return;
                      event.preventDefault();
                      const rect = event.currentTarget.getBoundingClientRect();
                      const position =
                        event.clientY < rect.top + rect.height / 2
                          ? "before"
                          : "after";
                      onChange(
                        reorderComponent(
                          draft,
                          draggingKey,
                          component.stableKey,
                          position,
                        ),
                      );
                      onNotice(
                        `已把「${
                          draft.components.find(
                            (item) => item.stableKey === draggingKey,
                          )?.label || "内容"
                        }」移到「${component.label || "内容"}」${
                          position === "before" ? "之前" : "之后"
                        }。`,
                      );
                      setDraggingKey(null);
                    }}
                    className={`flex flex-wrap items-center gap-2 rounded-lg border bg-background px-2 py-1${
                      component.enabled ? "" : " opacity-60"
                    }${draggingKey === component.stableKey ? " opacity-40" : ""}${
                      draggingKey && draggingKey !== component.stableKey
                        ? " border-dashed"
                        : ""
                    }${
                      activeKey === component.stableKey
                        ? " border-primary ring-2 ring-primary/30"
                        : ""
                    }`}
                  >
                    <span
                      data-row-number={component.stableKey}
                      className={`w-5 text-right font-mono text-xs ${
                        activeKey === component.stableKey
                          ? "font-semibold text-primary"
                          : "text-muted-foreground"
                      }`}
                    >
                      {numberOf(component.stableKey) ?? ""}
                    </span>
                    <span className="w-14 text-xs text-muted-foreground">
                      {COMPONENT_KIND_LABELS[component.kind]}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="justify-start font-medium"
                      aria-expanded={selectedKey === component.stableKey}
                      onClick={() =>
                        setSelectedKey(
                          selectedKey === component.stableKey
                            ? null
                            : component.stableKey,
                        )
                      }
                    >
                      {component.label || "未命名字段"}
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {componentSummary(draft, component.stableKey)}
                    </span>
                    {!component.enabled ? (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        已停用
                      </span>
                    ) : null}
                    {(issues.get(component.stableKey) ?? 0) > 0 ? (
                      <span
                        className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive"
                        title="这一项还有要补的地方"
                      >
                        {issues.get(component.stableKey)} 项待补
                      </span>
                    ) : null}
                    {component.kind === "FIELD" && component.required ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
                        必填
                      </span>
                    ) : null}

                    <div className="ml-auto flex items-center gap-1">
                      {component.kind === "FIELD" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant={component.required ? "secondary" : "ghost"}
                          aria-label="必填"
                          aria-pressed={component.required}
                          onClick={() =>
                            onChange(
                              updateComponent(draft, component.stableKey, {
                                required: !component.required,
                              }),
                            )
                          }
                        >
                          ✱
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label="上移"
                        data-action="move-up"
                        onClick={() => moveBy(component, "up")}
                      >
                        ↑
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label="下移"
                        data-action="move-down"
                        onClick={() => moveBy(component, "down")}
                      >
                        ↓
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label="再建一个同类"
                        onClick={() => duplicate(component)}
                      >
                        ⧉
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={component.enabled ? "停用" : "启用"}
                        aria-pressed={!component.enabled}
                        onClick={() =>
                          onChange(
                            toggleComponentEnabled(
                              draft,
                              component.stableKey,
                              !component.enabled,
                            ),
                          )
                        }
                      >
                        {component.enabled ? "◐" : "◑"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label="删除"
                        onClick={() => remove(component)}
                      >
                        ✕
                      </Button>
                    </div>
                  </div>

                  {selectedKey === component.stableKey ? (
                    <div className="space-y-4 rounded-lg border bg-muted/30 p-3">
                      <Input
                        aria-label="名称"
                        className="h-8 max-w-72"
                        placeholder="给这一项起个名字"
                        value={component.label}
                        onChange={(event) =>
                          onChange(
                            updateComponent(draft, component.stableKey, {
                              label: event.target.value,
                            }),
                          )
                        }
                      />
                      {component.kind === "FIELD" ? (
                        <FieldPanel
                          draft={draft}
                          component={component}
                          onChange={onChange}
                        />
                      ) : null}
                      {component.kind === "REPEATABLE_TABLE" ? (
                        <TablePanel
                          draft={draft}
                          component={component}
                          onChange={onChange}
                          onNotice={onNotice}
                        />
                      ) : null}
                      {component.kind === "NOTE" ? (
                        <NotePanel
                          draft={draft}
                          component={component}
                          onChange={onChange}
                        />
                      ) : null}
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          在一行里占
                        </span>
                        {[1, 2].map((span) => (
                          <Button
                            key={span}
                            type="button"
                            size="sm"
                            variant={
                              component.layout.colSpan === span
                                ? "secondary"
                                : "outline"
                            }
                            aria-pressed={component.layout.colSpan === span}
                            onClick={() =>
                              onChange(
                                updateComponent(draft, component.stableKey, {
                                  colSpan: span,
                                }),
                              )
                            }
                          >
                            {span === 1 ? "半行" : "整行"}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        );
      })}
      {mounted && renderOpen
        ? createPortal(
            <div
              className="pw-merchant mc-modal-backdrop"
              role="presentation"
              onClick={() => setRenderOpen(false)}
            >
              <div
                className="mc-modal"
                role="dialog"
                aria-modal="true"
                aria-label="客户看到的样子"
                onClick={(event) => event.stopPropagation()}
              >
                <header className="mc-modal-head">
                  <div>
                    <b>客户看到的样子</b>
                    <small>已停用的内容不会出现</small>
                  </div>
                  <div className="mc-modal-actions">
                    <button
                      type="button"
                      className={
                        previewMode === "form"
                          ? "mc-te-chip is-on"
                          : "mc-te-chip"
                      }
                      onClick={() => setPreviewMode("form")}
                    >
                      填写表单
                    </button>
                    <button
                      type="button"
                      className={
                        previewMode === "doc"
                          ? "mc-te-chip is-on"
                          : "mc-te-chip"
                      }
                      onClick={() => setPreviewMode("doc")}
                    >
                      订单文案
                    </button>
                    <button
                      type="button"
                      className={
                        narrowPreview ? "mc-te-chip is-on" : "mc-te-chip"
                      }
                      onClick={() => setNarrowPreview((value) => !value)}
                    >
                      手机宽度
                    </button>
                    <button
                      type="button"
                      className="mc-te-close"
                      aria-label="关闭"
                      onClick={() => setRenderOpen(false)}
                    >
                      ✕
                    </button>
                  </div>
                </header>
                <div
                  className={
                    narrowPreview ? "mc-modal-body is-narrow" : "mc-modal-body"
                  }
                >
                  {previewMode === "doc" ? (
                    <pre className="mc-te-doc">
                      {previewTemplateDocument(draft).plainText}
                    </pre>
                  ) : (
                    <TemplateDraftRenderer
                      sections={draft.sections}
                      components={draft.components}
                      numberOf={numberOf}
                    />
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

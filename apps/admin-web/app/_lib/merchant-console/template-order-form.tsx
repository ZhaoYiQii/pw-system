"use client";

/**
 * S4 新建派单：发布快照的「填写态」表单。
 *
 * 与 S3 的关系：布局装箱直接复用 form-layout.layoutV2Rows，只读预览复用
 * template-form-renderer.TemplateDraftRenderer；这里只补可填写的输入件，
 * 不复制布局算法，保证「编辑器预览 / 只读详情 / 下单填写」三处解释一致。
 *
 * 边界：只收集值（stableKey → unknown）。人数与价格一律由服务端按发布快照计算，
 * 界面不计算、也不提交最终人数或价格。
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { layoutV2Rows } from "./form-layout";
import type {
  DraftConfigV2,
  DraftFieldComponentV2,
  DraftTableComponentV2,
} from "./template-draft-state";

export interface TemplateOrderFormProps {
  config: DraftConfigV2;
  values: Record<string, unknown>;
  onValueChange: (stableKey: string, value: unknown) => void;
  /** 提交前需要高亮的必填缺失项（stableKey）。 */
  missingKeys?: readonly string[];
}

type OrderComponent = DraftConfigV2["components"][number];

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function isTable(
  component: OrderComponent,
): component is DraftTableComponentV2 {
  return component.kind === "REPEATABLE_TABLE";
}

function inputTypeOf(field: DraftFieldComponentV2): string {
  if (field.fieldType === "NUMBER" || field.fieldType === "MONEY_FEN")
    return "text";
  if (field.fieldType === "DATETIME") return "datetime-local";
  return "text";
}

export function TemplateOrderForm({
  config,
  values,
  onValueChange,
  missingKeys = [],
}: TemplateOrderFormProps) {
  // 与服务端运行时口径一致：只有「启用区块内的启用组件」能携带值，
  // 因此停用区块与停用组件都不渲染（layoutV2Rows 只过滤组件，区块需自己过滤）。
  const activeSections = config.sections.filter((section) => section.enabled);
  const activeComponents = config.components.filter(
    (component) => component.enabled,
  );
  // 用具体类型实例化泛型，才能在渲染时安全读取 section.label 等展示字段。
  const layout = layoutV2Rows<
    DraftConfigV2["components"][number],
    DraftConfigV2["sections"][number]
  >(activeSections, activeComponents);
  const missing = new Set(missingKeys);

  return (
    <div className="space-y-6">
      {layout.map(({ section, columns, rows }) => (
        <section key={section.stableKey} className="space-y-3">
          <header className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              {section.label}
            </h3>
            <span className="font-mono text-xs text-muted-foreground">
              {columns} 列
            </span>
          </header>
          {rows.map((row, rowIndex) => (
            <div
              key={`${section.stableKey}-row-${rowIndex}`}
              className="grid gap-3"
              style={{
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              }}
            >
              {row.components.map((component) => (
                <div
                  key={component.stableKey}
                  style={{
                    gridColumn: `span ${Math.min(component.layout.colSpan, columns)}`,
                  }}
                >
                  <OrderComponentInput
                    component={component as OrderComponent}
                    values={values}
                    missing={missing}
                    onValueChange={onValueChange}
                  />
                </div>
              ))}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function OrderComponentInput({
  component,
  values,
  missing,
  onValueChange,
}: {
  component: OrderComponent;
  values: Record<string, unknown>;
  missing: Set<string>;
  onValueChange: (stableKey: string, value: unknown) => void;
}) {
  if (component.kind === "NOTE") {
    return (
      <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
        {component.label}：{component.text}
      </p>
    );
  }

  if (isTable(component)) {
    const rows = asRows(values[component.stableKey]);
    const missingRow = missing.has(component.stableKey);
    return (
      <fieldset
        className="space-y-2 rounded-lg border p-3"
        aria-invalid={missingRow}
        data-component-key={component.stableKey}
      >
        <legend className="px-1 text-sm font-medium">
          {component.label}
          {missingRow ? (
            <span className="ml-2 text-xs text-destructive">需要至少一行</span>
          ) : null}
        </legend>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            还没有数据行，点「添加行」输入。
          </p>
        ) : null}
        {rows.map((row, rowIndex) => (
          <div
            key={`${component.stableKey}-${rowIndex}`}
            className="grid gap-2 sm:grid-cols-3"
          >
            {component.columns.map((column) => {
              const cellValue = asText(row[column.stableKey]);
              const label = `${component.label} 第 ${rowIndex + 1} 行 ${column.label}`;
              const setCell = (next: unknown) => {
                const copy = rows.map((existing, index) =>
                  index === rowIndex
                    ? { ...existing, [column.stableKey]: next }
                    : existing,
                );
                onValueChange(component.stableKey, copy);
              };
              if (column.columnType === "SINGLE_SELECT") {
                return (
                  <label key={column.stableKey} className="text-xs">
                    <span className="text-muted-foreground">
                      {column.label}
                    </span>
                    <select
                      aria-label={label}
                      className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      value={cellValue}
                      onChange={(event) => setCell(event.target.value)}
                    >
                      <option value="">请选择</option>
                      {(column.options ?? []).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              }
              return (
                <label key={column.stableKey} className="text-xs">
                  <span className="text-muted-foreground">{column.label}</span>
                  <Input
                    aria-label={label}
                    className="mt-1"
                    inputMode={
                      column.columnType === "NUMBER" ? "numeric" : undefined
                    }
                    value={cellValue}
                    onChange={(event) =>
                      setCell(
                        column.columnType === "NUMBER" &&
                          event.target.value !== ""
                          ? Number(event.target.value)
                          : event.target.value,
                      )
                    }
                  />
                </label>
              );
            })}
            <div className="flex items-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  const copy = rows.filter((_, index) => index !== rowIndex);
                  onValueChange(component.stableKey, copy);
                }}
              >
                删除第 {rowIndex + 1} 行
              </Button>
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const blank: Record<string, unknown> = {};
            for (const column of component.columns)
              blank[column.stableKey] = "";
            onValueChange(component.stableKey, [...rows, blank]);
          }}
        >
          添加行
        </Button>
      </fieldset>
    );
  }

  const field = component as DraftFieldComponentV2;
  const value = values[field.stableKey];
  const text = asText(value);
  const isMissing = missing.has(field.stableKey);
  const describedBy = isMissing ? `${field.stableKey}-error` : undefined;

  return (
    <label className="block text-sm" data-component-key={field.stableKey}>
      <span className="text-foreground">
        {field.label}
        {field.required ? <span aria-hidden="true"> *</span> : null}
      </span>
      {field.fieldType === "TEXTAREA" ? (
        <textarea
          aria-label={field.label}
          aria-invalid={isMissing}
          aria-describedby={describedBy}
          className="mt-1 min-h-[72px] w-full rounded-lg border border-input bg-muted/40 p-3 text-sm"
          value={text}
          placeholder={field.placeholder ?? ""}
          onChange={(event) =>
            onValueChange(field.stableKey, event.target.value)
          }
        />
      ) : field.fieldType === "SINGLE_SELECT" ? (
        <select
          aria-label={field.label}
          aria-invalid={isMissing}
          aria-describedby={describedBy}
          className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={text}
          onChange={(event) =>
            onValueChange(field.stableKey, event.target.value)
          }
        >
          <option value="">请选择</option>
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : field.fieldType === "MULTI_SELECT" ? (
        <div
          className="mt-1 space-y-1"
          role="group"
          aria-label={field.label}
          aria-describedby={describedBy}
        >
          {(field.options ?? []).map((option) => {
            const selected = Array.isArray(value) ? value : [];
            const checked = selected.includes(option.value);
            return (
              <label key={option.value} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    onValueChange(
                      field.stableKey,
                      checked
                        ? selected.filter((item) => item !== option.value)
                        : [...selected, option.value],
                    )
                  }
                />
                {option.label}
              </label>
            );
          })}
        </div>
      ) : (
        <Input
          aria-label={field.label}
          aria-invalid={isMissing}
          aria-describedby={describedBy}
          className="mt-1"
          type={inputTypeOf(field)}
          value={text}
          placeholder={field.placeholder ?? ""}
          onChange={(event) => {
            const next = event.target.value;
            if (field.fieldType === "DATETIME") {
              onValueChange(
                field.stableKey,
                next === "" ? "" : new Date(next).toISOString(),
              );
              return;
            }
            onValueChange(
              field.stableKey,
              field.fieldType === "NUMBER" || field.fieldType === "MONEY_FEN"
                ? next
                : next,
            );
          }}
        />
      )}
      {isMissing ? (
        <span id={describedBy} className="text-xs text-destructive">
          此项必填
        </span>
      ) : null}
    </label>
  );
}

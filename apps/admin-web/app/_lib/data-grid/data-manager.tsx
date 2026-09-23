"use client";

/**
 * S5-1 / ADR-0008：门店数据表格壳（Tabulator 封装）。
 *
 * 设计约定（照 ADR-0008 的决定）：
 * - **排序/筛选/分页一律走服务端**：用户点表头 → 我们改 `sortBy/sortDir` 重新请求；
 *   Tabulator 自己的 sorter 关掉（`headerSort: false`），否则它只排当前页、会骗人。
 * - **写入不在这里**：这一片只读（区域选择/复制/导出/合计）；行内编辑与粘贴提交属于 S5-2/S5-3，
 *   届时也必须走后端受控接口（字段白名单 + 乐观锁 + 审计）。
 * - 观感不引入第二套体系：`data-grid.css` 把 Tabulator 的类映射到我们的 `--mc-*` token。
 * - `columns` 必须是**模块级常量**（引用稳定），否则表格会被反复重建。
 * - **必须用 `TabulatorFull`**：v6 的 ESM 入口导出的 `Tabulator` 是"核心类"，功能模块
 *   （format / columnCalcs / selectRange / clipboard…）没注册——表现是控制台刷
 *   `Invalid column definition option: formatter` 且金额格式与合计行全部失效（走查当场抓到）。
 *   `TabulatorFull` 才是带全部模块的完整构建。
 * - 工具栏/表头/操作列这一轮只对齐设计稿（`design-demos/finance-data-grid.html`）：
 *   没实现的按钮（列显示 / 导出 Excel / 批量导出 / 批量操作）只给一句"功能待实现"，
 *   不做假导出、不假批量（用户 2026-09-23：先定 UI，再往里添功能）。
 */

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { getAccessToken, apiFetch } from "../api";
import { formatFenYuan } from "../money";
// 先加载 Tabulator 自带的基础样式，再用我们的映射覆盖（否则表格是"没穿衣服"的 div）
import "tabulator-tables/dist/css/tabulator.min.css";
import "./data-grid.css";
import type {
  DataGridColumn,
  DataGridPage,
  DataGridRowAction,
  DataManagerProps,
  DataGridTone,
} from "./types";

type TabulatorTable = import("tabulator-tables").Tabulator;
type TabulatorColumnDefinition = import("tabulator-tables").ColumnDefinition;
type TabulatorOptions = import("tabulator-tables").Options;

type SortState = { by: string; dir: "asc" | "desc" };
/** 读当前排序的盒子：列定义只建一次，箭头要读最新值 */
type SortBox = { readonly current: SortState };

/** 操作列不是数据字段，用这个内部字段名占位（不会被当排序字段）。 */
const ACTION_FIELD = "__pwAction";

const TONE_CLASS: Record<DataGridTone, string> = {
  ok: "pw-dg-badge--ok",
  wait: "pw-dg-badge--wait",
  bad: "pw-dg-badge--bad",
  muted: "pw-dg-badge--muted",
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 金额：整数分 → ¥元（带千分位，照设计稿的 ¥1,000.00）。 */
function formatFenForGrid(fen: string): string {
  const text = formatFenYuan(fen);
  const [whole = "0", fraction = "00"] = text.slice(1).split(".");
  return `¥${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

function plainText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function textSpan(text: string, className?: string): HTMLElement {
  const span = document.createElement("span");
  if (className) span.className = className;
  span.textContent = text;
  return span;
}

function numberSpan(text: string): HTMLElement {
  return textSpan(text, "pw-dg-num");
}

/** 一列两行（稿子：创建时间 + 支付时间）。 */
function cellLines(main: string, sub: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "pw-dg-cell2";
  const first = document.createElement("span");
  first.className = "pw-dg-cell2-main";
  first.textContent = main;
  const second = document.createElement("span");
  second.className = "pw-dg-cell2-sub";
  second.textContent = sub;
  wrap.append(first, second);
  return wrap;
}

/**
 * 表头内容：标题 + 主色排序三角（**独立元素**，不拼进标题文字）+ 漏斗 + 「🔒固定」。
 * 三角只在"当前就是按这列排"时出现，方向和真实请求一致（不做装饰性的假箭头）。
 */
function buildHeaderElement<T>(
  column: DataGridColumn<T>,
  sort: SortState,
): HTMLElement {
  const head = document.createElement("div");
  head.className = "pw-dg-head";

  const title = document.createElement("span");
  title.className = "pw-dg-head-title";
  title.textContent = column.title;
  head.appendChild(title);

  if (column.sortable !== false && column.key === sort.by) {
    const arrow = textSpan(sort.dir === "asc" ? "▲" : "▼", "pw-dg-sort");
    arrow.setAttribute("aria-hidden", "true");
    head.appendChild(arrow);
  }

  if (column.filterHint) {
    const funnel = textSpan("▽", "pw-dg-funnel");
    funnel.setAttribute("aria-hidden", "true");
    head.appendChild(funnel);
  }

  if (column.frozen) {
    head.appendChild(textSpan("🔒固定", "pw-dg-lock"));
  }

  return head;
}

function buildTitleFormatter<T>(
  column: DataGridColumn<T>,
  sort: SortBox,
): TabulatorColumnDefinition["titleFormatter"] {
  return () => buildHeaderElement(column, sort.current);
}

/** 列定义 → Tabulator 列定义（只在这里出现 Tabulator 的字段名）。 */
function buildColumnDefinition<T>(
  column: DataGridColumn<T>,
  sort: SortBox,
): TabulatorColumnDefinition {
  const definition: TabulatorColumnDefinition = {
    field: column.key,
    title: column.title,
    titleFormatter: buildTitleFormatter(column, sort),
    headerSort: false,
    resizable: true,
    ...(column.width ? { width: column.width } : {}),
    ...(column.minWidth ? { minWidth: column.minWidth } : {}),
    ...(column.frozen ? { frozen: true } : {}),
    ...(column.numeric || column.money ? { hozAlign: "right" } : {}),
  };
  if (column.money) {
    definition.formatter = (cell) =>
      numberSpan(formatFenForGrid(String(cell.getValue() ?? "0")));
    // 当前页合计：整数分求和（不经过浮点），再由 formatter 渲染成元
    definition.bottomCalc = (values) =>
      values
        .reduce<bigint>(
          (sum, value) => sum + BigInt(String(value ?? "0") || "0"),
          0n,
        )
        .toString();
    definition.bottomCalcFormatter = (cell) =>
      numberSpan(formatFenForGrid(String(cell.getValue() ?? "0")));
  } else if (column.badge) {
    definition.formatter = (cell) => {
      const row = cell.getRow().getData() as T;
      const badge = column.badge?.(cell.getValue(), row);
      if (!badge) return textSpan("—", "pw-dg-muted");
      return textSpan(badge.label, `pw-dg-badge ${TONE_CLASS[badge.tone]}`);
    };
  } else if (column.subtext) {
    definition.formatter = (cell) => {
      const row = cell.getRow().getData() as T;
      const main =
        column.text?.(cell.getValue(), row) ?? plainText(cell.getValue());
      return cellLines(main, column.subtext?.(cell.getValue(), row) ?? "");
    };
    definition.variableHeight = true;
  } else if (column.text) {
    definition.formatter = (cell) => {
      const row = cell.getRow().getData() as T;
      return textSpan(column.text?.(cell.getValue(), row) ?? "—");
    };
  } else if (column.mono) {
    definition.formatter = (cell) =>
      textSpan(plainText(cell.getValue()), "pw-dg-mono");
  }
  return definition;
}

/** 最右侧「操作」列：动作由页面传入（例如"登记退款" = 把支付单号填进表单）。 */
function buildActionColumn<T>(
  title: string,
  readActions: () => readonly DataGridRowAction<T>[],
): TabulatorColumnDefinition {
  return {
    field: ACTION_FIELD,
    title,
    headerSort: false,
    resizable: false,
    width: 120,
    formatter: (cell) => {
      const row = cell.getRow().getData() as T;
      const available = readActions().filter(
        (action) => !action.when || action.when(row),
      );
      if (available.length === 0) return textSpan("—", "pw-dg-muted");
      const wrap = document.createElement("span");
      wrap.className = "pw-dg-actions";
      for (const [index, action] of available.entries()) {
        if (index > 0) wrap.appendChild(textSpan(" · ", "pw-dg-muted"));
        const button = document.createElement("button");
        button.type = "button";
        button.className = "pw-dg-link";
        button.textContent = action.label;
        button.addEventListener("click", () => {
          // 列只建一次，回调从 ref 里取最新的一份，避免闭包停在旧渲染
          readActions()
            .find((item) => item.key === action.key)
            ?.onClick(row);
        });
        wrap.appendChild(button);
      }
      return wrap;
    },
  };
}

export function DataManager<T extends { id: string }>({
  resource,
  columns,
  actions,
  actionTitle = "操作",
  statusParam,
  statusOptions,
  searchPlaceholder = "查找（任意列）",
  pageSize = 50,
  height = 520,
  exportPath,
  exportFileName = "export.csv",
  emptyHint = "没有符合条件的数据。",
}: DataManagerProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<TabulatorTable | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [message, setMessage] = useState<string | null>(null);
  const [pendingHint, setPendingHint] = useState<string | null>(null);
  const [selectedCount, setSelectedCount] = useState(0);
  const [exporting, setExporting] = useState(false);

  // 表格故意只建一次：排序、动作这些随渲染变化的东西都从 ref 里读（Tabulator 的坑）
  const sortRef = useRef<SortState>({ by: sortBy, dir: sortDir });
  const actionsRef = useRef<readonly DataGridRowAction<T>[]>(actions ?? []);
  useEffect(() => {
    actionsRef.current = actions ?? [];
  }, [actions]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    params.set("sortBy", sortBy);
    params.set("sortDir", sortDir);
    if (status) params.set(statusParam ?? "status", status);
    if (q) params.set("q", q);
    return params.toString();
  }, [page, pageSize, q, sortBy, sortDir, status, statusParam]);

  const listQuery = useQuery({
    queryKey: ["data-grid", resource, queryString],
    queryFn: () => apiFetch<DataGridPage<T>>(`${resource}?${queryString}`),
    placeholderData: (previous) => previous,
  });

  const rows = listQuery.data?.rows ?? [];
  const total = listQuery.data?.total ?? 0;

  const toggleSort = useCallback((field: string) => {
    setPendingHint(null);
    setPage(1);
    setSortBy((current) => {
      setSortDir((dir) =>
        current === field && dir === "desc" ? "asc" : "desc",
      );
      return field;
    });
  }, []);

  const hasActions = (actions?.length ?? 0) > 0;

  // 建表：只建一次（列定义是模块级常量）；数据/排序变化走下面的 effect。
  useEffect(() => {
    let disposed = false;
    void (async () => {
      const mod = await import("tabulator-tables");
      if (disposed || !containerRef.current) return;
      const definitions: TabulatorColumnDefinition[] = columns.map((column) =>
        buildColumnDefinition(column, sortRef),
      );
      if (hasActions) {
        definitions.push(
          buildActionColumn<T>(actionTitle, () => actionsRef.current),
        );
      }
      const options: TabulatorOptions = {
        data: [],
        columns: definitions,
        layout: "fitColumns",
        height,
        placeholder: emptyHint,
        // 交互能力（ADR-0008 的证据：这些都在 MIT 免费包里）
        // 区域选择与行选择互斥（Tabulator 会同时告警）：Excel 手感只要区域选择
        selectableRange: true,
        clipboard: true,
        clipboardCopyStyled: false,
        columnCalcs: "table",
        movableColumns: true,
        // 排序由服务端做：关掉本地 sorter，避免"只排当前页"的假象
        headerSort: false,
      };
      const table = new mod.TabulatorFull(
        containerRef.current,
        options,
      ) as unknown as TabulatorTable;
      tableRef.current = table;
      // 表头点击 = 切换服务端排序（事件名是 headerClick；不去碰列元素，避免 API 猜错）
      table.on("headerClick", (_event, column) => {
        const field = column.getField();
        if (!field) return;
        const definition = columns.find((item) => item.key === field);
        // 不在后端排序白名单里的列，点表头不该发请求（否则 400 把整页打进错误态）
        if (!definition || definition.sortable === false) return;
        toggleSort(field);
      });
      // 「已选 N 条」显示的是真实选中行数（区域选择与行选择互斥，所以默认就是 0；
      // 等 S5-2 打开行选择，这个数字自己就会动）
      table.on("rowSelected", () =>
        setSelectedCount(table.getSelectedRows().length),
      );
      table.on("rowDeselected", () =>
        setSelectedCount(table.getSelectedRows().length),
      );
    })();
    return () => {
      disposed = true;
      tableRef.current?.destroy();
      tableRef.current = null;
    };
  }, [actionTitle, columns, hasActions, height, emptyHint, toggleSort]);

  // 数据更新（换页/筛选/排序后）
  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    void table.replaceData(rows as unknown as Array<Record<string, unknown>>);
  }, [rows]);

  // 排序指示器：表头里的 ▲/▼ 独立元素，按真实 sortBy/sortDir 走（Tabulator 自己的箭头
  // 随 headerSort 一起被关掉了）
  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    sortRef.current = { by: sortBy, dir: sortDir };
    for (const column of columns) {
      void table.updateColumnDefinition(column.key, {
        title: column.title,
        titleFormatter: buildTitleFormatter(column, sortRef),
      });
    }
  }, [columns, sortBy, sortDir, rows.length]);

  const downloadCsv = async () => {
    if (!exportPath) return;
    setExporting(true);
    setMessage(null);
    try {
      const origin =
        process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://127.0.0.1:3000";
      const params = new URLSearchParams();
      if (status) params.set(statusParam ?? "status", status);
      if (q) params.set("q", q);
      const suffix = params.toString();
      const token = getAccessToken();
      const response = await fetch(
        `${origin}${exportPath}${suffix ? `?${suffix}` : ""}`,
        {
          headers: token ? { authorization: `Bearer ${token}` } : {},
        },
      );
      if (!response.ok) {
        const text = await response.text();
        setMessage(`导出失败（${response.status}）：${text.slice(0, 200)}`);
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = exportFileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage(`导出失败：${errorText(error)}`);
    } finally {
      setExporting(false);
    }
  };

  /** 这一轮只定 UI：没实现的按钮点一下只说实话，不做假动作。 */
  const notImplemented = () => {
    setPendingHint("功能待实现（先定 UI，后添功能）");
  };

  const unauthorized =
    listQuery.error instanceof Error &&
    (listQuery.error as { status?: number }).status === 401;

  const chips = statusOptions ?? [];

  return (
    <div className="pw-dg flex flex-col gap-4">
      {message ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {message}
        </div>
      ) : null}
      {/* 稿子：卡片顶部就是一条工具栏（没有"数据表格"标题与说明文字），表格与合计行贴边 */}
      <Card className="overflow-hidden border-[var(--mc-line)] shadow-none">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--mc-line)] px-3 py-2.5">
          <div className="flex min-w-60 items-center gap-1.5 rounded-lg border border-[var(--mc-line)] px-2 py-[5px]">
            <span aria-hidden="true" className="text-[12px] leading-none">
              🔍
            </span>
            <input
              aria-label="查找（任意列）"
              className="w-[150px] min-w-0 bg-transparent text-[12.5px] text-[var(--mc-ink)] outline-none placeholder:text-[var(--mc-muted)]"
              placeholder={searchPlaceholder}
              value={qInput}
              onChange={(event) => setQInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                setPendingHint(null);
                setQ(qInput.trim());
                setPage(1);
              }}
            />
            <span className="pw-dg-kbd">Ctrl</span>
            <span className="pw-dg-kbd">F</span>
          </div>

          {chips.map((option) => {
            const active = status === option.value;
            const label =
              option.value === "" && listQuery.data
                ? `全部 ${total}`
                : option.label;
            return (
              <button
                key={option.value || "all"}
                type="button"
                aria-pressed={active}
                className={`pw-dg-chip${active ? " pw-dg-chip--on" : ""}`}
                onClick={() => {
                  setPendingHint(null);
                  setStatus(option.value);
                  setPage(1);
                }}
              >
                {label}
              </button>
            );
          })}

          <button type="button" className="pw-dg-btn" onClick={notImplemented}>
            列显示 ▾
          </button>
          {exportPath ? (
            <button
              type="button"
              className="pw-dg-btn"
              disabled={exporting}
              onClick={() => void downloadCsv()}
            >
              {exporting ? "导出中…" : "导出 CSV"}
            </button>
          ) : null}
          <button type="button" className="pw-dg-btn" onClick={notImplemented}>
            导出 Excel
          </button>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-[12px] text-[var(--mc-muted)]">
              已选 {selectedCount} 条
            </span>
            <button
              type="button"
              className="pw-dg-btn"
              onClick={notImplemented}
            >
              批量导出
            </button>
            <button
              type="button"
              className="pw-dg-btn"
              onClick={notImplemented}
            >
              批量操作 ▾
            </button>
          </div>
        </div>

        {pendingHint ? <div className="pw-dg-hint">{pendingHint}</div> : null}

        {listQuery.isError && !unauthorized ? (
          <p className="px-3 pt-3 text-sm text-destructive">
            加载失败：{errorText(listQuery.error)}
          </p>
        ) : null}
        {unauthorized ? (
          <p className="px-3 pt-3 text-sm text-destructive">
            登录已失效，请重新登录后再打开本页。
          </p>
        ) : null}
        <div ref={containerRef} />
      </Card>
    </div>
  );
}

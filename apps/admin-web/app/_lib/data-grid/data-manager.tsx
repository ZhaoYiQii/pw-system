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
 */

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getAccessToken, apiFetch } from "../api";
import { formatFenYuan } from "../money";
// 先加载 Tabulator 自带的基础样式，再用我们的映射覆盖（否则表格是"没穿衣服"的 div）
import "tabulator-tables/dist/css/tabulator.min.css";
import "./data-grid.css";
import type {
  DataGridColumn,
  DataGridPage,
  DataManagerProps,
  DataGridTone,
} from "./types";

type TabulatorTable = import("tabulator-tables").Tabulator;
type TabulatorColumnDefinition = import("tabulator-tables").ColumnDefinition;
type TabulatorOptions = import("tabulator-tables").Options;

const TONE_CLASS: Record<DataGridTone, string> = {
  ok: "pw-dg-badge--ok",
  wait: "pw-dg-badge--wait",
  bad: "pw-dg-badge--bad",
  muted: "pw-dg-badge--muted",
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function DataManager<T extends { id: string }>({
  resource,
  columns,
  statusParam,
  statusOptions,
  searchPlaceholder = "按关键词查找（回车）",
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
  const [exporting, setExporting] = useState(false);

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
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const toggleSort = useCallback((field: string) => {
    setPage(1);
    setSortBy((current) => {
      setSortDir((dir) =>
        current === field && dir === "desc" ? "asc" : "desc",
      );
      return field;
    });
  }, []);

  // 建表：只建一次（列定义是模块级常量）；数据/排序变化走下面的 effect。
  useEffect(() => {
    let disposed = false;
    void (async () => {
      const mod = await import("tabulator-tables");
      if (disposed || !containerRef.current) return;
      const definitions: TabulatorColumnDefinition[] = columns.map((column) =>
        buildColumnDefinition(column),
      );
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
        if (field) toggleSort(field);
      });
    })();
    return () => {
      disposed = true;
      tableRef.current?.destroy();
      tableRef.current = null;
    };
  }, [columns, height, emptyHint, toggleSort]);

  // 数据更新（换页/筛选/排序后）
  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    void table.replaceData(rows as unknown as Array<Record<string, unknown>>);
  }, [rows]);

  // 排序指示器：标题上挂 ▲/▼（Tabulator 自己的箭头随 headerSort 一起被关掉了）
  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    for (const column of columns) {
      const active = column.key === sortBy && column.sortable !== false;
      const arrow = active ? (sortDir === "asc" ? " ▲" : " ▼") : "";
      void table.updateColumnDefinition(column.key, {
        title: `${column.title}${arrow}`,
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

  const unauthorized =
    listQuery.error instanceof Error &&
    (listQuery.error as { status?: number }).status === 401;

  return (
    <div className="pw-dg flex flex-col gap-4">
      {message ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {message}
        </div>
      ) : null}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="mr-2 text-base">数据表格</CardTitle>
            <CardDescription className="mr-auto text-xs">
              点表头排序（服务端）、拖拽列宽、框选区域 Ctrl+C 复制、Ctrl+V
              粘贴到 Excel。 合计行 = 当前页合计。
            </CardDescription>
            <div className="flex items-center gap-2">
              <Input
                aria-label="查找"
                className="w-52"
                placeholder={searchPlaceholder}
                value={qInput}
                onChange={(event) => setQInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    setQ(qInput.trim());
                    setPage(1);
                  }
                }}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setQ(qInput.trim());
                  setPage(1);
                }}
              >
                查找
              </Button>
              {q ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setQInput("");
                    setQ("");
                    setPage(1);
                  }}
                >
                  清空
                </Button>
              ) : null}
              {exportPath ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={exporting}
                  onClick={() => void downloadCsv()}
                >
                  {exporting ? "导出中…" : "导出 CSV"}
                </Button>
              ) : null}
            </div>
          </div>
          {statusOptions && statusOptions.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {statusOptions.map((option) => (
                <Button
                  key={option.value || "all"}
                  size="sm"
                  variant={status === option.value ? "default" : "outline"}
                  onClick={() => {
                    setStatus(option.value);
                    setPage(1);
                  }}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {listQuery.isError && !unauthorized ? (
            <p className="text-sm text-destructive">
              加载失败：{errorText(listQuery.error)}
            </p>
          ) : null}
          {unauthorized ? (
            <p className="text-sm text-destructive">
              登录已失效，请重新登录后再打开本页。
            </p>
          ) : null}
          <div ref={containerRef} />
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>
              共 <b className="font-mono text-foreground">{total}</b> 条
              {q ? ` · 关键词「${q}」` : ""}
            </span>
            <span className="ml-auto" />
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1 || listQuery.isFetching}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              上一页
            </Button>
            <span>
              第 <b className="font-mono text-foreground">{page}</b> /{" "}
              {totalPages} 页
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages || listQuery.isFetching}
              onClick={() => setPage((current) => current + 1)}
            >
              下一页
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** 列定义 → Tabulator 列定义（只在这里出现 Tabulator 的字段名）。 */
function buildColumnDefinition<T>(
  column: DataGridColumn<T>,
): TabulatorColumnDefinition {
  const definition: TabulatorColumnDefinition = {
    field: column.key,
    title: column.title,
    headerSort: false,
    resizable: true,
    ...(column.width ? { width: column.width } : {}),
    ...(column.minWidth ? { minWidth: column.minWidth } : {}),
    ...(column.frozen ? { frozen: true } : {}),
    ...(column.numeric || column.money ? { hozAlign: "right" } : {}),
  };
  if (column.money) {
    definition.formatter = (cell) =>
      numberSpan(formatFenYuan(String(cell.getValue() ?? "0")));
    // 当前页合计：整数分求和（不经过浮点），再由 formatter 渲染成元
    definition.bottomCalc = (values) =>
      values
        .reduce<bigint>(
          (sum, value) => sum + BigInt(String(value ?? "0") || "0"),
          0n,
        )
        .toString();
    definition.bottomCalcFormatter = (cell) =>
      numberSpan(formatFenYuan(String(cell.getValue() ?? "0")));
  } else if (column.badge) {
    definition.formatter = (cell) => {
      const row = cell.getRow().getData() as T;
      const badge = column.badge?.(cell.getValue(), row);
      if (!badge) return textSpan("—", "pw-dg-muted");
      const span = document.createElement("span");
      span.className = `pw-dg-badge ${TONE_CLASS[badge.tone]}`;
      span.textContent = badge.label;
      return span;
    };
  } else if (column.text) {
    definition.formatter = (cell) => {
      const row = cell.getRow().getData() as T;
      return textSpan(column.text?.(cell.getValue(), row) ?? "—");
    };
  }
  return definition;
}

function textSpan(text: string, className?: string): HTMLElement {
  const span = document.createElement("span");
  if (className) span.className = className;
  span.textContent = text;
  return span;
}

function numberSpan(text: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "pw-dg-num";
  span.textContent = text;
  return span;
}

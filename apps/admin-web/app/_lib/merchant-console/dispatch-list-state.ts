/**
 * 派单工作台列表增强（Slice 1）的纯逻辑：状态计数 / 时间范围 / 关键字 / 排序 / 分页 / 勾选 / 导出。
 *
 * 为什么单独成模块：这些都是客户端派生逻辑，页面里只负责渲染与交互；
 * 纯函数便于单测（先红后绿），也避免把未验证的过滤规则写进 JSX。
 */

export type DispatchListKind = "CLASSIC" | "GD";

/** 列表行（与页面里的 UnifiedOrder 同形；本地定义避免循环依赖）。 */
export interface DispatchListRow {
  key: string;
  id: string;
  kind: DispatchListKind;
  no: string;
  customerName: string;
  status: string;
  durationText: string;
  createdAt: string;
}

export type RangeKey = "TODAY" | "LAST_3D" | "ALL";
export type SortKey = "CREATED_DESC" | "CREATED_ASC" | "STATUS";

export const PAGE_SIZES = [20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export interface DispatchListFilters {
  status: string;
  query: string;
  range: RangeKey;
  sort: SortKey;
}

/** 状态计数：`ALL` 计入总数；未出现的状态计 0（页签始终显示）。 */
export function statusCounts(
  rows: readonly DispatchListRow[],
  statuses: readonly string[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const status of statuses) {
    counts[status] =
      status === "ALL"
        ? rows.length
        : rows.filter((row) => row.status === status).length;
  }
  return counts;
}

/** 当天 00:00（本地时区）作为"今天"的起点。 */
function startOfLocalDay(now: Date): Date {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day;
}

function rangeStart(range: RangeKey, now: Date): Date | null {
  if (range === "ALL") return null;
  const today = startOfLocalDay(now);
  if (range === "TODAY") return today;
  // 近 3 天 = 今天 + 前两天（含边界）
  const threeDays = new Date(today);
  threeDays.setDate(threeDays.getDate() - 2);
  return threeDays;
}

/** 时间范围 + 状态 + 关键字（编号/客户/类型，大小写不敏感）。 */
export function filterRows(
  rows: readonly DispatchListRow[],
  filters: DispatchListFilters,
  now: Date = new Date(),
): DispatchListRow[] {
  const start = rangeStart(filters.range, now);
  const keyword = filters.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.status !== "ALL" && row.status !== filters.status) return false;
    if (start) {
      const created = new Date(row.createdAt);
      if (Number.isNaN(created.getTime()) || created < start) return false;
    }
    if (!keyword) return true;
    return [row.no, row.customerName, row.kind].some((text) =>
      text.toLowerCase().includes(keyword),
    );
  });
}

/**
 * 排序：创建时间倒序（默认）/ 正序 / 按状态表顺序（同状态内仍按创建时间倒序）。
 * 状态不在表内时排到最后，保证顺序稳定可预期。
 */
export function sortRows(
  rows: readonly DispatchListRow[],
  sort: SortKey,
  statusOrder: readonly string[] = [],
): DispatchListRow[] {
  const byCreatedDesc = (a: DispatchListRow, b: DispatchListRow) =>
    b.createdAt.localeCompare(a.createdAt);
  if (sort === "CREATED_DESC") return [...rows].sort(byCreatedDesc);
  if (sort === "CREATED_ASC")
    return [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const order = new Map(statusOrder.map((status, index) => [status, index]));
  return [...rows].sort((a, b) => {
    const ai = order.get(a.status) ?? Number.MAX_SAFE_INTEGER;
    const bi = order.get(b.status) ?? Number.MAX_SAFE_INTEGER;
    return ai === bi ? byCreatedDesc(a, b) : ai - bi;
  });
}

export function pageCount(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/** 页码收敛：1 起、不超过最后一页（筛选变化后避免停在空页）。 */
export function clampPage(
  page: number,
  total: number,
  pageSize: number,
): number {
  const last = pageCount(total, pageSize);
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(Math.trunc(page), 1), last);
}

export interface DispatchListPage {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: DispatchListRow[];
}

export function paginate(
  rows: readonly DispatchListRow[],
  page: number,
  pageSize: number,
): DispatchListPage {
  const size = Math.max(1, Math.trunc(pageSize));
  const total = rows.length;
  const current = clampPage(page, total, size);
  const start = (current - 1) * size;
  return {
    page: current,
    pageSize: size,
    total,
    totalPages: pageCount(total, size),
    items: rows.slice(start, start + size),
  };
}

/** 单行勾选切换（不修改入参集合）。 */
export function toggleRow(
  selected: ReadonlySet<string>,
  key: string,
  next?: boolean,
): Set<string> {
  const result = new Set(selected);
  const shouldSelect = next ?? !result.has(key);
  if (shouldSelect) result.add(key);
  else result.delete(key);
  return result;
}

/**
 * 「当页全选」：当页全部已选时取消当页；否则补齐当页。
 * 只影响当页 key，不跨页误选/误清。
 */
export function toggleAllOnPage(
  selected: ReadonlySet<string>,
  pageKeys: readonly string[],
): Set<string> {
  const result = new Set(selected);
  const allSelected =
    pageKeys.length > 0 && pageKeys.every((key) => result.has(key));
  for (const key of pageKeys) {
    if (allSelected) result.delete(key);
    else result.add(key);
  }
  return result;
}

/** 批量操作前的汇总：总数 + 按状态计数（前端据此决定"通过/释放"是否可用）。 */
export function selectedSummary(
  rows: readonly DispatchListRow[],
  selected: ReadonlySet<string>,
): { count: number; byStatus: Record<string, number> } {
  const byStatus: Record<string, number> = {};
  let count = 0;
  for (const row of rows) {
    if (!selected.has(row.key)) continue;
    count += 1;
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
  }
  return { count, byStatus };
}

const CSV_HEADER = [
  "单号",
  "类型",
  "客户",
  "时长",
  "状态",
  "创建时间",
] as const;

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** 导出 CSV：表头固定；含逗号/引号/换行的字段按 RFC4180 转义；保持传入顺序。 */
export function buildCsv(rows: readonly DispatchListRow[]): string {
  const lines = [CSV_HEADER.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.no,
        row.kind,
        row.customerName,
        row.durationText,
        row.status,
        row.createdAt,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}

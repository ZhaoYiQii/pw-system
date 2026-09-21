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
  /** 已选中陪玩名；未选人为 null 或缺失（旧调用方不传）。 */
  playerName?: string | null;
  /** 预计开始时间（ISO 8601）；缺时间时不参与「赶场」判定。 */
  startAt?: string | null;
  /** 服务时长（分钟）；缺时间时不参与「赶场」判定。 */
  durationMinutes?: number | null;
}

/**
 * 列表接口的响应形状兜底：`{ data, total }` 是约定的形状，但取数层（`apiFetch` 的解包 +
 * Next 打包/预取）可能只把 `data` 交到调用方手里。列出两种形状都当合法输入，
 * 并把 `total` 回落到数组长度，避免整页因为形状差异变成「假空」。
 */
export function normalizeListResponse(payload: unknown): {
  rows: unknown[];
  total: number;
} {
  if (Array.isArray(payload)) {
    return { rows: payload, total: payload.length };
  }
  if (payload !== null && typeof payload === "object") {
    const record = payload as { data?: unknown; total?: unknown };
    const rows = Array.isArray(record.data) ? record.data : [];
    const total =
      typeof record.total === "number" && Number.isFinite(record.total)
        ? record.total
        : rows.length;
    return { rows, total };
  }
  return { rows: [], total: 0 };
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

/**
 * 页签计数（服务端同口径）：
 * - `全部` 用服务端返回的 `total`（当前筛选条件下的权威总数），不是当前数据集长度；
 * - 各状态用当前数据集内的分布（筛选已在服务端完成，避免 10 次分状态请求）；
 * - 负值 / 非有限值一律回落成 0，不把脏输入渲染到页签上。
 */
export function tabCounts(
  rows: readonly DispatchListRow[],
  statuses: readonly string[],
  serverTotal: number,
): Record<string, number> {
  const total =
    Number.isFinite(serverTotal) && serverTotal > 0
      ? Math.trunc(serverTotal)
      : 0;
  const counts: Record<string, number> = {};
  for (const status of statuses) {
    counts[status] =
      status === "ALL"
        ? total
        : rows.filter((row) => row.status === status).length;
  }
  return counts;
}

/** 「赶场」预警阈值：同一位陪玩两单的间隔小于它（分钟）就提示。 */
export const RUSH_GAP_MINUTES = 60;

export interface PlayerGroup {
  /** `null` 表示还没选到陪玩的订单（单分一组，不与任何人并列）。 */
  playerName: string | null;
  rows: DispatchListRow[];
  /** 该组内需要重点核对的「赶场」订单 key（时间相邻或重叠）。 */
  rushKeys: string[];
}

interface TimedRow {
  key: string;
  start: number;
  end: number;
}

/** 行的时间窗口；缺 startAt / durationMinutes 或解析失败返回 null（不参与赶场判定）。 */
function timeWindow(row: DispatchListRow): TimedRow | null {
  const start = row.startAt ? Date.parse(row.startAt) : Number.NaN;
  const minutes = row.durationMinutes;
  if (Number.isNaN(start)) return null;
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) {
    return null;
  }
  return { key: row.key, start, end: start + Math.max(0, minutes) * 60_000 };
}

/**
 * 按陪玩分组（列表「按陪玩分组 + 赶场提示」）：
 * - 未选到陪玩的行归入 `playerName: null` 一组，永远不参与赶场判定；
 * - 组内所有带时间的行按时间排序，任一两单的间隔小于 {@link RUSH_GAP_MINUTES} 分钟
 *   （含重叠）即把这两单都标进 `rushKeys`；
 * - 缺时间信息的行照常分组，但不标警示（不臆造时间）。
 */
export function groupByPlayer(rows: readonly DispatchListRow[]): PlayerGroup[] {
  const groups = new Map<string, DispatchListRow[]>();
  for (const row of rows) {
    const name = row.playerName ?? null;
    const key = name === null ? "\u0000UNASSIGNED" : name;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  const gapMs = RUSH_GAP_MINUTES * 60_000;
  return [...groups.entries()].map(([key, groupRows]) => {
    const rushKeys: string[] = [];
    if (key !== "\u0000UNASSIGNED") {
      const timed = groupRows
        .map(timeWindow)
        .filter((item): item is TimedRow => item !== null)
        .sort((a, b) => a.start - b.start);
      for (let index = 1; index < timed.length; index += 1) {
        const previous = timed[index - 1];
        const current = timed[index];
        if (!previous || !current) continue;
        if (current.start - previous.end < gapMs) {
          if (!rushKeys.includes(previous.key)) rushKeys.push(previous.key);
          if (!rushKeys.includes(current.key)) rushKeys.push(current.key);
        }
      }
    }
    return {
      playerName: key === "\u0000UNASSIGNED" ? null : key,
      rows: groupRows,
      rushKeys,
    };
  });
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

/**
 * 通用 CSV 组装：表头由调用方给；含逗号/引号/换行的字段按 RFC4180 转义；保持传入顺序。
 *
 * 列表页的列比默认 6 列多（陪玩 / 金额 / 开始时间），所以把「列」抽成参数，
 * 而不是在页面里重写一遍转义逻辑。
 */
export function buildCsvForColumns<T extends DispatchListRow>(
  columns: readonly string[],
  rows: readonly T[],
  project: (row: T) => readonly string[],
): string {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(project(row).map(csvCell).join(","));
  }
  return lines.join("\n");
}

/** 导出 CSV：表头固定；含逗号/引号/换行的字段按 RFC4180 转义；保持传入顺序。 */
export function buildCsv(rows: readonly DispatchListRow[]): string {
  return buildCsvForColumns(CSV_HEADER, rows, (row) => [
    row.no,
    row.kind,
    row.customerName,
    row.durationText,
    row.status,
    row.createdAt,
  ]);
}

/** 时间范围 → 服务端筛选参数（`from` 含边界）；`ALL` 与自定义上界为空。 */
export function rangeStartIso(
  range: RangeKey,
  now: Date = new Date(),
): string | null {
  const start = rangeStart(range, now);
  return start ? start.toISOString() : null;
}

/**
 * 「导出 = 按选中导出」：只导出选中的行，**保持传入顺序**（即当前列表看到的顺序），
 * 不是勾选顺序、也不是全部筛选结果。未选中任何行时返回 null，由调用方提示而不是导出空文件。
 *
 * 选中集合是跨页的 key 集合，所以这里用集合过滤当前数据集即可覆盖「跨页勾选」的场景。
 */
export function buildSelectedCsv(
  rows: readonly DispatchListRow[],
  selected: ReadonlySet<string>,
): string | null {
  if (selected.size === 0) return null;
  const picked = rows.filter((row) => selected.has(row.key));
  if (picked.length === 0) return null;
  return buildCsv(picked);
}

/**
 * 「按选中导出 + 自定义列」：只导出选中的行，保持传入顺序（列表当前顺序），
 * 未选中任何行时返回 null。
 */
export function buildSelectedCsvForColumns<T extends DispatchListRow>(
  columns: readonly string[],
  rows: readonly T[],
  selected: ReadonlySet<string>,
  project: (row: T) => readonly string[],
): string | null {
  if (selected.size === 0) return null;
  const picked = rows.filter((row) => selected.has(row.key));
  if (picked.length === 0) return null;
  return buildCsvForColumns(columns, picked, project);
}

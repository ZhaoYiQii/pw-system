/**
 * P3 / D3：违约台账的筛选参数与分页纯函数（供组件与单测共用）。
 *
 * 约定：
 * - 日期筛选用 `<input type="date">` 的 `YYYY-MM-DD`，转成**含当天**的本地时间区间
 *   （from = 当天 00:00:00.000，to = 当天 23:59:59.999），再以 ISO 串发给后端；
 * - 非法/空输入不产生查询参数（后端只校验格式，不做猜测）；
 * - 分页用 offset/limit，limit 默认 20、上限 100（与后端一致）。
 */

export const BREACH_PAGE_SIZE = 20;
export const BREACH_PAGE_SIZE_MAX = 100;

export interface BreachLedgerFilters {
  /** YYYY-MM-DD；空串表示不筛选。 */
  from: string;
  to: string;
  playerId: string;
  offset: number;
  limit?: number;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseDay(value: string): Date | null {
  if (!DATE_ONLY.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 当天起点（本地时区）→ ISO 串；非法输入返回 null。 */
export function dayStartIso(value: string): string | null {
  const date = parseDay(value);
  return date ? date.toISOString() : null;
}

/** 当天终点（本地时区 23:59:59.999）→ ISO 串；非法输入返回 null。 */
export function dayEndIso(value: string): string | null {
  const date = parseDay(value);
  if (!date) return null;
  date.setHours(23, 59, 59, 999);
  return date.toISOString();
}

/** 归一化 limit：缺省 20，1–100。 */
export function normalizeBreachLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return BREACH_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(limit), 1), BREACH_PAGE_SIZE_MAX);
}

/** 组装查询串（不含前导 `?`）；无参数时返回空串。 */
export function buildBreachLedgerQuery(filters: BreachLedgerFilters): string {
  const params = new URLSearchParams();
  const fromIso = dayStartIso(filters.from);
  const toIso = dayEndIso(filters.to);
  if (fromIso) params.set("from", fromIso);
  if (toIso) params.set("to", toIso);
  if (filters.playerId) params.set("playerId", filters.playerId);
  if (filters.offset > 0)
    params.set("offset", String(Math.trunc(filters.offset)));
  params.set("limit", String(normalizeBreachLimit(filters.limit)));
  return params.toString();
}

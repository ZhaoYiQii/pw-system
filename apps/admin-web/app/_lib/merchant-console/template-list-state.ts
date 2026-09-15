/**
 * 模板管理页的 URL 状态：筛选、排序、选中模板与编辑标签只存在 URL 里。
 *
 * 约定：
 * - 只允许 game/status/q/sort/id/tab 六个键，客户隐私与表单值一律不进 URL；
 * - 非法值一律回退默认，不抛错（分享链接被改坏时页面仍可用）；
 * - `game=unclassified` 表示"未归类旧模板"：契约没有该查询参数，
 *   因此不发 gameId，由界面在已加载结果内筛选（见 toListQuery 注释）。
 */
import type {
  TemplateListQuery,
  TemplateSort,
  TemplateStatusFilter,
} from "./template-api";

export const TEMPLATE_TABS = ["content", "binding", "release"] as const;
export type TemplateTab = (typeof TEMPLATE_TABS)[number];

export const TEMPLATE_LIST_SORTS: readonly TemplateSort[] = [
  "UPDATED_DESC",
  "UPDATED_ASC",
  "NAME_ASC",
  "LAST_USED_DESC",
];

export const TEMPLATE_LIST_STATUSES: readonly TemplateStatusFilter[] = [
  "DRAFT",
  "PUBLISHED",
  "UNPUBLISHED_CHANGES",
  "ARCHIVED",
];

/** `game` 取该值时表示只筛"未归类"（gameId 为空）的旧模板。 */
export const UNCLASSIFIED_GAME = "unclassified";

export const DEFAULT_TEMPLATE_LIST_SEARCH = {
  game: "all",
  status: "all",
  q: "",
  sort: "UPDATED_DESC",
  id: null,
  tab: "content",
} as const satisfies TemplateListSearch;

export interface TemplateListSearch {
  /** "all" | "unclassified" | gameId */
  game: string;
  status: TemplateStatusFilter | "all";
  q: string;
  sort: TemplateSort;
  id: string | null;
  tab: TemplateTab;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_QUERY_LENGTH = 100;

function isSort(value: string): value is TemplateSort {
  return (TEMPLATE_LIST_SORTS as readonly string[]).includes(value);
}

function isStatus(value: string): value is TemplateStatusFilter {
  return (TEMPLATE_LIST_STATUSES as readonly string[]).includes(value);
}

function isTab(value: string): value is TemplateTab {
  return (TEMPLATE_TABS as readonly string[]).includes(value);
}

export function parseTemplateListSearch(
  search: string | URLSearchParams,
): TemplateListSearch {
  const params =
    typeof search === "string"
      ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
      : search;

  const rawGame = params.get("game") ?? "";
  const rawStatus = params.get("status") ?? "";
  const rawSort = params.get("sort") ?? "";
  const rawTab = params.get("tab") ?? "";
  const rawId = params.get("id") ?? "";
  const q = (params.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH);

  return {
    game:
      rawGame === UNCLASSIFIED_GAME
        ? UNCLASSIFIED_GAME
        : UUID_PATTERN.test(rawGame)
          ? rawGame
          : "all",
    status: isStatus(rawStatus) ? rawStatus : "all",
    q,
    sort: isSort(rawSort) ? rawSort : "UPDATED_DESC",
    id: UUID_PATTERN.test(rawId) ? rawId : null,
    tab: isTab(rawTab) ? rawTab : "content",
  };
}

/** 默认值不写入 URL，保持链接干净；返回带前导 `?` 的查询串或空串。 */
export function buildTemplateListSearch(
  next: Partial<TemplateListSearch>,
): string {
  const value: TemplateListSearch = {
    ...DEFAULT_TEMPLATE_LIST_SEARCH,
    ...next,
  };
  const params = new URLSearchParams();
  if (value.game !== "all") params.set("game", value.game);
  if (value.status !== "all") params.set("status", value.status);
  const q = value.q.trim().slice(0, MAX_QUERY_LENGTH);
  if (q) params.set("q", q);
  if (value.sort !== "UPDATED_DESC") params.set("sort", value.sort);
  if (value.id) params.set("id", value.id);
  if (value.tab !== "content") params.set("tab", value.tab);

  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

/**
 * URL 状态 → 列表接口查询。
 * `game=unclassified` 无法用契约参数表达（gameId 只接受 uuid），
 * 因此不发 gameId，由调用方在已加载结果内筛 `game.id === ""`。
 */
export function toListQuery(
  search: TemplateListSearch,
  options: { cursor?: string; limit?: number } = {},
): TemplateListQuery {
  const q = search.q.trim();
  return {
    ...(UUID_PATTERN.test(search.game) ? { gameId: search.game } : {}),
    ...(search.status === "all" ? {} : { status: search.status }),
    ...(q ? { q } : {}),
    sort: search.sort,
    ...(options.cursor ? { cursor: options.cursor } : {}),
    ...(options.limit ? { limit: options.limit } : {}),
  };
}

/** 判定模板是否属于"未归类"（契约里 game 用空串表示未归类）。 */
export function isUnclassified(template: { game: { id: string } }): boolean {
  return template.game.id === "";
}

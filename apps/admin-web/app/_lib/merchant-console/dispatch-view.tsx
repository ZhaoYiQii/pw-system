"use client";

/**
 * 订单中心列表（Slice 1）：整页迁到新栈（Tailwind token + components/ui + TanStack Query）。
 *
 * 口径（见 docs/superpowers/plans/2026-09-22-order-center-list.md）：
 * - 数据源只有 `GET /api/v1/tenant/game-dispatch`（服务端筛选 / 排序 / 分页 + `total`）；
 * - 页签计数：`全部` 用服务端 `total`，各状态用当前数据集分布（同口径，不额外发 10 次请求）；
 * - 导出 = 按选中导出（保持列表顺序），不是导出全部筛选结果；
 * - 分页 = 服务端首页 `limit=100` + 本地分页；超过 100 条时提示收窄筛选；
 * - 写动作只接「发布」「释放」「批量通过」「导出 CSV」；资金/争议类动作留在详情页。
 */
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch, ApiError } from "../api";
import { NewOrderButton } from "./new-order-dialog";
import {
  buildSelectedCsvForColumns,
  filterRows,
  groupByPlayer,
  normalizeListResponse,
  paginate,
  rangeStartIso,
  RUSH_GAP_MINUTES,
  selectedSummary,
  tabCounts,
  toggleAllOnPage,
  toggleRow,
  type DispatchListRow,
  type PageSize,
  type PlayerGroup,
  type RangeKey,
  type SortKey,
} from "./dispatch-list-state";
import { statusLabel } from "./merchant-api";
import { useMerchantRole } from "./role-context";

interface GameDispatchListRow {
  orderId: string;
  dispatchNo: string;
  status: string;
  durationMinutes: number;
  customerName: string;
  playerName: string | null;
  unitPriceFen: string | null;
  estimatedAmountFen: string | null;
  createdAt: string;
}

/** 服务端首页上限：服务端 clamp 到 100，这里保持一致，便于「是不是还有更多」的判断。 */
const SERVER_LIMIT = 100;

const STATUS_ORDER = [
  "DRAFT",
  "CONFIRMED",
  "DISPATCHING",
  "ASSIGNED",
  "READY",
  "IN_PROGRESS",
  "PENDING_CONFIRMATION",
  "COMPLETED",
  "CANCELLED",
] as const;

const TABS = [
  { id: "ALL", label: "全部" },
  ...STATUS_ORDER.map((status) => ({ id: status, label: statusLabel(status) })),
] as const;

const PAGE_SIZE_OPTIONS: PageSize[] = [20, 50, 100];

const RANGE_OPTIONS: Array<{ id: RangeKey; label: string }> = [
  { id: "ALL", label: "全部时间" },
  { id: "TODAY", label: "今天" },
  { id: "LAST_3D", label: "近 3 天" },
];

const SORT_OPTIONS: Array<{ id: SortKey; label: string }> = [
  { id: "CREATED_DESC", label: "创建时间 ↓" },
  { id: "CREATED_ASC", label: "创建时间 ↑" },
  { id: "STATUS", label: "按状态顺序" },
];

const COLUMNS = [
  { id: "no", label: "单号" },
  { id: "status", label: "状态" },
  { id: "customer", label: "老板" },
  { id: "player", label: "陪玩" },
  { id: "duration", label: "时长" },
  { id: "amount", label: "预估金额" },
  { id: "createdAt", label: "创建时间" },
] as const;
type ColumnId = (typeof COLUMNS)[number]["id"];

/** 导出列（比屏幕多一列「开始时间」，给对账用）。 */
const CSV_COLUMNS = [
  "单号",
  "状态",
  "老板",
  "陪玩",
  "时长",
  "预估金额（元）",
  "开始时间",
  "创建时间",
];

/** 允许「发布」（草稿 → 开放报名）的状态，与服务端 `publish` 的校验一致。 */
const PUBLISHABLE = new Set(["DRAFT", "CONFIRMED"]);
/** 允许「释放名额」的状态：释放后回到报名阶段。 */
const RELEASABLE = new Set(["ASSIGNED", "READY", "IN_PROGRESS"]);

interface DispatchListRowView extends DispatchListRow {
  playerName: string | null;
  durationMinutes: number;
  amountFen: string | null;
  startAt: string | null;
}

interface FilterState {
  status: string;
  query: string;
  range: RangeKey;
  sort: SortKey;
  gameId: string;
  playerId: string;
  customerProfileId: string;
  minAmountFen: string;
  maxAmountFen: string;
  pageSize: PageSize;
}

const INITIAL_FILTERS: FilterState = {
  status: "ALL",
  query: "",
  range: "ALL",
  sort: "CREATED_DESC",
  gameId: "",
  playerId: "",
  customerProfileId: "",
  minAmountFen: "",
  maxAmountFen: "",
  pageSize: 20,
};

function formatDateTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString("zh-CN", { hour12: false });
}

function formatAmount(amountFen: string | null): string {
  if (amountFen === null) return "—";
  // 金额一律整数分；这里只做展示换算，不参与计算（平台费 = 0）。
  const fen = Number(amountFen);
  if (!Number.isFinite(fen)) return amountFen;
  return `${(fen / 100).toFixed(2)} 元`;
}

function statusVariant(status: string) {
  if (status === "CANCELLED") return "destructive" as const;
  if (status === "COMPLETED" || status === "ASSIGNED" || status === "READY") {
    return "secondary" as const;
  }
  return "outline" as const;
}

function buildQuery(filters: FilterState): string {
  const params = new URLSearchParams();
  params.set("limit", String(SERVER_LIMIT));
  // 状态也走服务端：否则「最近 100 条」里可能一条该状态的单都没有，页签点进去会假空
  // （台账 E2E 就是这么暴露出来的）。页面里的 filterRows 仍按同一条件再过滤一次，
  // 服务端已经收窄时它不会改变结果，语义保持幂等。
  if (filters.status !== "ALL") params.set("status", filters.status);
  if (filters.sort === "CREATED_ASC") params.set("sort", "created_asc");
  else if (filters.sort === "STATUS") params.set("sort", "status");
  const from = rangeStartIso(filters.range);
  if (from) params.set("from", from);
  if (filters.gameId) params.set("gameId", filters.gameId);
  if (filters.playerId) params.set("playerId", filters.playerId);
  if (filters.customerProfileId) {
    params.set("customerProfileId", filters.customerProfileId);
  }
  // 金额区间只接受整数分；非法输入不发请求（界面会提示）。
  if (/^\d+$/.test(filters.minAmountFen)) {
    params.set("minAmountFen", filters.minAmountFen);
  }
  if (/^\d+$/.test(filters.maxAmountFen)) {
    params.set("maxAmountFen", filters.maxAmountFen);
  }
  return params.toString();
}

async function fetchDispatchList(
  filters: FilterState,
): Promise<{ data: GameDispatchListRow[]; total: number }> {
  const query = buildQuery(filters);
  const body = await apiFetch<unknown>(`/api/v1/tenant/game-dispatch?${query}`);
  // 响应形状兼容：正常情况下是 `{ data, total }`；若中间层已把 `data` 解包成数组，
  // 就按数组处理（`total` 回落到长度），避免整页因为形状差异变成假空。
  const { rows, total } = normalizeListResponse(body);
  return { data: rows as GameDispatchListRow[], total };
}

export function DispatchListView() {
  const queryClient = useQueryClient();
  const { role, forbidden } = useMerchantRole();
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hiddenColumns, setHiddenColumns] = useState<Set<ColumnId>>(new Set());
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);

  // 工作台深链：`?status=DRAFT` 直接进对应页签（E2E 依赖）。
  useEffect(() => {
    const statusParam = new URLSearchParams(window.location.search).get(
      "status",
    );
    if (statusParam) {
      setFilters((current) => ({ ...current, status: statusParam }));
    }
  }, []);

  const listQuery = useQuery({
    queryKey: ["merchant", "dispatch", "list", filters],
    queryFn: () => fetchDispatchList(filters),
    placeholderData: (previous) => previous,
  });
  const gamesQuery = useQuery({
    queryKey: ["merchant", "dispatch", "games"],
    queryFn: () =>
      apiFetch<{ id: string; name: string }[]>("/api/v1/tenant/catalog/games"),
  });
  const playersQuery = useQuery({
    queryKey: ["merchant", "dispatch", "players"],
    queryFn: () =>
      apiFetch<{ id: string; name: string }[]>("/api/v1/tenant/players"),
  });
  const customersQuery = useQuery({
    queryKey: ["merchant", "dispatch", "customers"],
    queryFn: () =>
      apiFetch<Array<{ id: string; name: string }>>("/api/v1/tenant/customers"),
  });

  const serverRows = listQuery.data?.data ?? [];
  const serverTotal = listQuery.data?.total ?? 0;

  // 服务端行 → 纯逻辑行（页面不重写过滤规则，只做映射 + 组装）。
  const mapped = useMemo<DispatchListRowView[]>(
    () =>
      serverRows.map((row) => ({
        key: row.orderId,
        id: row.orderId,
        kind: "GD" as const,
        no: row.dispatchNo,
        customerName: row.customerName,
        status: row.status,
        durationText: `${row.durationMinutes} 分钟`,
        createdAt: row.createdAt,
        playerName: row.playerName,
        durationMinutes: row.durationMinutes,
        amountFen: row.estimatedAmountFen,
        startAt: null,
      })),
    [serverRows],
  );

  const filtered = useMemo(
    // `mapped` 全是 `DispatchListRowView`，过滤不改行形状。
    () => filterRows(mapped, filters) as DispatchListRowView[],
    [mapped, filters],
  );
  const paged = useMemo(
    () => paginate(filtered, page, filters.pageSize),
    [filtered, page, filters.pageSize],
  );
  const groups = useMemo(() => groupByPlayer(paged.items), [paged.items]);
  const rushKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const group of groups) for (const key of group.rushKeys) keys.add(key);
    return keys;
  }, [groups]);
  const summary = useMemo(
    () => selectedSummary(filtered, selected),
    [filtered, selected],
  );
  // 页签计数：`全部` 用服务端 total（当前筛选内的权威总数），状态用当前数据集分布。
  const counts = useMemo(
    () =>
      tabCounts(
        mapped,
        TABS.map((tab) => tab.id),
        serverTotal,
      ),
    [mapped, serverTotal],
  );
  const exportableSelected = useMemo(
    () => filtered.filter((row) => selected.has(row.key)).length,
    [filtered, selected],
  );

  const canOperate = role === "OWNER" || role === "ADMIN" || role === "CS";
  const pageKeys = paged.items.map((row) => row.key);
  const allOnPageSelected =
    pageKeys.length > 0 && pageKeys.every((key) => selected.has(key));

  const status = listQuery.isError
    ? listQuery.error instanceof ApiError && listQuery.error.status === 403
      ? "forbidden"
      : "error"
    : listQuery.isLoading
      ? "loading"
      : filtered.length === 0
        ? "empty"
        : "ready";

  function updateFilters(patch: Partial<FilterState>) {
    setFilters((current) => ({ ...current, ...patch }));
    // 筛选一变，页码与勾选回落，避免停在不存在的页上做批量。
    setPage(1);
    setSelected(new Set());
    setNotice(null);
  }

  async function refreshList() {
    await queryClient.invalidateQueries({
      queryKey: ["merchant", "dispatch", "list"],
    });
  }

  async function publishOrder(row: DispatchListRowView): Promise<boolean> {
    try {
      await apiFetch(`/api/v1/tenant/game-dispatch/orders/${row.id}/publish`, {
        method: "POST",
      });
      return true;
    } catch (error) {
      setNotice(
        `${row.no} 发布失败：${
          error instanceof Error ? error.message : "未知错误"
        }`,
      );
      return false;
    }
  }

  async function releaseOrder(row: DispatchListRowView): Promise<boolean> {
    try {
      // 列表行没有 slotId：先读订单详情取回可释放的档位，再逐个释放。
      const detail = await apiFetch<{
        lines: Array<{
          applications: Array<{ slotId: string | null; status: string }>;
        }>;
      }>(`/api/v1/tenant/game-dispatch/orders/${row.id}`);
      const slotIds = detail.lines
        .flatMap((line) => line.applications)
        .filter((application) => application.slotId !== null)
        .map((application) => application.slotId as string);
      if (slotIds.length === 0) {
        setNotice(`${row.no} 没有可释放的名额（可能已被释放）。`);
        return false;
      }
      for (const slotId of slotIds) {
        await apiFetch(`/api/v1/tenant/game-dispatch/slots/${slotId}/release`, {
          method: "POST",
          body: JSON.stringify({ reason: "列表页释放名额" }),
        });
      }
      return true;
    } catch (error) {
      setNotice(
        `${row.no} 释放失败：${
          error instanceof Error ? error.message : "未知错误"
        }`,
      );
      return false;
    }
  }

  async function runRowAction(
    row: DispatchListRowView,
    action: "publish" | "release",
  ) {
    setBusyKeys((current) => new Set(current).add(row.key));
    try {
      const ok =
        action === "publish"
          ? await publishOrder(row)
          : await releaseOrder(row);
      if (ok) {
        setNotice(
          `${row.no} 已${action === "publish" ? "发布" : "释放名额"}。`,
        );
        await refreshList();
      }
    } finally {
      setBusyKeys((current) => {
        const next = new Set(current);
        next.delete(row.key);
        return next;
      });
    }
  }

  /** 批量通过：逐条串行（不做并发突发），失败汇总成一条提示，成功的行刷新掉。 */
  async function runBatchPublish() {
    const targets = filtered.filter(
      (row) => selected.has(row.key) && PUBLISHABLE.has(row.status),
    );
    if (targets.length === 0) return;
    setBatchBusy(true);
    const failures: string[] = [];
    let succeeded = 0;
    try {
      for (const row of targets) {
        const ok = await publishOrder(row);
        if (ok) succeeded += 1;
        else failures.push(row.no);
      }
      setNotice(
        failures.length === 0
          ? `批量通过完成：${succeeded} 单已发布。`
          : `批量通过：成功 ${succeeded} 单，失败 ${failures.length} 单（${failures.join("、")}）。`,
      );
      await refreshList();
      setSelected(new Set());
    } finally {
      setBatchBusy(false);
    }
  }

  function exportSelected() {
    const csv = buildSelectedCsvForColumns(
      CSV_COLUMNS,
      filtered,
      selected,
      (row) => [
        row.no,
        statusLabel(row.status),
        row.customerName,
        row.playerName ?? "未选人",
        row.durationText,
        row.amountFen === null ? "" : (Number(row.amountFen) / 100).toFixed(2),
        row.startAt ? formatDateTime(row.startAt) : "",
        formatDateTime(row.createdAt),
      ],
    );
    if (csv === null) {
      setNotice("先勾选要导出的订单：导出只包含选中的行。");
      return;
    }
    const blob = new Blob(["\uFEFF", csv], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `订单_选中${exportableSelected}单_${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice(`已导出 ${exportableSelected} 单（仅选中项）。`);
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs tracking-widest text-muted-foreground uppercase">
            RECORDS / ORDERS
          </p>
          <h1 className="text-2xl font-semibold">订单与派单</h1>
          <p className="text-sm text-muted-foreground">
            服务端按状态、时间、游戏、陪玩、老板与金额区间筛选；页签计数中「全部」为当前筛选总数。
          </p>
        </div>
        {canOperate ? (
          <NewOrderButton className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90" />
        ) : null}
      </header>

      {notice ? (
        <p
          role="status"
          aria-live="polite"
          className="rounded-md bg-muted px-3 py-2 text-sm"
        >
          {notice}
        </p>
      ) : null}

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block font-medium">搜索</span>
              <span className="flex h-9 items-center gap-1.5 rounded-md border bg-background px-2">
                <Search size={15} aria-hidden="true" />
                <input
                  aria-label="搜索订单"
                  placeholder="单号 / 老板 / 陪玩"
                  className="h-full w-44 bg-transparent text-sm outline-none"
                  value={filters.query}
                  onChange={(event) =>
                    updateFilters({ query: event.target.value })
                  }
                />
              </span>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">时间范围</span>
              <select
                aria-label="时间范围"
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={filters.range}
                onChange={(event) =>
                  updateFilters({ range: event.target.value as RangeKey })
                }
              >
                {RANGE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">游戏</span>
              <select
                aria-label="游戏筛选"
                className="h-9 w-40 rounded-md border bg-background px-3 text-sm"
                value={filters.gameId}
                onChange={(event) =>
                  updateFilters({ gameId: event.target.value })
                }
              >
                <option value="">全部游戏</option>
                {(gamesQuery.data ?? []).map((game) => (
                  <option key={game.id} value={game.id}>
                    {game.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">陪玩</span>
              <select
                aria-label="陪玩筛选"
                className="h-9 w-40 rounded-md border bg-background px-3 text-sm"
                value={filters.playerId}
                onChange={(event) =>
                  updateFilters({ playerId: event.target.value })
                }
              >
                <option value="">全部陪玩</option>
                {(playersQuery.data ?? []).map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">老板</span>
              <select
                aria-label="老板筛选"
                className="h-9 w-40 rounded-md border bg-background px-3 text-sm"
                value={filters.customerProfileId}
                onChange={(event) =>
                  updateFilters({ customerProfileId: event.target.value })
                }
              >
                <option value="">全部老板</option>
                {(customersQuery.data ?? []).map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">金额区间（分）</span>
              <span className="flex items-center gap-1">
                <Input
                  aria-label="金额下界（分）"
                  inputMode="numeric"
                  placeholder="最小"
                  className="h-9 w-24"
                  value={filters.minAmountFen}
                  onChange={(event) =>
                    updateFilters({ minAmountFen: event.target.value })
                  }
                />
                <span className="text-muted-foreground">—</span>
                <Input
                  aria-label="金额上界（分）"
                  inputMode="numeric"
                  placeholder="最大"
                  className="h-9 w-24"
                  value={filters.maxAmountFen}
                  onChange={(event) =>
                    updateFilters({ maxAmountFen: event.target.value })
                  }
                />
              </span>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">排序</span>
              <select
                aria-label="排序"
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={filters.sort}
                onChange={(event) =>
                  updateFilters({ sort: event.target.value as SortKey })
                }
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">每页</span>
              <select
                aria-label="每页条数"
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={filters.pageSize}
                onChange={(event) =>
                  updateFilters({
                    pageSize: Number(event.target.value) as PageSize,
                  })
                }
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size} 条
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="outline"
              size="sm"
              aria-expanded={columnsOpen}
              onClick={() => setColumnsOpen((open) => !open)}
            >
              列设置
            </Button>
            {columnsOpen ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs">
                {COLUMNS.map((column) => (
                  <label key={column.id} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={!hiddenColumns.has(column.id)}
                      aria-label={`显示列：${column.label}`}
                      onChange={() =>
                        setHiddenColumns((current) => {
                          const next = new Set(current);
                          if (next.has(column.id)) next.delete(column.id);
                          else next.add(column.id);
                          return next;
                        })
                      }
                    />
                    {column.label}
                  </label>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setHiddenColumns(new Set())}
                >
                  全部显示
                </Button>
              </div>
            ) : null}
            {filters.minAmountFen && !/^\d+$/.test(filters.minAmountFen) ? (
              <span className="text-sm text-destructive">
                金额下界必须是非负整数分
              </span>
            ) : null}
            {filters.maxAmountFen && !/^\d+$/.test(filters.maxAmountFen) ? (
              <span className="text-sm text-destructive">
                金额上界必须是非负整数分
              </span>
            ) : null}
          </div>

          <div
            role="tablist"
            aria-label="订单状态"
            className="flex flex-wrap gap-1.5"
          >
            {TABS.map((tab) => {
              const active = filters.status === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm ${
                    active
                      ? "border-primary bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                  onClick={() => updateFilters({ status: tab.id })}
                >
                  {tab.label}
                  <span className="rounded bg-muted px-1 text-xs">
                    {counts[tab.id] ?? 0}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            「全部」为当前筛选条件下的服务端总数；各状态为当前已加载数据（最多
            {SERVER_LIMIT} 条）内的分布。
          </p>
        </CardContent>
      </Card>

      {status === "forbidden" ? (
        <Notice title="没有查看订单的权限">
          当前角色没有 `gameDispatch.manage`。请让老板在「门店与套餐 →
          员工与角色」里分配 TENANT_ADMIN / CUSTOMER_SERVICE 角色后再看订单。
        </Notice>
      ) : null}

      {status === "error" ? (
        <Notice title="订单加载失败">
          <p>
            {listQuery.error instanceof Error
              ? listQuery.error.message
              : "请检查 API 服务或登录会话。"}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void listQuery.refetch()}
          >
            重试
          </Button>
        </Notice>
      ) : null}

      <Card>
        <CardContent className="space-y-3 p-4">
          {summary.count > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
              <span>已选 {summary.count} 单</span>
              <span className="text-muted-foreground">
                可发布 {countPublishable(summary.byStatus)} 单 · 可释放{" "}
                {countReleasable(summary.byStatus)} 单
              </span>
              <Button
                size="sm"
                disabled={batchBusy || !canOperate}
                onClick={() => void runBatchPublish()}
              >
                {batchBusy ? "批量通过中…" : "批量通过"}
              </Button>
              <Button variant="outline" size="sm" onClick={exportSelected}>
                导出 CSV（选中 {exportableSelected} 单）
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelected(new Set())}
              >
                清空勾选
              </Button>
            </div>
          ) : null}

          {status === "loading" ? (
            <div className="space-y-2" aria-busy="true" aria-live="polite">
              {[0, 1, 2, 3, 4].map((index) => (
                <div
                  key={index}
                  className="h-9 animate-pulse rounded bg-muted"
                  aria-hidden="true"
                />
              ))}
              <span className="sr-only">正在加载订单…</span>
            </div>
          ) : null}

          {status === "empty" ? (
            <div className="space-y-2 py-8 text-center">
              <p className="font-medium">没有符合条件的订单</p>
              <p className="text-sm text-muted-foreground">
                调整筛选或搜索条件后重试。
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setFilters(INITIAL_FILTERS);
                  setPage(1);
                  setSelected(new Set());
                }}
              >
                清空筛选
              </Button>
            </div>
          ) : null}

          {status === "ready" ? (
            <>
              {serverTotal > SERVER_LIMIT ? (
                <p className="rounded-md bg-muted px-3 py-2 text-sm">
                  命中 {serverTotal} 单，当前只加载了最近 {SERVER_LIMIT}{" "}
                  条：请用时间范围或筛选收窄结果。
                </p>
              ) : null}
              <div className="w-full overflow-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    订单列表（按状态页签筛选，可勾选批量操作）
                  </caption>
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="w-8 px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label="全选本页"
                          checked={allOnPageSelected}
                          onChange={() =>
                            setSelected((current) =>
                              toggleAllOnPage(current, pageKeys),
                            )
                          }
                        />
                      </th>
                      {columnVisible(hiddenColumns, "no") ? (
                        <th className="px-3 py-2">单号</th>
                      ) : null}
                      {columnVisible(hiddenColumns, "status") ? (
                        <th className="px-3 py-2">状态</th>
                      ) : null}
                      {columnVisible(hiddenColumns, "customer") ? (
                        <th className="px-3 py-2">老板</th>
                      ) : null}
                      {columnVisible(hiddenColumns, "player") ? (
                        <th className="px-3 py-2">陪玩</th>
                      ) : null}
                      {columnVisible(hiddenColumns, "duration") ? (
                        <th className="px-3 py-2">时长</th>
                      ) : null}
                      {columnVisible(hiddenColumns, "amount") ? (
                        <th className="px-3 py-2">预估金额</th>
                      ) : null}
                      {columnVisible(hiddenColumns, "createdAt") ? (
                        <th className="px-3 py-2">创建时间</th>
                      ) : null}
                      <th className="px-3 py-2 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((group) => (
                      <GroupRows
                        key={group.playerName ?? "__unassigned"}
                        group={group}
                        hiddenColumns={hiddenColumns}
                        selected={selected}
                        busyKeys={busyKeys}
                        rushKeys={rushKeys}
                        canOperate={canOperate}
                        onToggle={(key) =>
                          setSelected((current) => toggleRow(current, key))
                        }
                        onPublish={(row) => void runRowAction(row, "publish")}
                        onRelease={(row) => void runRowAction(row, "release")}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  显示 {paged.items.length} / {paged.total} 单（服务端命中{" "}
                  {serverTotal} 单）
                </span>
                <span className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={paged.page <= 1}
                    onClick={() => setPage(paged.page - 1)}
                  >
                    上一页
                  </Button>
                  <span>
                    第 {paged.page} / {paged.totalPages} 页
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={paged.page >= paged.totalPages}
                    onClick={() => setPage(paged.page + 1)}
                  >
                    下一页
                  </Button>
                </span>
              </div>
            </>
          ) : null}

          {forbidden ? (
            <p className="text-xs text-muted-foreground">
              提示：当前账号角色不在商家端允许范围内，写操作不可用。
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function countPublishable(byStatus: Record<string, number>): number {
  let count = 0;
  for (const status of PUBLISHABLE) count += byStatus[status] ?? 0;
  return count;
}

function countReleasable(byStatus: Record<string, number>): number {
  let count = 0;
  for (const status of RELEASABLE) count += byStatus[status] ?? 0;
  return count;
}

function columnVisible(hidden: ReadonlySet<ColumnId>, id: ColumnId): boolean {
  return !hidden.has(id);
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <p className="font-medium">{title}</p>
        <div className="space-y-2 text-sm text-muted-foreground">
          {children}
        </div>
      </CardContent>
    </Card>
  );
}

function GroupRows({
  group,
  hiddenColumns,
  selected,
  busyKeys,
  rushKeys,
  canOperate,
  onToggle,
  onPublish,
  onRelease,
}: {
  group: PlayerGroup;
  hiddenColumns: ReadonlySet<ColumnId>;
  selected: ReadonlySet<string>;
  busyKeys: ReadonlySet<string>;
  rushKeys: ReadonlySet<string>;
  canOperate: boolean;
  onToggle: (key: string) => void;
  onPublish: (row: DispatchListRowView) => void;
  onRelease: (row: DispatchListRowView) => void;
}) {
  return (
    <>
      <tr className="bg-muted/60">
        <td
          colSpan={COLUMN_SPAN(hiddenColumns)}
          className="px-3 py-1.5 text-xs font-medium"
        >
          {group.playerName ?? "未选人（待指派陪玩）"}
          {group.rows.length > 1 ? ` · ${group.rows.length} 单` : ""}
          {group.rushKeys.length > 0
            ? ` · ⚠ 有 ${group.rushKeys.length} 单时间间隔小于 ${RUSH_GAP_MINUTES} 分钟`
            : ""}
        </td>
      </tr>
      {group.rows.map((row) => {
        const view = row as DispatchListRowView;
        const busy = busyKeys.has(row.key);
        const rush = rushKeys.has(row.key);
        return (
          <tr key={row.key} className="border-b">
            <td className="px-3 py-2">
              <input
                type="checkbox"
                aria-label={`勾选 ${row.no}`}
                checked={selected.has(row.key)}
                onChange={() => onToggle(row.key)}
              />
            </td>
            {columnVisible(hiddenColumns, "no") ? (
              <td className="px-3 py-2">
                <Link
                  href={`/merchant-console/dispatch/${row.id}?kind=GD`}
                  className="text-primary hover:underline"
                >
                  {row.no}
                </Link>
                {rush ? (
                  <span className="ml-2 text-xs text-destructive">⚠ 赶场</span>
                ) : null}
              </td>
            ) : null}
            {columnVisible(hiddenColumns, "status") ? (
              <td className="px-3 py-2">
                <Badge variant={statusVariant(row.status)}>
                  {statusLabel(row.status)}
                </Badge>
              </td>
            ) : null}
            {columnVisible(hiddenColumns, "customer") ? (
              <td className="px-3 py-2">{row.customerName}</td>
            ) : null}
            {columnVisible(hiddenColumns, "player") ? (
              <td className="px-3 py-2">{row.playerName ?? "—"}</td>
            ) : null}
            {columnVisible(hiddenColumns, "duration") ? (
              <td className="px-3 py-2">{row.durationText}</td>
            ) : null}
            {columnVisible(hiddenColumns, "amount") ? (
              <td className="px-3 py-2">
                {formatAmount(view.amountFen)}
                <span
                  className="ml-1 text-xs text-muted-foreground"
                  title="证据差异徽章将在审核台（Slice 2）接真实对照数据"
                >
                  证据 —
                </span>
              </td>
            ) : null}
            {columnVisible(hiddenColumns, "createdAt") ? (
              <td className="px-3 py-2">{formatDateTime(row.createdAt)}</td>
            ) : null}
            <td className="px-3 py-2">
              <span className="flex items-center justify-end gap-1">
                <Link
                  href={`/merchant-console/dispatch/${row.id}?kind=GD`}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
                >
                  详情
                  <ArrowRight size={12} aria-hidden="true" />
                </Link>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    busy || !canOperate || !PUBLISHABLE.has(view.status)
                  }
                  title={
                    PUBLISHABLE.has(view.status)
                      ? "发布后开放报名"
                      : "只有草稿/已确认的派单可以发布"
                  }
                  onClick={() => onPublish(view)}
                >
                  发布
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || !canOperate || !RELEASABLE.has(view.status)}
                  title={
                    RELEASABLE.has(view.status)
                      ? "释放后回到报名阶段"
                      : "当前状态没有可释放的名额"
                  }
                  onClick={() => onRelease(view)}
                >
                  释放
                </Button>
              </span>
            </td>
          </tr>
        );
      })}
    </>
  );
}

function COLUMN_SPAN(hidden: ReadonlySet<ColumnId>): number {
  const visible = COLUMNS.filter((column) => !hidden.has(column.id)).length;
  // +1 勾选列，+1 操作列
  return visible + 2;
}

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
import { fenToYuanText } from "../money";
import { CONSOLE_BASE } from "./console-path";
import { NewOrderButton } from "./new-order-dialog";
import {
  buildSelectedCsvForColumns,
  filterRows,
  groupByPlayer,
  normalizeListResponse,
  paginate,
  rangeStartIso,
  reviewBadge,
  selectedSummary,
  slotReportStatusMap,
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
  /** 游戏名（列表「游戏 / 位置」列）。 */
  gameName: string | null;
  /** 该单首个岗位名（与游戏名同列）。 */
  positionLabel: string | null;
  slotId: string | null;
  /** 核定分钟（报单审批通过后的生效值）；未报单 / 未核定为 null（「申报 / 核定」列）。 */
  reviewedDurationMinutes: number | null;
  /** 报单提交时间（「等待 / 倒计时」列据此算等待时长）；未报单为 null。 */
  reportSubmittedAt: string | null;
  /** 场次状态（`ENDED` / `IN_PROGRESS` 等），决定这一列显示倒计时还是等待。 */
  sessionStatus: string | null;
  /** 报单证据计时（秒，仅作对照）。 */
  sessionDurationSeconds: number | null;
  /** 已核定金额（分，单档）；未核定为 null。 */
  settlementAmountFen: string | null;
  unitPriceFen: string | null;
  estimatedAmountFen: string | null;
  createdAt: string;
}

/**
 * 审核台队列 → `slotId → reportStatus` 映射（每次只查一个队列，两次并发）。
 *
 * 列表行现在带 `slotId`（本片给列表补的字段），所以每个订单能精确对上自己的报单状态，
 * 不再是「有 N 条待审批」的总数提示。
 */
interface ReportQueueRow {
  slotId: string | null;
  reportStatus: string;
  /** 场次 id（`GET /tenant/sessions` 用的是 `id`，不是 `sessionId`）。 */
  id: string;
  orderId: string;
}

async function fetchReportQueue(
  reportStatus: "PENDING_REVIEW" | "APPROVED",
): Promise<ReportQueueRow[]> {
  const payload = await apiFetch<unknown>(
    `/api/v1/tenant/sessions?reportStatus=${reportStatus}`,
  );
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown } | null)?.data)
      ? ((payload as { data: unknown[] }).data ?? [])
      : [];
  return rows as ReportQueueRow[];
}

/** 审核台入口：命中队列行时带 `sessionId` 深链，否则退回列表入口。 */
const AUDIT_ENTRY = `${CONSOLE_BASE}/dispatch/audit`;

/**
 * 审核列深链：本次请求到的队列行里找到同一档位时带 `sessionId`（审核台会自动选中），
 * 找不到就退回列表入口——跳转必须始终有效，不因为队列里恰好没有就用坏链接。
 */
function auditHref(
  slotId: string | null | undefined,
  sessionIdBySlot: ReadonlyMap<string, string>,
): string {
  const sessionId = slotId ? sessionIdBySlot.get(slotId) : undefined;
  return sessionId
    ? `${AUDIT_ENTRY}?sessionId=${encodeURIComponent(sessionId)}`
    : AUDIT_ENTRY;
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
  gameName: string | null;
  positionLabel: string | null;
  durationMinutes: number;
  amountFen: string | null;
  startAt: string | null;
  /** 已选中档位 id；审核列据此精确映射报单状态。 */
  slotId: string | null;
  /** 「申报 / 核定」列：核定分钟与证据计时（秒）都来自场次。 */
  reviewedDurationMinutes: number | null;
  sessionDurationSeconds: number | null;
  /** 「等待 / 倒计时」列：报单提交时间 + 场次状态。 */
  reportSubmittedAt: string | null;
  sessionStatus: string | null;
  /** 已核定金额（分，单档）；未核定为 null。 */
  settlementAmountFen: string | null;
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

/** 只取时间部分（原型「创建时间」列显示 19:52 这种短格式）。 */
function timeOnly(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 等待时长（原型第 9 列）：先按「创建至今」显示。
 * 后端补上 `desiredStartAt` 与场次状态后，这里会改成「报名倒计时 / 服务剩余」。
 */
function formatWait(iso: string, now: number = Date.now()): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "—";
  const minutes = Math.max(0, Math.floor((now - parsed) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h${rest}m`;
}

/**
 * 「等待 / 倒计时」列的文案：
 * - 已报单待审批 → 报单提交至今（最关心的排队量）；
 * - 已结束服务 → 「已结束」；服务中 → 「进行中」；
 * - 其余（未选人 / 报名中等）→ 创建至今。
 * 不做假倒计时：真正的报名倒计时需要服务端给截止时间，本片先如实显示已发生的等待。
 */
function waitColumnText(row: DispatchListRowView, createdAt: string): string {
  if (row.reportSubmittedAt) return `待审 ${formatWait(row.reportSubmittedAt)}`;
  if (row.sessionStatus === "ENDED") return "已结束";
  if (row.sessionStatus === "IN_PROGRESS") return "进行中";
  return formatWait(createdAt);
}

/**
 * 「申报 / 核定」列的差异提示（与审核台 `durationGap` 同阈值：10 分钟或申报的 15%）。
 * 缺证据计时或未报单时不提示——不臆造对照。
 */
function gapChip(row: DispatchListRowView): string | null {
  if (row.reviewedDurationMinutes === null) return null;
  const evidenceSeconds = row.sessionDurationSeconds;
  if (evidenceSeconds === null) return null;
  const declared = row.reviewedDurationMinutes;
  const evidenceMinutes = evidenceSeconds / 60;
  const delta = declared - evidenceMinutes;
  const threshold = Math.max(10, declared * 0.15);
  if (Math.abs(delta) <= threshold) return null;
  const evidenceText =
    evidenceMinutes < 1
      ? `${Math.round(evidenceMinutes * 60)} 秒`
      : `${evidenceMinutes.toFixed(1)} 分`;
  return `证据 ${evidenceText} · 差 ${delta > 0 ? "+" : ""}${delta.toFixed(0)}`;
}

function formatAmount(amountFen: string | null): string {
  if (amountFen === null) return "—";
  // 金额一律整数分；这里只做展示换算，不参与计算（平台费 = 0）。
  // 用 money.ts 的 BigInt 实现，避免浮点（AGENTS：金额禁止 JavaScript 浮点）。
  if (!/^\d+$/.test(amountFen)) return amountFen;
  return `${fenToYuanText(amountFen)} 元`;
}

/** 汇总金额（分字符串）→ 「¥12.34」。缺失或非法显示 ¥—，不编 0。 */
function formatFenToYuan(amountFen: string | null | undefined): string {
  if (amountFen === null || amountFen === undefined) return "¥—";
  if (!/^\d+$/.test(amountFen)) return "¥—";
  return `¥${fenToYuanText(amountFen)}`;
}

/** 分 → CSV 单元格：缺失或非法留空，绝不写 0（避免把「没数据」导成「0 元」）。 */
function fenCellForCsv(amountFen: string | null): string {
  if (amountFen === null || !/^\d+$/.test(amountFen)) return "";
  return fenToYuanText(amountFen);
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
  // 审核列数据源：待审批 + 已通过两个队列 → 每行精确对应自己的报单状态。
  const pendingReviewQuery = useQuery({
    queryKey: ["merchant", "review", "queue", "PENDING_REVIEW"],
    queryFn: () => fetchReportQueue("PENDING_REVIEW"),
  });
  /**
   * 页头 KPI 的真实数字（独立汇总端点）：待审批报单 / 违约 / 已核定金额。
   * 与列表共用同一租户聚合，不随筛选与分页变化。
   */
  const summaryQuery = useQuery({
    queryKey: ["merchant", "dispatch", "summary"],
    queryFn: () =>
      apiFetch<{
        pendingReportCount?: number;
        breachCount?: number;
        pendingSettlementAmountFen?: string;
      }>("/api/v1/tenant/game-dispatch/summary"),
  });
  const approvedReviewQuery = useQuery({
    queryKey: ["merchant", "review", "queue", "APPROVED"],
    queryFn: () => fetchReportQueue("APPROVED"),
  });
  const reviewBySlot = useMemo(
    () =>
      slotReportStatusMap([
        ...(pendingReviewQuery.data ?? []),
        ...(approvedReviewQuery.data ?? []),
      ]),
    [pendingReviewQuery.data, approvedReviewQuery.data],
  );
  // 审核列深链：`slotId → sessionId`（审核台按 sessionId 选中，不按 slotId）。
  const sessionIdBySlot = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of [
      ...(pendingReviewQuery.data ?? []),
      ...(approvedReviewQuery.data ?? []),
    ]) {
      if (row.slotId && row.id) map.set(row.slotId, row.id);
    }
    return map;
  }, [pendingReviewQuery.data, approvedReviewQuery.data]);
  const pendingReviewCount = pendingReviewQuery.data?.length ?? 0;

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
        gameName: row.gameName,
        positionLabel: row.positionLabel,
        durationMinutes: row.durationMinutes,
        amountFen: row.estimatedAmountFen,
        startAt: null,
        slotId: row.slotId,
        reviewedDurationMinutes: row.reviewedDurationMinutes,
        sessionDurationSeconds: row.sessionDurationSeconds,
        reportSubmittedAt: row.reportSubmittedAt,
        sessionStatus: row.sessionStatus,
        settlementAmountFen: row.settlementAmountFen,
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
  /** 「进行中」KPI：与页签计数同口径（已选定 / 待开始 / 服务中 三态之和）。 */
  const ongoingCount = useMemo(
    () =>
      (["ASSIGNED", "READY", "IN_PROGRESS"] as const).reduce(
        (sum, status) => sum + (counts[status] ?? 0),
        0,
      ),
    [counts],
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
        fenCellForCsv(row.amountFen),
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

      {/*
        KPI 卡片（原型顶部 4 卡）：现在先上能真实计算的两张，其余两张明确显示「待接口」，
        不编数字——风险/待结算的口径要后端给数据来源后再补。
      */}
      <section
        aria-label="关键指标"
        className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4"
      >
        <KpiCard
          label="进行中"
          value={`${ongoingCount}`}
          hint="服务中 / 待开始"
        />
        <KpiCard
          label="待审批报单"
          value={`${summaryQuery.data?.pendingReportCount ?? pendingReviewCount}`}
          hint={pendingReviewCount > 0 ? "最久一条见审核台" : "暂无待审批"}
          href="/merchant-console/dispatch/audit"
          tone="warn"
        />
        <KpiCard
          label="风险"
          value={`${summaryQuery.data?.breachCount ?? 0}`}
          hint="违约记录（人工认定）"
        />
        <KpiCard
          label="已核定金额"
          value={formatFenToYuan(summaryQuery.data?.pendingSettlementAmountFen)}
          hint="已核定档位合计"
        />
      </section>

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
            <Button
              variant="outline"
              size="sm"
              disabled={listQuery.isFetching}
              onClick={() => void listQuery.refetch()}
            >
              {listQuery.isFetching ? "刷新中…" : "刷新"}
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
                <table className="pw-data-table text-left">
                  <caption className="sr-only">
                    订单列表（按状态页签筛选，可勾选批量操作）
                  </caption>
                  <thead>
                    <tr>
                      <th className="w-8">
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
                      {columnVisible(hiddenColumns, "status") ? (
                        <th className="text-[11px] tracking-wider uppercase">
                          状态
                        </th>
                      ) : null}
                      {columnVisible(hiddenColumns, "no") ? (
                        <th className="text-[11px] tracking-wider uppercase">
                          订单
                        </th>
                      ) : null}
                      {/* 「游戏 / 位置」列（原型第 4 列）：游戏名 + 首个岗位。 */}
                      <th className="text-[11px] tracking-wider uppercase">
                        游戏 / 位置
                      </th>
                      {columnVisible(hiddenColumns, "player") ? (
                        <th className="text-[11px] tracking-wider uppercase">
                          陪玩
                        </th>
                      ) : null}
                      {columnVisible(hiddenColumns, "customer") ? (
                        <th className="text-[11px] tracking-wider uppercase">
                          老板
                        </th>
                      ) : null}
                      {/* 「申报 / 核定」列（原型第 7 列）：数据待后端补字段，先留位。 */}
                      <th className="text-[11px] tracking-wider uppercase">
                        申报 / 核定
                      </th>
                      {columnVisible(hiddenColumns, "amount") ? (
                        <th className="text-[11px] tracking-wider uppercase">
                          金额
                        </th>
                      ) : null}
                      {/* 「等待 / 倒计时」列（原型第 9 列）：先按已等待时长显示。 */}
                      <th className="text-[11px] tracking-wider uppercase">
                        等待 / 倒计时
                      </th>
                      {columnVisible(hiddenColumns, "createdAt") ? (
                        <th className="text-[11px] tracking-wider uppercase">
                          创建时间
                        </th>
                      ) : null}
                      <th className="text-right" />
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
                        reviewBySlot={reviewBySlot}
                        sessionIdBySlot={sessionIdBySlot}
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

/**
 * KPI 卡片（原型顶部四卡）：与项目既有卡片样式一致（Card + token），不引入新视觉语言。
 * 「待接口」的两张卡明确显示占位符而不是编造数字。
 */
function KpiCard({
  label,
  value,
  hint,
  href,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  href?: string;
  tone?: "warn";
}) {
  const body = (
    <>
      <p
        className={`text-xs ${
          tone === "warn"
            ? "text-[color:var(--mc-amber-text)]"
            : "text-muted-foreground"
        }`}
      >
        {label}
      </p>
      <p className="mt-0.5 font-mono text-xl font-semibold tabular-nums">
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </>
  );
  return (
    <Card>
      <CardContent className="p-3">
        {href ? (
          <Link href={href} className="block hover:opacity-90">
            {body}
          </Link>
        ) : (
          body
        )}
      </CardContent>
    </Card>
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
  reviewBySlot,
  sessionIdBySlot,
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
  reviewBySlot: ReadonlyMap<string, string>;
  sessionIdBySlot: ReadonlyMap<string, string>;
  onToggle: (key: string) => void;
  onPublish: (row: DispatchListRowView) => void;
  onRelease: (row: DispatchListRowView) => void;
}) {
  return (
    <>
      <tr className="pw-group-row">
        <td colSpan={COLUMN_SPAN(hiddenColumns)}>
          <span className="flex flex-wrap items-center gap-1.5">
            {group.playerName
              ? `按陪玩分组 · ${group.playerName}`
              : "未选人 / 待指派"}
            {group.rows.length > 1 ? `（共 ${group.rows.length} 单）` : ""}
            {group.rushKeys.length > 0 ? (
              <span className="rounded border border-[color:var(--mc-amber)] bg-[color:var(--mc-amber-2)] px-1.5 text-[11px] font-normal text-[color:var(--mc-amber-text)]">
                时段相邻，注意赶场
              </span>
            ) : null}
          </span>
        </td>
      </tr>
      {group.rows.map((row) => {
        const view = row as DispatchListRowView;
        const busy = busyKeys.has(row.key);
        const rush = rushKeys.has(row.key);
        return (
          <tr key={row.key}>
            <td className="text-xs">
              <input
                type="checkbox"
                aria-label={`勾选 ${row.no}`}
                checked={selected.has(row.key)}
                onChange={() => onToggle(row.key)}
              />
            </td>
            {columnVisible(hiddenColumns, "status") ? (
              <td className="text-xs">
                <Badge variant={statusVariant(row.status)}>
                  {statusLabel(row.status)}
                </Badge>
              </td>
            ) : null}
            {columnVisible(hiddenColumns, "no") ? (
              <td className="pw-num">
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
            {/* 游戏 / 位置：游戏名 + 首个岗位（原型第 4 列）。 */}
            <td className="text-xs">
              {view.gameName ?? "—"}
              {view.positionLabel ? (
                <span className="text-muted-foreground">
                  {" · "}
                  {view.positionLabel}
                </span>
              ) : null}
            </td>
            {columnVisible(hiddenColumns, "player") ? (
              <td className="text-xs">
                {row.playerName ?? (
                  <span className="text-muted-foreground">未选人</span>
                )}
              </td>
            ) : null}
            {columnVisible(hiddenColumns, "customer") ? (
              <td className="text-xs">{row.customerName}</td>
            ) : null}
            {/*
              「申报 / 核定」（原型第 7 列）：申报取订单时长，核定取场次里的生效分钟
              （审批通过时按修正值覆盖）。未报单/未核定时显示「待核定」，不编数字；
              有证据计时且差异超阈值时，附一个小胶囊提示对照（与审核台同一口径）。
            */}
            <td className="pw-num">
              {row.durationText}
              <span className="text-muted-foreground">
                {" / "}
                {view.reviewedDurationMinutes === null
                  ? "待核定"
                  : `${view.reviewedDurationMinutes} 分钟`}
              </span>
              {gapChip(view) ? (
                <span className="ml-1 rounded border border-[#eec9c9] bg-[color:var(--mc-red-2)] px-1 text-[11px] text-[color:var(--mc-red)]">
                  {gapChip(view)}
                </span>
              ) : null}
            </td>
            {columnVisible(hiddenColumns, "amount") ? (
              <td className="pw-num text-right">
                {formatAmount(view.amountFen)}
              </td>
            ) : null}
            {/*
              「等待 / 倒计时」（原型第 9 列）：待审批按「报单提交至今」，服务中/已结束
              按场次状态给「进行中/已结束」，无场次则回落到「创建至今」。
            */}
            <td className="pw-num">{waitColumnText(view, row.createdAt)}</td>
            {columnVisible(hiddenColumns, "createdAt") ? (
              <td className="pw-num text-muted-foreground">
                {timeOnly(row.createdAt)}
              </td>
            ) : null}
            <td>
              <span className="flex flex-wrap items-center justify-end gap-1">
                {/* 审核列原来在这里，按原型并入「状态 + 操作」：待审批时给「核定」入口。 */}
                {reviewBadge(view.slotId, reviewBySlot).actionable ? (
                  <Link
                    href={auditHref(view.slotId, sessionIdBySlot)}
                    className="inline-flex items-center rounded-md border px-2 py-1 text-xs hover:bg-muted"
                  >
                    {reviewBadge(view.slotId, reviewBySlot).tone === "pending"
                      ? "核定"
                      : "审核记录"}
                  </Link>
                ) : null}
                {/*
                  行内动作按状态出现（对齐原型的模块设计）：
                  待发布/已确认 → 发布；已选定/待开始/服务中 → 释放；其余只给详情。
                  不可用的动作不再用灰按钮占位，避免「看起来能点」。
                */}
                <Link
                  href={`/merchant-console/dispatch/${row.id}?kind=GD`}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
                >
                  详情
                  <ArrowRight size={12} aria-hidden="true" />
                </Link>
                {PUBLISHABLE.has(view.status) ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || !canOperate}
                    title="发布后开放报名"
                    onClick={() => onPublish(view)}
                  >
                    发布
                  </Button>
                ) : null}
                {RELEASABLE.has(view.status) ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || !canOperate}
                    title="释放后回到报名阶段"
                    onClick={() => onRelease(view)}
                  >
                    释放
                  </Button>
                ) : null}
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
  // +1 勾选列、+1「游戏 / 位置」列、+1「申报 / 核定」列、+1「等待 / 倒计时」列、+1 操作列
  return visible + 5;
}

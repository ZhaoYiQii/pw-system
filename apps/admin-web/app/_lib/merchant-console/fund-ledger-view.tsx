"use client";

/**
 * DS-009：商家端「统一资金台账」只读证据台（A 列表骨架 + C 四段证据链）。
 *
 * 口径与边界：
 * - 只读：本页不写审计、不改业务单据、不改资金账户、不写总账，也不做来源跳转；
 * - 列表完全由服务端筛选 / 排序 / 分页，`total / page / pageSize` 一律取服务端回包，
 *   绝不用当前页行数冒充总数；
 * - 导出复用当前已提交筛选与排序（不含 `page` / `pageSize`）；422 只在导出动作内提示，
 *   列表保持可用，且不会创建或下载残缺文件；
 * - `balanced=false` 是独立行级事实：红色只表达借贷不平，不改写交易 `status`；
 * - 金额只走十进制字符串分与 BigInt（`formatLedgerFen` / `ledgerDifferenceFen`）；
 * - 未知展示枚举回退原始值，null / 空值显示 `—`，不隐藏字段冒充完整信息。
 */
import { useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Focus,
  Info,
  RotateCw,
  ShieldAlert,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, apiDownloadCsv, apiFetch } from "../api";
import { getFirstAllowedModule, type MerchantModule } from "./modules";
import { useMerchantRole } from "./role-context";
import {
  balancedLabel,
  commitFundLedgerFilters,
  DEFAULT_FUND_LEDGER_FILTERS,
  eventTypeLabel,
  formatLedgerFen,
  FUND_LEDGER_EMPTY_TEXT,
  FUND_LEDGER_EVENT_TYPES,
  FUND_LEDGER_PAGE_SIZE,
  FUND_LEDGER_SORT_DIRECTIONS,
  FUND_LEDGER_SORT_FIELDS,
  FUND_LEDGER_TRANSACTION_STATUSES,
  fundFlowLabel,
  ledgerDifferenceFen,
  pickActiveLedgerRow,
  reconciliationStatusLabel,
  toFundLedgerExportQuery,
  toFundLedgerListQuery,
  transactionStatusLabel,
  visibleLedgerRows,
  type FundLedgerCommittedFilters,
  type FundLedgerDraftFilters,
  type FundLedgerExportQuery,
  type FundLedgerFilterErrors,
  type FundLedgerListQuery,
  type FundLedgerRow,
} from "./fund-ledger-state";
import type { TenantFundLedgerListResponse } from "@pw/api-client";

/** 导出上限文案：与后端 `FundLedgerExportLimitError` 同一口径，前端固定展示。 */
const EXPORT_LIMIT_MESSAGE = "结果超过 5000 行，请缩小日期或其他筛选范围";
/** 骨架行数固定五行，行高保持最终行高，避免加载完成时表格跳动。 */
const SKELETON_ROWS = 5;
/** 数据行高（A 基准 68 px）。 */
const ROW_HEIGHT = 68;
/** 等宽数字：交易号、金额、ID、时间统一使用。 */
const MONO = "[font-family:var(--mc-mono)] tabular-nums";
/** 排序字段中文名（仅展示；取值仍是契约枚举）。 */
const SORT_FIELD_LABELS: Record<string, string> = {
  occurredAt: "发生时间",
  confirmedAt: "确认时间",
  createdAt: "创建时间",
  amountFen: "金额",
  txNo: "交易号",
};

type ListData = TenantFundLedgerListResponse["data"];
type LedgerStatus =
  | "loading"
  | "forbidden"
  | "bad-request"
  | "expired"
  | "error"
  | "empty"
  | "ready";
type BadgeTone = "ok" | "bad" | "warn" | "info" | "neutral";

/** 空值与空串统一显示 `—`；不做“字段不存在”的隐藏。 */
function textOr(value: string | null | undefined): string {
  return value === null || value === undefined || value === ""
    ? FUND_LEDGER_EMPTY_TEXT
    : value;
}

/** ISO 时间 → 本地展示；无法解析时原样返回，不伪造时间。 */
function formatMoment(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return FUND_LEDGER_EMPTY_TEXT;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

/** query 对象 → URL 查询串；空值不出现在结果里。 */
function toSearchString(
  query: FundLedgerListQuery | FundLedgerExportQuery,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  return params.toString();
}

/** 默认已提交筛选：全部为空 + 发生时间倒序，必然通过校验。 */
function defaultCommittedFilters(): FundLedgerCommittedFilters {
  const result = commitFundLedgerFilters(DEFAULT_FUND_LEDGER_FILTERS);
  if (!result.ok) {
    throw new Error("默认筛选必须通过校验");
  }
  return result.filters;
}

function statusTone(status: string): BadgeTone {
  switch (status) {
    case "CONFIRMED":
      return "ok";
    case "RECONCILED":
      return "info";
    case "REVERSED":
      return "bad";
    default:
      return "neutral";
  }
}

function reconciliationTone(status: string): BadgeTone {
  switch (status) {
    case "RECONCILED":
      return "ok";
    case "UNRECONCILED":
      return "warn";
    default:
      return "neutral";
  }
}

function flowTone(direction: string): BadgeTone {
  switch (direction) {
    case "DEBIT":
      return "info";
    case "CREDIT":
      return "warn";
    default:
      return "neutral";
  }
}

/** 触发浏览器下载；调用方保证只在拿到 Blob 之后调用。 */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** 导出失败文案：422 用固定口径，其余透出服务端消息，避免二次包装。 */
function exportErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.status === 422 ? EXPORT_LIMIT_MESSAGE : error.message;
  }
  return "导出失败，请检查网络后重试。";
}

export function FundLedgerView() {
  const { role } = useMerchantRole();
  const [draft, setDraft] = useState<FundLedgerDraftFilters>(
    DEFAULT_FUND_LEDGER_FILTERS,
  );
  const [errors, setErrors] = useState<FundLedgerFilterErrors>({});
  const [filters, setFilters] = useState<FundLedgerCommittedFilters>(
    defaultCommittedFilters,
  );
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [onlyAbnormal, setOnlyAbnormal] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [traceClosed, setTraceClosed] = useState(false);
  const [traceFocused, setTraceFocused] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  const query = useMemo(
    () => toFundLedgerListQuery(filters, page, FUND_LEDGER_PAGE_SIZE),
    [filters, page],
  );

  const list = useQuery({
    queryKey: ["merchant", "fund-ledger", "list", query],
    queryFn: () =>
      apiFetch<ListData>(
        `/api/v1/tenant/funds/ledger?${toSearchString(query)}`,
      ),
    retry: false,
  });

  const data = list.data ?? null;
  const rows = data?.rows ?? [];
  const status: LedgerStatus = list.isError
    ? list.error instanceof ApiError && list.error.status === 403
      ? "forbidden"
      : list.error instanceof ApiError && list.error.status === 400
        ? "bad-request"
        : list.error instanceof ApiError && list.error.status === 401
          ? "expired"
          : "error"
    : list.isPending
      ? "loading"
      : rows.length === 0
        ? "empty"
        : "ready";

  const busy = status === "loading";
  const abnormalCount = rows.filter((row) => !row.balanced).length;
  // 选择规则见 `visibleLedgerRows` / `pickActiveLedgerRow`：活动行只能来自可见行，
  // 可见行为空时保持 null，证据链不得显示被异常筛选隐藏的平衡交易。
  const visibleRows = visibleLedgerRows(rows, onlyAbnormal);
  const activeRow = pickActiveLedgerRow(visibleRows, selectedId);
  const traceAvailable = status === "ready" && activeRow !== null;
  const traceOpen = traceAvailable && !traceClosed;
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / FUND_LEDGER_PAGE_SIZE));
  const hiddenByFilter =
    onlyAbnormal && rows.length > 0 && visibleRows.length === 0;
  const fallbackModule = getFirstAllowedModule(role);

  function updateDraft(patch: Partial<FundLedgerDraftFilters>): void {
    setDraft((current) => ({ ...current, ...patch }));
    setErrors({});
    setExportNotice(null);
  }

  function runQuery(): void {
    const result = commitFundLedgerFilters(draft);
    if (!result.ok) {
      // 客户端先拒：保留用户输入，逐字段提示，不发必然 400 的请求。
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setFilters(result.filters);
    setPage(1);
    setExportNotice(null);
  }

  function resetQuery(): void {
    setDraft(DEFAULT_FUND_LEDGER_FILTERS);
    setErrors({});
    setFilters(defaultCommittedFilters());
    setPage(1);
    setOnlyAbnormal(false);
    setExportNotice(null);
  }

  async function exportCsv(): Promise<void> {
    if (exporting) return;
    setExporting(true);
    setExportNotice(null);
    setNoteOpen(false);
    try {
      const exportQuery = toFundLedgerExportQuery(filters);
      const file = await apiDownloadCsv(
        `/api/v1/tenant/funds/ledger/export.csv?${toSearchString(exportQuery)}`,
      );
      saveBlob(file.blob, file.filename);
      setExportNotice(`已导出 ${file.filename}`);
    } catch (error) {
      // 导出失败不影响列表；任何失败都不会创建 Blob URL 或触发下载。
      setExportNotice(exportErrorMessage(error));
    } finally {
      setExporting(false);
    }
  }

  function selectRow(transactionId: string): void {
    setSelectedId(transactionId);
    setTraceClosed(false);
  }

  const gridStyle =
    traceOpen && traceFocused
      ? { gridTemplateColumns: "minmax(480px,.72fr) minmax(500px,1.28fr)" }
      : undefined;

  return (
    <div className="grid gap-[14px]" data-testid="fund-ledger">
      <header className="flex flex-wrap items-start justify-between gap-[14px]">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--mc-muted)]">
            RECORDS / FUND LEDGER
          </p>
          <h1 className="mt-[2px] text-[25px] font-bold leading-tight tracking-tight text-[var(--mc-ink)]">
            统一资金台账
          </h1>
          <p className="mt-[6px] text-[13px] text-[var(--mc-muted)]">
            已确认业务资金事件的只读证据台，选择一笔交易即可同屏追溯来源与账务结果。
          </p>
        </div>
        <div className="relative flex items-center gap-[8px]">
          <Button
            className="h-10 px-5"
            onClick={() => void exportCsv()}
            disabled={exporting || busy}
            data-testid="fund-ledger-export"
          >
            <Download size={16} />
            {exporting ? "导出中…" : "导出 CSV"}
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10"
            aria-expanded={noteOpen}
            aria-label="导出范围说明"
            title="导出范围说明"
            onClick={() => setNoteOpen((open) => !open)}
          >
            <Info size={16} />
          </Button>
          {noteOpen ? (
            <div
              role="note"
              className="absolute right-0 top-[46px] z-20 w-[252px] rounded-[10px] border border-[var(--mc-line)] bg-[var(--mc-paper)] p-[10px] text-[12px] leading-[1.6] text-[var(--mc-muted)] shadow-lg"
            >
              <b className="text-[var(--mc-ink)]">导出范围说明</b>
              <br />
              最多导出 5000 行；超过后请缩小日期或其他筛选范围。
            </div>
          ) : null}
        </div>
      </header>

      <section className="rounded-[12px] border border-[var(--mc-line)] bg-[var(--mc-paper)] p-[14px]">
        <fieldset
          disabled={busy}
          aria-busy={busy}
          className="m-0 grid min-w-0 grid-cols-[repeat(auto-fit,minmax(186px,1fr))] gap-x-[10px] gap-y-[10px] border-0 p-0"
        >
          <div className="col-span-2 flex min-w-0 flex-col gap-[4px]">
            <span className="text-[12px] text-[var(--mc-muted)]">日期范围</span>
            <div className="flex min-w-0 items-center gap-[6px]">
              <Input
                ref={firstFieldRef}
                type="date"
                aria-label="开始日期"
                className="h-[38px] min-w-0 flex-1 text-[13px]"
                value={draft.occurredFrom}
                onChange={(event) =>
                  updateDraft({ occurredFrom: event.target.value })
                }
              />
              <span aria-hidden="true" className="text-[var(--mc-muted)]">
                —
              </span>
              <Input
                type="date"
                aria-label="结束日期"
                className="h-[38px] min-w-0 flex-1 text-[13px]"
                value={draft.occurredTo}
                onChange={(event) =>
                  updateDraft({ occurredTo: event.target.value })
                }
              />
            </div>
            {errors.occurredFrom ? (
              <span className="text-[11px] text-[var(--mc-red)]">
                {errors.occurredFrom}
              </span>
            ) : null}
            {errors.occurredTo ? (
              <span className="text-[11px] text-[var(--mc-red)]">
                {errors.occurredTo}
              </span>
            ) : null}
          </div>

          <label className="flex min-w-0 flex-col gap-[4px]">
            <span className="text-[12px] text-[var(--mc-muted)]">事件类型</span>
            <select
              aria-label="事件类型"
              className="h-[38px] min-w-0 rounded-md border border-input bg-transparent px-[10px] text-[13px]"
              value={draft.eventType}
              onChange={(event) =>
                updateDraft({ eventType: event.target.value })
              }
            >
              <option value="">全部事件</option>
              {FUND_LEDGER_EVENT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {eventTypeLabel(value)}
                </option>
              ))}
            </select>
            {errors.eventType ? (
              <span className="text-[11px] text-[var(--mc-red)]">
                {errors.eventType}
              </span>
            ) : null}
          </label>

          <label className="flex min-w-0 flex-col gap-[4px]">
            <span className="text-[12px] text-[var(--mc-muted)]">交易状态</span>
            <select
              aria-label="交易状态"
              className="h-[38px] min-w-0 rounded-md border border-input bg-transparent px-[10px] text-[13px]"
              value={draft.status}
              onChange={(event) => updateDraft({ status: event.target.value })}
            >
              <option value="">全部状态</option>
              {FUND_LEDGER_TRANSACTION_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {transactionStatusLabel(value)}
                </option>
              ))}
            </select>
            {errors.status ? (
              <span className="text-[11px] text-[var(--mc-red)]">
                {errors.status}
              </span>
            ) : null}
          </label>

          <label className="flex min-w-0 flex-col gap-[4px]">
            <span className="text-[12px] text-[var(--mc-muted)]">关键词</span>
            <Input
              aria-label="关键词"
              placeholder="交易号 / 来源 ID"
              className="h-[38px] text-[13px]"
              value={draft.q}
              onChange={(event) => updateDraft({ q: event.target.value })}
            />
            {errors.q ? (
              <span className="text-[11px] text-[var(--mc-red)]">
                {errors.q}
              </span>
            ) : null}
          </label>

          <div className="col-span-2 flex min-w-0 flex-col gap-[4px]">
            <span className="text-[12px] text-[var(--mc-muted)]">
              金额范围（元）
            </span>
            <div className="flex min-w-0 items-center gap-[6px]">
              <Input
                aria-label="最低金额"
                inputMode="decimal"
                placeholder="最低"
                className="h-[38px] min-w-0 flex-1 text-[13px]"
                value={draft.minAmountYuan}
                onChange={(event) =>
                  updateDraft({ minAmountYuan: event.target.value })
                }
              />
              <span aria-hidden="true" className="text-[var(--mc-muted)]">
                —
              </span>
              <Input
                aria-label="最高金额"
                inputMode="decimal"
                placeholder="最高"
                className="h-[38px] min-w-0 flex-1 text-[13px]"
                value={draft.maxAmountYuan}
                onChange={(event) =>
                  updateDraft({ maxAmountYuan: event.target.value })
                }
              />
            </div>
            {errors.minAmountYuan ? (
              <span className="text-[11px] text-[var(--mc-red)]">
                {errors.minAmountYuan}
              </span>
            ) : null}
            {errors.maxAmountYuan ? (
              <span className="text-[11px] text-[var(--mc-red)]">
                {errors.maxAmountYuan}
              </span>
            ) : null}
          </div>

          <label className="flex min-w-0 flex-col gap-[4px]">
            <span className="text-[12px] text-[var(--mc-muted)]">排序</span>
            <select
              aria-label="排序字段"
              className="h-[38px] min-w-0 rounded-md border border-input bg-transparent px-[10px] text-[13px]"
              value={draft.sortBy}
              onChange={(event) => updateDraft({ sortBy: event.target.value })}
            >
              {FUND_LEDGER_SORT_FIELDS.map((value) => (
                <option key={value} value={value}>
                  {SORT_FIELD_LABELS[value] ?? value}
                </option>
              ))}
            </select>
            {errors.sortBy ? (
              <span className="text-[11px] text-[var(--mc-red)]">
                {errors.sortBy}
              </span>
            ) : null}
          </label>

          <label className="flex min-w-0 flex-col gap-[4px]">
            <span className="text-[12px] text-[var(--mc-muted)]">方向</span>
            <select
              aria-label="排序方向"
              className="h-[38px] min-w-0 rounded-md border border-input bg-transparent px-[10px] text-[13px]"
              value={draft.sortDir}
              onChange={(event) => updateDraft({ sortDir: event.target.value })}
            >
              {FUND_LEDGER_SORT_DIRECTIONS.map((value) => (
                <option key={value} value={value}>
                  {value === "desc" ? "降序" : "升序"}
                </option>
              ))}
            </select>
            {errors.sortDir ? (
              <span className="text-[11px] text-[var(--mc-red)]">
                {errors.sortDir}
              </span>
            ) : null}
          </label>

          {moreOpen ? (
            <>
              <label className="flex min-w-0 flex-col gap-[4px]">
                <span className="text-[12px] text-[var(--mc-muted)]">
                  来源类型
                </span>
                <Input
                  aria-label="来源类型"
                  placeholder="精确匹配"
                  className="h-[38px] text-[13px]"
                  value={draft.sourceType}
                  onChange={(event) =>
                    updateDraft({ sourceType: event.target.value })
                  }
                />
                {errors.sourceType ? (
                  <span className="text-[11px] text-[var(--mc-red)]">
                    {errors.sourceType}
                  </span>
                ) : null}
              </label>

              <label className="flex min-w-0 flex-col gap-[4px]">
                <span className="text-[12px] text-[var(--mc-muted)]">
                  资金账户 ID
                </span>
                <Input
                  aria-label="资金账户 ID"
                  placeholder="可选 UUID"
                  className={`h-[38px] text-[13px] ${MONO}`}
                  value={draft.fundAccountId}
                  onChange={(event) =>
                    updateDraft({ fundAccountId: event.target.value })
                  }
                />
                {errors.fundAccountId ? (
                  <span className="text-[11px] text-[var(--mc-red)]">
                    {errors.fundAccountId}
                  </span>
                ) : null}
              </label>
            </>
          ) : null}

          <div className="col-span-full flex flex-wrap items-center justify-between gap-[10px]">
            <Button
              variant="outline"
              className="h-[38px]"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((open) => !open)}
            >
              <SlidersHorizontal size={15} />
              {moreOpen ? "收起更多筛选" : "更多筛选"}
            </Button>
            <div className="flex items-center gap-[10px]">
              <Button className="h-[38px] px-6" onClick={runQuery}>
                查询
              </Button>
              <Button
                variant="outline"
                className="h-[38px]"
                onClick={resetQuery}
              >
                清空
              </Button>
            </div>
          </div>
        </fieldset>
      </section>

      {exportNotice ? (
        <p
          role="status"
          className={`text-[12px] ${exportNotice.startsWith("已导出") ? "text-[var(--mc-success)]" : "text-[var(--mc-red)]"}`}
        >
          {exportNotice}
        </p>
      ) : null}

      <div
        className={
          traceOpen
            ? "grid items-start gap-[14px] grid-cols-[minmax(0,1fr)_390px] min-[1440px]:grid-cols-[minmax(0,1fr)_438px]"
            : "grid items-start gap-[14px] grid-cols-1"
        }
        style={gridStyle}
      >
        <section className="min-w-0 rounded-[12px] border border-[var(--mc-line)] bg-[var(--mc-paper)]">
          <div className="flex flex-wrap items-center justify-between gap-[10px] border-b border-[var(--mc-line)] px-[14px] py-[10px]">
            <div className="flex items-center gap-[10px]">
              <h2 className="text-[14px] font-semibold text-[var(--mc-ink)]">
                资金事件
              </h2>
              <span className="rounded-full bg-[var(--mc-paper-2)] px-[10px] py-[2px] text-[12px] text-[var(--mc-muted)]">
                共 {total} 条
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-[12px]">
              <span className="flex items-center gap-[6px] text-[12px] text-[var(--mc-muted)]">
                <i
                  aria-hidden="true"
                  className="h-[6px] w-[6px] rounded-full bg-[var(--mc-success)]"
                />
                平衡
              </span>
              <span className="flex items-center gap-[6px] text-[12px] text-[var(--mc-muted)]">
                <i
                  aria-hidden="true"
                  className="h-[6px] w-[6px] rounded-full bg-[var(--mc-red)]"
                />
                借贷不平
              </span>
              <Button
                variant="outline"
                className="h-[32px] px-[10px] text-[12px]"
                aria-pressed={onlyAbnormal}
                onClick={() => setOnlyAbnormal((only) => !only)}
              >
                仅当前页异常 · {abnormalCount}
              </Button>
            </div>
          </div>

          <TableArea
            status={status}
            error={list.error}
            rows={visibleRows}
            selectedId={activeRow?.transactionId ?? null}
            onSelect={selectRow}
            onRetry={() => void list.refetch()}
            onFocusFilters={() => firstFieldRef.current?.focus()}
            hiddenByFilter={hiddenByFilter}
            forbiddenFallback={fallbackModule ?? null}
          />

          {status === "ready" ? (
            <div className="flex flex-wrap items-center justify-between gap-[10px] border-t border-[var(--mc-line)] px-[14px] py-[10px] text-[12px] text-[var(--mc-muted)]">
              <span>
                第 {data?.page ?? page} / {totalPages} 页 · 共 {total} 条 · 每页{" "}
                {data?.pageSize ?? FUND_LEDGER_PAGE_SIZE} 条
              </span>
              <div className="flex items-center gap-[8px]">
                <Button
                  variant="outline"
                  className="h-[32px] px-[10px] text-[12px]"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <ChevronLeft size={14} />
                  上一页
                </Button>
                <Button
                  variant="outline"
                  className="h-[32px] px-[10px] text-[12px]"
                  disabled={page >= totalPages}
                  onClick={() => setPage((current) => current + 1)}
                >
                  下一页
                  <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          ) : null}
        </section>

        {traceOpen && activeRow ? (
          <TracePanel
            row={activeRow}
            focused={traceFocused}
            onToggleFocus={() => setTraceFocused((focused) => !focused)}
            onClose={() => {
              setTraceClosed(true);
              setTraceFocused(false);
            }}
          />
        ) : null}
      </div>

      {traceAvailable && traceClosed ? (
        <button
          type="button"
          data-testid="fund-ledger-trace-reopen"
          className="fixed bottom-[22px] right-[20px] z-30 rounded-md bg-[var(--mc-accent)] px-[16px] py-[10px] text-[13px] font-medium text-white shadow-lg transition-colors hover:bg-[#0e655d] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[rgba(17,120,111,.28)] motion-reduce:transition-none"
          onClick={() => setTraceClosed(false)}
        >
          打开交易追溯
        </button>
      ) : null}
    </div>
  );
}

/** 表格区：把 loading / 空态 / 400 / 403 / 401 / 500 与正常态分开渲染，错误态绝不沿用旧行。 */
function TableArea({
  status,
  error,
  rows,
  selectedId,
  onSelect,
  onRetry,
  onFocusFilters,
  hiddenByFilter,
  forbiddenFallback,
}: {
  status: LedgerStatus;
  error: unknown;
  rows: FundLedgerRow[];
  selectedId: string | null;
  onSelect: (transactionId: string) => void;
  onRetry: () => void;
  onFocusFilters: () => void;
  hiddenByFilter: boolean;
  forbiddenFallback: MerchantModule | null;
}) {
  if (status === "loading") {
    return (
      <div className="overflow-x-auto" aria-busy="true">
        <table className="w-full min-w-[1000px] border-collapse text-[12px]">
          <LedgerHead />
          <tbody>
            {Array.from({ length: SKELETON_ROWS }, (_, index) => (
              <tr
                key={index}
                className="border-b border-[var(--mc-line)]"
                style={{ height: ROW_HEIGHT }}
              >
                <td className="px-[12px]">
                  <span className="block h-[10px] w-[104px] animate-pulse rounded bg-[var(--mc-paper-2)] motion-reduce:animate-none" />
                </td>
                {[0, 1, 2, 3, 4, 5, 6].map((cell) => (
                  <td key={cell} className="px-[12px]">
                    <span className="block h-[10px] w-[72px] animate-pulse rounded bg-[var(--mc-paper-2)] motion-reduce:animate-none" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <span className="sr-only">正在加载资金台账…</span>
      </div>
    );
  }

  if (status === "forbidden") {
    return (
      <StateCard
        icon={<ShieldAlert size={22} />}
        title="无财务管理权限"
        body="当前账号缺少 finance.manage 权限，无法查看统一资金台账。请联系门店管理员调整角色权限。"
        action={
          forbiddenFallback ? (
            <Link href={`/merchant-console/${forbiddenFallback.id}`}>
              <Button variant="outline" className="h-[38px]">
                返回{forbiddenFallback.label}
              </Button>
            </Link>
          ) : undefined
        }
      />
    );
  }

  if (status === "expired") {
    // 401 沿用既有会话失效逻辑：token 已由 apiFetch 清理，外壳会引导重新登录。
    return (
      <StateCard
        icon={<ShieldAlert size={22} />}
        title="登录已失效"
        body="登录状态已失效，请重新登录后再查看统一资金台账。"
      />
    );
  }

  if (status === "bad-request") {
    return (
      <StateCard
        icon={<Info size={22} />}
        title="筛选条件未被服务端接受"
        body={
          error instanceof ApiError
            ? error.message
            : "服务端拒绝了当前筛选条件，请调整后重新查询。"
        }
        action={
          <Button
            variant="outline"
            className="h-[38px]"
            onClick={onFocusFilters}
          >
            调整筛选条件
          </Button>
        }
      />
    );
  }

  if (status === "error") {
    return (
      <StateCard
        icon={<RotateCw size={22} />}
        title="资金台账读取失败"
        body={
          error instanceof ApiError
            ? `${error.message}（HTTP ${error.status}）`
            : "网络异常，请检查网络后重试。"
        }
        action={
          <Button variant="outline" className="h-[38px]" onClick={onRetry}>
            <RotateCw size={15} />
            重试
          </Button>
        }
      />
    );
  }

  if (status === "empty" || hiddenByFilter) {
    return (
      <StateCard
        icon={<Info size={22} />}
        title="当前筛选范围内没有资金事件"
        body={
          hiddenByFilter
            ? "当前页没有借贷不平的记录，可关闭「仅当前页异常」查看全部行。"
            : "请调整日期、状态或关键词后重新查询。"
        }
        action={
          <Button
            variant="outline"
            className="h-[38px]"
            onClick={onFocusFilters}
          >
            调整筛选条件
          </Button>
        }
      />
    );
  }

  return (
    <LedgerTable rows={rows} selectedId={selectedId} onSelect={onSelect} />
  );
}

function LedgerTable({
  rows,
  selectedId,
  onSelect,
}: {
  rows: FundLedgerRow[];
  selectedId: string | null;
  onSelect: (transactionId: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table
        className={`w-full min-w-[1000px] border-collapse text-[12px] ${MONO}`}
        data-testid="fund-ledger-table"
      >
        <LedgerHead />
        <tbody>
          {rows.map((row) => {
            const abnormal = !row.balanced;
            const selected = row.transactionId === selectedId;
            // 与原型层叠一致：异常行底色优先于选中底色，选中标记仍然保留。
            const background = abnormal
              ? "bg-[#fffafa]"
              : selected
                ? "bg-[#edf8f6]"
                : "hover:bg-[var(--mc-paper-2)]";
            return (
              <tr
                key={row.transactionId}
                tabIndex={0}
                aria-selected={selected}
                className={`cursor-pointer border-b border-[var(--mc-line)] align-middle transition-colors focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-[rgba(17,120,111,.28)] motion-reduce:transition-none ${background}`}
                style={{ height: ROW_HEIGHT }}
                onClick={() => onSelect(row.transactionId)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(row.transactionId);
                  }
                }}
              >
                <td
                  className="px-[12px] text-[var(--mc-ink)]"
                  title={row.occurredAt}
                  style={
                    selected
                      ? { boxShadow: "inset 3px 0 var(--mc-accent)" }
                      : undefined
                  }
                >
                  {formatMoment(row.occurredAt)}
                </td>
                <td className="px-[12px]">
                  <span className="block text-[12px] text-[var(--mc-ink)]">
                    {textOr(row.txNo)}
                  </span>
                  <span className="block text-[11px] text-[var(--mc-muted)]">
                    {textOr(
                      row.sourceType === null && row.sourceId === null
                        ? null
                        : `${textOr(row.sourceType)} · ${textOr(row.sourceId)}`,
                    )}
                  </span>
                </td>
                <td className="px-[12px]">
                  <span className="flex flex-wrap items-center gap-[6px]">
                    <span className="text-[var(--mc-ink)]">
                      {eventTypeLabel(row.eventType)}
                    </span>
                    <LedgerBadge tone={statusTone(row.status)}>
                      {transactionStatusLabel(row.status)}
                    </LedgerBadge>
                  </span>
                </td>
                <td className="px-[12px] text-[var(--mc-ink)]">
                  {row.fundAccount === null ? (
                    <span className="text-[var(--mc-muted)]">
                      未关联资金账户
                    </span>
                  ) : (
                    row.fundAccount.name
                  )}
                </td>
                <td className="px-[12px]">
                  <LedgerBadge tone={flowTone(row.fundFlowDirection)}>
                    {fundFlowLabel(row.fundFlowDirection)}
                  </LedgerBadge>
                </td>
                <td className="px-[12px] text-right text-[var(--mc-ink)]">
                  {formatLedgerFen(row.amountFen)}
                </td>
                <td className="px-[12px]">
                  <LedgerBadge
                    tone={reconciliationTone(row.reconciliationStatus)}
                  >
                    {reconciliationStatusLabel(row.reconciliationStatus)}
                  </LedgerBadge>
                </td>
                <td className="px-[12px]">
                  <LedgerBadge tone={row.balanced ? "ok" : "bad"}>
                    {balancedLabel(row.balanced)}
                  </LedgerBadge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LedgerHead() {
  return (
    <thead className="sticky top-0 z-10 bg-[var(--mc-paper)]">
      <tr className="border-b border-[var(--mc-line)] text-[var(--mc-muted)]">
        <th
          scope="col"
          className="w-[130px] px-[12px] text-left text-[12px] font-medium"
          style={{ height: 39 }}
        >
          发生时间
        </th>
        <th
          scope="col"
          className="w-[184px] px-[12px] text-left text-[12px] font-medium"
          style={{ height: 39 }}
        >
          交易号 / 来源
        </th>
        <th scope="col" className="px-[12px] text-left text-[12px] font-medium">
          事件
        </th>
        <th scope="col" className="px-[12px] text-left text-[12px] font-medium">
          资金账户
        </th>
        <th scope="col" className="px-[12px] text-left text-[12px] font-medium">
          资金流向
        </th>
        <th
          scope="col"
          className="w-[106px] px-[12px] text-right text-[12px] font-medium"
        >
          金额
        </th>
        <th scope="col" className="px-[12px] text-left text-[12px] font-medium">
          对账状态
        </th>
        <th scope="col" className="px-[12px] text-left text-[12px] font-medium">
          平衡状态
        </th>
      </tr>
    </thead>
  );
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  ok: "border-[#cfe4d6] bg-[var(--mc-success-2)] text-[var(--mc-success)]",
  bad: "border-[#efcaca] bg-[var(--mc-red-2)] text-[var(--mc-red)]",
  warn: "border-[#f0e0bf] bg-[var(--mc-amber-2)] text-[var(--mc-amber-text)]",
  info: "border-[#cfdfee] bg-[var(--mc-blue-2)] text-[var(--mc-blue)]",
  neutral:
    "border-[var(--mc-line)] bg-[var(--mc-paper-2)] text-[var(--mc-muted)]",
};

function LedgerBadge({
  tone,
  children,
}: {
  tone: BadgeTone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-[5px] whitespace-nowrap rounded-full border px-[8px] py-[1px] text-[11px] font-medium ${TONE_CLASSES[tone]}`}
    >
      <i
        aria-hidden="true"
        className="h-[6px] w-[6px] shrink-0 rounded-full bg-current"
      />
      {children}
    </span>
  );
}

function StateCard({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-[10px] px-[20px] py-[52px] text-center">
      <span aria-hidden="true" className="text-[var(--mc-muted)]">
        {icon}
      </span>
      <p className="text-[15px] font-semibold text-[var(--mc-ink)]">{title}</p>
      <p className="max-w-[460px] text-[13px] leading-[1.6] text-[var(--mc-muted)]">
        {body}
      </p>
      {action}
    </div>
  );
}

/** C 证据链：来源事实 → 资金账户 → 借贷结果 → 确认信息，全部只读。 */
function TracePanel({
  row,
  focused,
  onToggleFocus,
  onClose,
}: {
  row: FundLedgerRow;
  focused: boolean;
  onToggleFocus: () => void;
  onClose: () => void;
}) {
  const abnormal = !row.balanced;
  const difference = formatLedgerFen(
    ledgerDifferenceFen(row.debitFen, row.creditFen),
  );
  const auxiliaries =
    row.auxiliaries.length === 0
      ? FUND_LEDGER_EMPTY_TEXT
      : row.auxiliaries.map((item) => `${item.type}:${item.id}`).join("、");

  return (
    <aside
      data-testid="fund-ledger-trace"
      aria-label="交易追溯"
      className="min-w-0 overflow-hidden rounded-[12px] border border-[var(--mc-line)] bg-[var(--mc-paper)] transition-[opacity,transform] duration-200 motion-reduce:transition-none"
    >
      <div
        className="flex items-center justify-between gap-[10px] bg-[#173e42] px-[14px] py-[10px]"
        style={{ minHeight: 70 }}
      >
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.16em] text-white/60">
            TRANSACTION EVIDENCE
          </p>
          <h2 className="text-[15px] font-semibold text-white">交易追溯</h2>
        </div>
        <div className="flex items-center gap-[6px]">
          <button
            type="button"
            title="聚焦证据链"
            aria-label="聚焦证据链"
            aria-pressed={focused}
            className="flex h-[28px] w-[28px] items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[rgba(17,120,111,.28)] motion-reduce:transition-none"
            onClick={onToggleFocus}
          >
            <Focus size={15} />
          </button>
          <button
            type="button"
            title="关闭追溯"
            aria-label="关闭追溯"
            className="flex h-[28px] w-[28px] items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[rgba(17,120,111,.28)] motion-reduce:transition-none"
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="border-b border-[var(--mc-line)] px-[14px] py-[10px]">
        <p className={`text-[13px] text-[var(--mc-ink)] ${MONO}`}>
          {textOr(row.txNo)}
        </p>
        <p className="mt-[2px] text-[12px] text-[var(--mc-muted)]">
          金额 <span className={MONO}>{formatLedgerFen(row.amountFen)}</span> ·
          发生时间 <span className={MONO}>{formatMoment(row.occurredAt)}</span>
        </p>
      </div>

      <div className="max-h-[calc(100vh-320px)] space-y-[12px] overflow-y-auto px-[14px] py-[14px]">
        <TraceStep index="01" kicker="来源事实">
          <TraceTitle>
            <span>{eventTypeLabel(row.eventType)}</span>
            <LedgerBadge tone={statusTone(row.status)}>
              {transactionStatusLabel(row.status)}
            </LedgerBadge>
          </TraceTitle>
          <TraceGrid>
            <TraceItem label="来源类型" value={textOr(row.sourceType)} mono />
            <TraceItem label="来源 ID" value={textOr(row.sourceId)} mono />
            <TraceItem
              label="摘要"
              value={textOr(row.description)}
              full
              mono={false}
            />
          </TraceGrid>
        </TraceStep>

        <TraceStep
          index="02"
          kicker="资金账户"
          alert={row.fundAccount === null}
        >
          <TraceTitle>
            <span>
              {row.fundAccount === null
                ? "未关联资金账户"
                : row.fundAccount.name}
            </span>
          </TraceTitle>
          <TraceGrid>
            <TraceItem
              label="资金账户引用"
              value={textOr(row.fundAccount?.code)}
              mono
            />
            <TraceItem
              label="资金流向"
              value={fundFlowLabel(row.fundFlowDirection)}
            />
            <TraceItem
              // 契约枚举原值直出：本切片没有批准的中文映射，不臆造。
              label="账户类型"
              value={textOr(row.fundAccount?.kind)}
              mono
            />
            <TraceItem
              label="账户状态"
              value={textOr(row.fundAccount?.status)}
              mono
            />
          </TraceGrid>
        </TraceStep>

        <TraceStep index="03" kicker="借贷结果" alert={abnormal}>
          <TraceTitle>
            <span>账务落账结果</span>
            <LedgerBadge tone={abnormal ? "bad" : "ok"}>
              {balancedLabel(row.balanced)}
            </LedgerBadge>
          </TraceTitle>
          <TraceGrid>
            <TraceItem
              label="借方合计"
              value={formatLedgerFen(row.debitFen)}
              mono
              danger={abnormal}
            />
            <TraceItem
              label="贷方合计"
              value={formatLedgerFen(row.creditFen)}
              mono
              danger={abnormal}
            />
            <TraceItem label="辅助核算引用" value={auxiliaries} mono full />
          </TraceGrid>
          <div
            className={`mt-[10px] flex items-center justify-between gap-[10px] rounded-[8px] px-[10px] py-[8px] text-[12px] ${
              abnormal
                ? "bg-[var(--mc-red-2)] text-[var(--mc-red)]"
                : "bg-[var(--mc-success-2)] text-[var(--mc-success)]"
            }`}
          >
            <span>{abnormal ? "借贷差额需要处理" : "借贷合计一致"}</span>
            <b className={MONO}>差额 {difference}</b>
          </div>
        </TraceStep>

        <TraceStep index="04" kicker="确认信息">
          <TraceTitle>
            <span>人员与时间引用</span>
            <LedgerBadge tone={reconciliationTone(row.reconciliationStatus)}>
              {reconciliationStatusLabel(row.reconciliationStatus)}
            </LedgerBadge>
          </TraceTitle>
          <TraceGrid>
            <TraceItem
              label="交易状态"
              value={transactionStatusLabel(row.status)}
            />
            <TraceItem label="创建人 ID" value={textOr(row.createdBy)} mono />
            <TraceItem label="确认人 ID" value={textOr(row.confirmedBy)} mono />
            <TraceItem
              label="发生时间"
              value={formatMoment(row.occurredAt)}
              mono
            />
            <TraceItem
              label="确认时间"
              value={formatMoment(row.confirmedAt)}
              mono
            />
            <TraceItem
              label="创建时间"
              value={formatMoment(row.createdAt)}
              mono
              full
            />
          </TraceGrid>
        </TraceStep>
      </div>

      <div className="border-t border-[var(--mc-line)] px-[14px] py-[10px] text-[11px] text-[var(--mc-muted)]">
        证据链只读 · 来自已确认业务事件
      </div>
    </aside>
  );
}

function TraceStep({
  index,
  kicker,
  alert = false,
  children,
}: {
  index: string;
  kicker: string;
  alert?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="relative pl-[34px]">
      <span
        aria-hidden="true"
        className={`absolute left-0 top-[2px] flex h-[24px] w-[24px] items-center justify-center rounded-full border text-[11px] font-semibold ${
          alert
            ? "border-[#efcaca] bg-[var(--mc-red-2)] text-[var(--mc-red)]"
            : "border-[var(--mc-line)] bg-[var(--mc-paper-2)] text-[var(--mc-muted)]"
        } ${MONO}`}
      >
        {index}
      </span>
      <div className="rounded-[10px] border border-[var(--mc-line)] bg-[var(--mc-paper)] p-[10px]">
        <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--mc-muted)]">
          {kicker}
        </p>
        {children}
      </div>
    </section>
  );
}

function TraceTitle({ children }: { children: ReactNode }) {
  return (
    <div className="mt-[2px] flex flex-wrap items-center gap-[8px] text-[13px] font-medium text-[var(--mc-ink)]">
      {children}
    </div>
  );
}

function TraceGrid({ children }: { children: ReactNode }) {
  return (
    <div className="mt-[8px] grid grid-cols-2 gap-x-[10px] gap-y-[8px]">
      {children}
    </div>
  );
}

function TraceItem({
  label,
  value,
  mono = false,
  full = false,
  danger = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  full?: boolean;
  danger?: boolean;
}) {
  return (
    <div className={full ? "col-span-2 min-w-0" : "min-w-0"}>
      <p className="text-[11px] text-[var(--mc-muted)]">{label}</p>
      <p
        className={`break-all text-[12px] ${
          danger ? "text-[var(--mc-red)]" : "text-[var(--mc-ink)]"
        } ${mono ? MONO : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

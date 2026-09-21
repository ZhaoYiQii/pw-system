"use client";

/**
 * 审核台（订单中心列表 Slice 2）：三栏 —— 报单队列 / 开始-结束截图并排对照 / 通过-驳回动作。
 *
 * 口径（见 docs/superpowers/plans/2026-09-22-order-center-list.md）：
 * - 队列取自 `GET /api/v1/tenant/sessions?reportStatus=…`（Slice 2 给列表补了报单字段）；
 * - `reportStatus` 与场次详情同一推导（未提交/待审批/已通过/已驳回）；
 * - 对照用 `GET /sessions/{id}` 的申报时长与证据计时，差额阈值复用 `durationGap()`（10 分钟或 15% 取大者）；
 * - 动作走既有 `POST /game-dispatch/slots/{slotId}/report/review`（approve=false 驳回；可通过修正时长），
 *   留痕仍写在 `audit_logs`（action = `game_dispatch.slot_report.*`），本页不新建留痕通道；
 * - 截图走既有证据通道 `GET /tenant/slot-evidence/{id}`，需要 Bearer，所以用 fetch + blob URL。
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch, ApiError, getAccessToken } from "../api";
import { durationGap, GAP_ABS_MINUTES, GAP_RATIO } from "./duration-gap";

const API_ORIGIN =
  process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://127.0.0.1:3000";

type ReportStatus = "PENDING_REVIEW" | "APPROVED" | "REJECTED";

const QUEUE_TABS = [
  { id: "PENDING_REVIEW" as const, label: "待审批" },
  { id: "APPROVED" as const, label: "已通过" },
  { id: "REJECTED" as const, label: "已驳回" },
];

interface QueueRow {
  id: string;
  flow: "CLASSIC" | "GAME_DISPATCH";
  slotId: string | null;
  orderId: string;
  orderNo: string;
  playerId: string;
  playerName: string;
  customerName: string;
  status: string;
  reportStatus: string;
  declaredDurationMinutes: number | null;
  reportSubmittedAt: string | null;
  hasReportEvidence: boolean;
}

interface EvidenceItem {
  id: string;
  mimeType: string;
  evidenceType: string;
  originalName: string;
}

interface SessionDetail {
  id: string;
  flow: "CLASSIC" | "GAME_DISPATCH";
  slotId: string | null;
  orderId: string;
  playerId: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  declaredDurationMinutes: number | null;
  reportStatus: string;
  reportSubmittedAt: string | null;
  reportReviewedAt: string | null;
  reportReviewNote: string | null;
  evidence: EvidenceItem[];
}

/** 列表接口只交出 `data` 数组时的兜底（与订单中心同一处理）。 */
function rowsOf(payload: unknown): QueueRow[] {
  if (Array.isArray(payload)) return payload as QueueRow[];
  if (payload !== null && typeof payload === "object") {
    const data = (payload as { data?: unknown }).data;
    if (Array.isArray(data)) return data as QueueRow[];
  }
  return [];
}

function formatDateTime(iso: string | null): string {
  if (iso === null) return "—";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString("zh-CN", { hour12: false });
}

export function ReviewConsoleView() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ReportStatus>("PENDING_REVIEW");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [correctedMinutes, setCorrectedMinutes] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  // 深链：`?sessionId=` 直接选中一条（场次详情「去审核台」、订单中心证据徽章都走这个）。
  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get(
      "sessionId",
    );
    if (sessionId) setSelectedId(sessionId);
  }, []);

  const queueQuery = useQuery({
    queryKey: ["merchant", "review", "queue", tab],
    queryFn: () =>
      apiFetch<unknown>(`/api/v1/tenant/sessions?reportStatus=${tab}`),
    placeholderData: (previous) => previous,
  });
  const queue = useMemo(() => rowsOf(queueQuery.data), [queueQuery.data]);

  const visibleQueue = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return queue;
    return queue.filter((row) =>
      [row.playerName, row.orderNo, row.customerName].some((text) =>
        text.toLowerCase().includes(keyword),
      ),
    );
  }, [queue, query]);

  // 选中项：优先用 URL 指定的；否则默认取过滤后的第一条（客服进来就能看第一条）。
  const activeId = useMemo(() => {
    if (selectedId && visibleQueue.some((row) => row.id === selectedId)) {
      return selectedId;
    }
    return visibleQueue[0]?.id ?? null;
  }, [selectedId, visibleQueue]);
  const active = visibleQueue.find((row) => row.id === activeId) ?? null;

  const detailQuery = useQuery({
    queryKey: ["merchant", "review", "session", activeId],
    queryFn: () =>
      apiFetch<SessionDetail>(`/api/v1/tenant/sessions/${activeId}`),
    enabled: activeId !== null,
  });
  const detail = detailQuery.data ?? null;

  const reportEvidence = useMemo(() => {
    const items = detail?.evidence ?? [];
    return {
      start: items.find((item) => item.evidenceType === "REPORT_START") ?? null,
      end: items.find((item) => item.evidenceType === "REPORT_END") ?? null,
    };
  }, [detail]);

  const gap = durationGap(
    detail?.declaredDurationMinutes ?? null,
    detail?.durationSeconds ?? null,
  );

  async function review(approve: boolean) {
    if (!active?.slotId) {
      setError("这条场次没有档位 id，无法审批（CLASSIC 流程冻结报单链路）。");
      return;
    }
    const corrected = correctedMinutes.trim();
    if (corrected !== "" && !/^\d+$/.test(corrected)) {
      setError("修正时长必须是非负整数分钟。");
      return;
    }
    if (!approve && reason.trim() === "") {
      setError("驳回必须填理由，客服才能向陪玩说明。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(
        `/api/v1/tenant/game-dispatch/slots/${active.slotId}/report/review`,
        {
          method: "POST",
          body: JSON.stringify({
            approve,
            ...(corrected === ""
              ? {}
              : { declaredDurationMinutes: Number(corrected) }),
            ...(reason.trim() === "" ? {} : { reason: reason.trim() }),
          }),
        },
      );
      setNotice(`${active.playerName} 的报单已${approve ? "通过" : "驳回"}。`);
      setCorrectedMinutes("");
      setReason("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["merchant", "review"] }),
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "审批失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs tracking-widest text-muted-foreground uppercase">
            RECORDS / REVIEW
          </p>
          <h1 className="text-2xl font-semibold">审核台</h1>
          <p className="text-sm text-muted-foreground">
            报单队列 → 开始/结束截图并排对照 →
            通过或驳回；通过时可按证据修正时长（修正值计费）。
          </p>
        </div>
        <Badge variant="secondary">队列 {queue.length} 条</Badge>
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
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)_320px]">
        {/* 左栏：队列 */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <div role="tablist" aria-label="报单状态" className="flex gap-1.5">
              {QUEUE_TABS.map((item) => {
                const activeTab = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab}
                    className={`rounded-md border px-2.5 py-1 text-sm ${
                      activeTab
                        ? "border-primary bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                    onClick={() => {
                      setTab(item.id);
                      setSelectedId(null);
                      setNotice(null);
                      setError(null);
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
            <Input
              aria-label="搜索队列"
              placeholder="陪玩 / 单号 / 老板"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />

            {queueQuery.isError ? (
              <p className="text-sm text-destructive">
                {queueQuery.error instanceof ApiError &&
                queueQuery.error.status === 403
                  ? "当前角色没有查看场次的权限。"
                  : "队列加载失败，请重试。"}
              </p>
            ) : null}
            {queueQuery.isLoading ? (
              <div className="space-y-2" aria-busy="true">
                {[0, 1, 2].map((index) => (
                  <div
                    key={index}
                    className="h-12 animate-pulse rounded bg-muted"
                    aria-hidden="true"
                  />
                ))}
                <span className="sr-only">正在加载报单队列…</span>
              </div>
            ) : null}
            {!queueQuery.isLoading && visibleQueue.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                这个队列现在是空的。
              </p>
            ) : null}

            <ul className="space-y-1.5">
              {visibleQueue.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    aria-current={row.id === activeId ? "true" : undefined}
                    className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                      row.id === activeId
                        ? "border-primary bg-accent"
                        : "hover:bg-muted"
                    }`}
                    onClick={() => {
                      setSelectedId(row.id);
                      setCorrectedMinutes("");
                      setReason("");
                      setNotice(null);
                      setError(null);
                    }}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <b>{row.playerName}</b>
                      <span className="text-xs text-muted-foreground">
                        {row.declaredDurationMinutes ?? "—"} 分钟
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {row.orderNo} · {row.customerName}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs">
                      <span>{formatDateTime(row.reportSubmittedAt)}</span>
                      <Badge
                        variant={
                          row.hasReportEvidence ? "secondary" : "destructive"
                        }
                      >
                        {row.hasReportEvidence ? "截图齐" : "缺截图"}
                      </Badge>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* 中栏：截图并排对照 */}
        <Card>
          <CardContent className="space-y-3 p-4">
            {active === null ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                左侧选一条报单开始核对。
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-medium">
                      {active.playerName} · {active.orderNo}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      老板 {active.customerName} · 场次状态 {active.status}
                    </p>
                  </div>
                  <Badge
                    variant={
                      gap.tone === "warn"
                        ? "destructive"
                        : gap.tone === "ok"
                          ? "secondary"
                          : "outline"
                    }
                  >
                    {gap.tone === "unknown"
                      ? "证据计时缺失"
                      : gap.tone === "warn"
                        ? "时长差异需重点核对"
                        : "时长吻合"}
                  </Badge>
                </div>

                <div className="flex flex-wrap gap-4 text-sm">
                  <span>
                    申报：<b>{detail?.declaredDurationMinutes ?? "—"} 分钟</b>
                  </span>
                  <span>
                    证据计时：
                    <b>
                      {gap.evidenceMinutes === null
                        ? "—"
                        : `${gap.evidenceMinutes.toFixed(1)} 分钟`}
                    </b>
                  </span>
                  <span>
                    差额：
                    <b>
                      {gap.deltaMinutes === null
                        ? "—"
                        : `${gap.deltaMinutes.toFixed(1)} 分钟`}
                    </b>
                  </span>
                  <span className="text-muted-foreground">
                    提示阈值：≥ {GAP_ABS_MINUTES} 分钟或申报的{" "}
                    {Math.round(GAP_RATIO * 100)}%
                  </span>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <EvidencePane
                    title="开始截图"
                    evidenceId={reportEvidence.start?.id ?? null}
                  />
                  <EvidencePane
                    title="结束截图"
                    evidenceId={reportEvidence.end?.id ?? null}
                  />
                </div>

                <p className="text-xs text-muted-foreground">
                  提交于 {formatDateTime(detail?.reportSubmittedAt ?? null)}
                  {detail?.reportReviewedAt
                    ? ` · 上次审批 ${formatDateTime(detail.reportReviewedAt)}`
                    : ""}
                  {detail?.reportReviewNote
                    ? ` · 备注：${detail.reportReviewNote}`
                    : ""}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* 右栏：动作 */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="text-base font-medium">审批动作</h2>
            {active === null ? (
              <p className="text-sm text-muted-foreground">先选中一条报单。</p>
            ) : active.slotId === null ? (
              <p className="text-sm text-destructive">
                这条场次没有档位 id（CLASSIC 流程没有报单链路），无法审批。
              </p>
            ) : (
              <>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">
                    修正时长（分钟，可空）
                  </span>
                  <Input
                    aria-label="修正时长（分钟）"
                    inputMode="numeric"
                    placeholder={`留空按申报 ${active.declaredDurationMinutes ?? "—"} 分钟计费`}
                    value={correctedMinutes}
                    onChange={(event) =>
                      setCorrectedMinutes(event.target.value)
                    }
                  />
                  <span className="mt-1 block text-xs text-muted-foreground">
                    通过时填了就以修正值计费，原始申报值仍留在审计里。
                  </span>
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">
                    理由 / 备注（驳回必填）
                  </span>
                  <Input
                    aria-label="理由或备注"
                    placeholder="如：截图核对为 2 小时"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => void review(true)}
                  >
                    {busy ? "提交中…" : "通过报单"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void review(false)}
                  >
                    驳回
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  审批结果写入
                  `audit_logs`（`game_dispatch.slot_report.reviewed`），不在这里新建留痕。
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** 证据图：走带 Bearer 的下载端点取 blob（不能用 <img src> 直连）。 */
function EvidencePane({
  title,
  evidenceId,
}: {
  title: string;
  evidenceId: string | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (evidenceId === null) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    const token = getAccessToken();
    const headers = new Headers();
    if (token) headers.set("authorization", `Bearer ${token}`);
    void fetch(`${API_ORIGIN}/api/v1/tenant/slot-evidence/${evidenceId}`, {
      headers,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [evidenceId]);

  return (
    <figure className="space-y-1.5">
      <figcaption className="text-sm font-medium">{title}</figcaption>
      {evidenceId === null ? (
        <p className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
          未上传
        </p>
      ) : failed ? (
        <p className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-destructive">
          截图加载失败
        </p>
      ) : url === null ? (
        <div
          className="h-40 animate-pulse rounded-md bg-muted"
          aria-busy="true"
          aria-label={`${title}加载中`}
        />
      ) : (
        <a href={url} target="_blank" rel="noreferrer">
          {/* 证据是运行时 blob（object URL），next/image 的静态优化不适用。 */}
          <img
            src={url}
            alt={title}
            className="max-h-72 w-full rounded-md border object-contain"
          />
        </a>
      )}
    </figure>
  );
}

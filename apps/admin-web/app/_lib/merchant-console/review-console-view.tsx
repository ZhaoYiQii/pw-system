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
  /** 档位单价（分/小时，快照）；用于动作区的金额换算，未定价为 null。 */
  unitPriceFen: string | null;
}

/** 已通过队列行：只用来统计「今日已通过」。 */
interface ApprovedRow {
  id: string;
  reportReviewedAt: string | null;
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
  /** 站内放大截图（点图放大，稿子里标了「点图放大」）。 */
  const [zoom, setZoom] = useState<{ url: string; title: string } | null>(null);
  /** 截图视图：并排看整体 / 单张看细节（竖屏截图并排会变小）。 */
  const [shotView, setShotView] = useState<"pair" | "one">("pair");

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
  /**
   * 队列按等待时长排序（等最久的排最前）：时间缺失的排最前，不假装它最不急；
   * 未来时间按 0 等待处理，不插队。
   */
  const queue = useMemo(() => {
    const submittedAt = (row: QueueRow) => {
      if (!row.reportSubmittedAt) return Number.POSITIVE_INFINITY;
      const parsed = Date.parse(row.reportSubmittedAt);
      return Number.isNaN(parsed)
        ? Number.POSITIVE_INFINITY
        : Math.max(0, Date.now() - parsed);
    };
    return [...rowsOf(queueQuery.data)].sort(
      (a, b) => submittedAt(b) - submittedAt(a),
    );
  }, [queueQuery.data]);

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

  // 「今日已通过」：拉已通过队列，按审批时间落在今天过滤（只读计数，不影响主流程）。
  const approvedQuery = useQuery({
    queryKey: ["merchant", "review", "queue", "APPROVED", "today-count"],
    queryFn: () =>
      apiFetch<unknown>("/api/v1/tenant/sessions?reportStatus=APPROVED"),
  });
  const approvedTodayCount = useMemo(() => {
    const rows = Array.isArray(approvedQuery.data)
      ? (approvedQuery.data as ApprovedRow[])
      : ((approvedQuery.data as { data?: ApprovedRow[] } | null)?.data ?? []);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return rows.filter((row) => {
      if (!row.reportReviewedAt) return false;
      const reviewed = Date.parse(row.reportReviewedAt);
      return !Number.isNaN(reviewed) && reviewed >= startOfToday.getTime();
    }).length;
  }, [approvedQuery.data]);

  const detailQuery = useQuery({
    queryKey: ["merchant", "review", "session", activeId],
    queryFn: () =>
      apiFetch<SessionDetail>(`/api/v1/tenant/sessions/${activeId}`),
    enabled: activeId !== null,
  });
  const detail = detailQuery.data ?? null;

  /**
   * 档位单价（分/小时，快照）：场次接口不带这个字段，所以从订单详情取报名行上的 `unitPriceFen`。
   * 只用于动作区的**预计**金额换算（结算仍以后端核定为准），取不到就显示 ¥—，不编数字。
   */
  const orderQuery = useQuery({
    queryKey: ["merchant", "review", "order-price", detail?.orderId],
    queryFn: () =>
      apiFetch<{
        lines?: Array<{
          applications?: Array<{
            playerId?: string;
            slotId?: string | null;
            unitPriceFen?: string | null;
          }>;
        }>;
      }>(`/api/v1/tenant/game-dispatch/orders/${detail?.orderId}`),
    enabled: Boolean(detail?.orderId),
  });
  const unitPriceFen = useMemo(() => {
    const targetSlotId = detail?.slotId ?? active?.slotId ?? null;
    const applications = (orderQuery.data?.lines ?? []).flatMap(
      (line) => line.applications ?? [],
    );
    const hit =
      applications.find((item) => item.slotId === targetSlotId) ??
      applications.find((item) => item.playerId === detail?.playerId);
    return hit?.unitPriceFen ?? null;
  }, [orderQuery.data, detail?.slotId, detail?.playerId, active?.slotId]);

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

  /**
   * 动作区换算：生效分钟数 = 修正值（填了且为整数）否则申报值；
   * 金额按「单价 × 分钟 ÷ 60 向上取整」与结算同口径，全部走整数分（BigInt），不碰浮点。
   * 单价缺失时不编数字。
   */
  const effectiveMinutes = useMemo(() => {
    const corrected = correctedMinutes.trim();
    if (/^\d+$/.test(corrected)) return Number(corrected);
    return detail?.declaredDurationMinutes ?? null;
  }, [correctedMinutes, detail?.declaredDurationMinutes]);
  const previewAmountLabel = useMemo(() => {
    if (!unitPriceFen || effectiveMinutes === null) return "¥—";
    const fen = (BigInt(unitPriceFen) * BigInt(effectiveMinutes) + 59n) / 60n;
    const yuan = fen / 100n;
    const cents = fen % 100n;
    return `¥${yuan}.${cents.toString().padStart(2, "0")}`;
  }, [unitPriceFen, effectiveMinutes]);

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
    <div className="pw-review rv-page">
      {/* 页头（原型 v3）：左标题 + 右两胶囊（待审批 / 今日已通过） */}
      <header className="rv-head">
        <div>
          <p className="rv-eyebrow">RECORDS / REVIEW</p>
          <h1>审核台</h1>
          <p className="rv-sub">
            对照开始 /
            结束截图核对申报时长；通过时可按证据修正，修正值计费并写审计。
          </p>
        </div>
        <div className="rv-pills">
          <span className="rv-pill warn">待审批 {queue.length}</span>
          <span className="rv-pill ok">今日已通过 {approvedTodayCount}</span>
        </div>
      </header>

      {notice ? (
        <p
          role="status"
          aria-live="polite"
          className="mt-3 rounded-md bg-muted px-3 py-2 text-sm"
        >
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="rv-grid">
        {/* 左栏：队列（按等待时长排序） */}
        <section className="rv-card">
          <div className="rv-colhead">
            <b>待审核队列</b>
            <span>按等待时长</span>
          </div>

          <div className="px-3 pt-3">
            <div role="tablist" aria-label="报单状态" className="rv-seg w-full">
              {QUEUE_TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.id}
                  className={`${tab === item.id ? "on" : ""} flex-1`}
                  onClick={() => {
                    setTab(item.id);
                    setSelectedId(null);
                    setNotice(null);
                    setError(null);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <Input
              aria-label="搜索队列"
              placeholder="陪玩 / 单号 / 老板"
              className="mt-2 h-8 text-[12.5px]"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <div className="mt-2">
            {queueQuery.isError ? (
              <p className="px-3 py-2 text-sm text-destructive">
                {queueQuery.error instanceof ApiError &&
                queueQuery.error.status === 403
                  ? "当前角色没有查看场次的权限。"
                  : "队列加载失败，请重试。"}
              </p>
            ) : null}
            {queueQuery.isLoading ? (
              <div className="space-y-2 px-3 py-2" aria-busy="true">
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
              <p className="px-3 py-4 text-sm text-muted-foreground">
                这个队列现在是空的。
              </p>
            ) : null}

            {visibleQueue.map((row) => (
              <button
                key={row.id}
                type="button"
                aria-current={row.id === activeId ? "true" : undefined}
                className={`rv-q ${row.id === activeId ? "on" : ""}`}
                onClick={() => {
                  setSelectedId(row.id);
                  setCorrectedMinutes("");
                  setReason("");
                  setNotice(null);
                  setError(null);
                }}
              >
                <i
                  aria-hidden="true"
                  className={`rv-dot ${
                    row.reportStatus === "APPROVED"
                      ? "ok"
                      : row.reportStatus === "REJECTED"
                        ? "bad"
                        : ""
                  }`}
                />
                <span className="main">
                  <span className="l1">
                    <b>{row.playerName}</b>
                    <span className="pw-num text-[11.5px] text-muted-foreground">
                      {row.declaredDurationMinutes ?? "—"} 分
                    </span>
                  </span>
                  <span className="l2">
                    {row.orderNo} · {row.customerName}
                  </span>
                  <span className="l3">
                    <span className="pw-num">
                      {formatWait(row.reportSubmittedAt)}
                    </span>
                    <span
                      className={
                        row.hasReportEvidence
                          ? undefined
                          : "text-[color:var(--mc-red)]"
                      }
                    >
                      {row.hasReportEvidence ? "截图齐" : "缺截图"}
                    </span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* 中栏：证据对照 */}
        <section className="rv-card">
          {active === null ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              左侧选一条报单开始核对。
            </p>
          ) : (
            <>
              <div className="rv-midhead">
                <div>
                  <h2 className="pw-num">证据对照 · {active.orderNo}</h2>
                  <div className="sub">
                    {active.playerName} · {active.customerName} · 提交于{" "}
                    {formatDateTime(detail?.reportSubmittedAt ?? null)}
                  </div>
                </div>
                <span
                  className={`rv-pill ${
                    gap.tone === "warn" ? "warn" : gap.tone === "ok" ? "ok" : ""
                  }`}
                >
                  {gap.tone === "unknown"
                    ? "证据计时缺失"
                    : gap.tone === "warn"
                      ? "差异需核对"
                      : "时长吻合"}
                </span>
              </div>

              <div className="rv-viewbar">
                <span className="text-[11.5px] text-muted-foreground">
                  点任意一张可在站内放大看细节
                </span>
                <span className="rv-seg">
                  <button
                    type="button"
                    aria-pressed={shotView === "pair"}
                    className={shotView === "pair" ? "on" : ""}
                    onClick={() => setShotView("pair")}
                  >
                    并排
                  </button>
                  <button
                    type="button"
                    aria-pressed={shotView === "one"}
                    className={shotView === "one" ? "on" : ""}
                    onClick={() => setShotView("one")}
                  >
                    单张
                  </button>
                </span>
              </div>

              <div className={`rv-shots ${shotView}`}>
                <EvidencePane
                  title="报单开始截图"
                  evidenceId={reportEvidence.start?.id ?? null}
                  onZoom={(url) => setZoom({ url, title: "报单开始截图" })}
                />
                {shotView === "pair" ? (
                  <EvidencePane
                    title="报单结束截图"
                    evidenceId={reportEvidence.end?.id ?? null}
                    onZoom={(url) => setZoom({ url, title: "报单结束截图" })}
                  />
                ) : null}
              </div>

              {/* 单行事实（原型 v3）：申报 · 证据计时 · 差额 */}
              <div className="rv-oneline">
                <span>
                  <span className="k">申报</span>{" "}
                  <span className="v pw-num">
                    {detail?.declaredDurationMinutes ?? "—"} 分
                  </span>
                </span>
                <span>
                  <span className="k">证据计时</span>{" "}
                  <span className="v pw-num">
                    {gap.evidenceMinutes === null
                      ? "—"
                      : formatEvidenceMinutes(gap.evidenceMinutes)}
                  </span>
                </span>
                <span>
                  <span className="k">差额</span>{" "}
                  <span
                    className={`v pw-num ${gap.tone === "warn" ? "bad" : ""}`}
                  >
                    {gap.deltaMinutes === null
                      ? "—"
                      : `${gap.deltaMinutes > 0 ? "+" : ""}${formatEvidenceMinutes(
                          gap.deltaMinutes,
                        )}`}
                  </span>
                </span>
              </div>

              {gap.tone === "warn" ? (
                <p className="rv-warnbar">
                  超出阈值（{GAP_ABS_MINUTES} 分或 {Math.round(GAP_RATIO * 100)}
                  %）· 修正按修正值计费
                </p>
              ) : null}

              {detail?.reportReviewNote ? (
                <p className="mx-3 mb-3 text-[11.5px] text-muted-foreground">
                  上次审批备注：{detail.reportReviewNote}
                </p>
              ) : null}
            </>
          )}
        </section>

        {/* 右栏：动作 */}
        <section className="rv-card">
          <div className="rv-colhead">
            <b>审批动作</b>
            <span>留痕入审计</span>
          </div>
          <div className="rv-actions">
            {active === null ? (
              <p className="text-sm text-muted-foreground">先选中一条报单。</p>
            ) : active.slotId === null ? (
              <p className="text-sm text-destructive">
                这条场次没有档位 id（CLASSIC 流程没有报单链路），无法审批。
              </p>
            ) : (
              <>
                <label className="rv-field">
                  <span>
                    修正时长（分钟，留空按申报{" "}
                    {active.declaredDurationMinutes ?? "—"} 分钟计费）
                  </span>
                  <Input
                    aria-label="修正时长（分钟）"
                    inputMode="numeric"
                    placeholder="如 95"
                    className="h-8 text-[12.5px]"
                    value={correctedMinutes}
                    onChange={(event) =>
                      setCorrectedMinutes(event.target.value)
                    }
                  />
                </label>
                <label className="rv-field">
                  <span>理由 / 备注（驳回必填）</span>
                  <Input
                    aria-label="理由或备注"
                    placeholder="如：截图核对为 2 小时"
                    className="h-8 text-[12.5px]"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
                <div className="rv-calc">
                  <span className="pw-num">
                    {unitPriceFen
                      ? `${unitPriceFen} 分/小时 × ${effectiveMinutes} 分 ÷ 60`
                      : "档位未定价"}
                  </span>
                  <b className="pw-num">{previewAmountLabel}</b>
                </div>
                <div className="rv-btnrow">
                  <button
                    type="button"
                    className="rv-btn p"
                    disabled={busy}
                    onClick={() => void review(true)}
                  >
                    {busy ? "提交中…" : `通过并计费 ${previewAmountLabel}`}
                  </button>
                  <button
                    type="button"
                    className="rv-btn d"
                    disabled={busy}
                    onClick={() => void review(false)}
                  >
                    驳回重报
                  </button>
                </div>
                <div className="rv-divider" />
                <p className="rv-hint">
                  通过后金额按核定分钟数落
                  `slot_earnings`；驳回要求陪玩重新报单。
                  <br />
                  动作写入
                  `audit_logs`（`game_dispatch.slot_report.reviewed`）。
                </p>
              </>
            )}
          </div>
        </section>
      </div>

      {zoom ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${zoom.title}放大预览`}
          className="fixed inset-0 z-50 flex flex-col items-center gap-3 overflow-auto bg-black/70 p-6"
          onClick={() => setZoom(null)}
        >
          {/* 证据是运行时 blob，不能用 next/image 的静态优化。 */}
          <img
            src={zoom.url}
            alt={zoom.title}
            className="max-w-[92vw] rounded-md bg-white object-contain shadow-xl"
          />
          <p className="text-sm text-white">
            {zoom.title} · 点任意处或按 Esc 返回
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** 证据图：走带 Bearer 的下载端点取 blob（不能用 <img src> 直连）。 */
function EvidencePane({
  title,
  evidenceId,
  onZoom,
}: {
  title: string;
  evidenceId: string | null;
  onZoom: (url: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  /**
   * 空态分三种，全部用文字表达，避免浏览器画「图片裂开」的默认占位图标：
   * `none` 正常 / `load` 取图失败（HTTP 或网络）/ `missing` 取回了 blob 但图片解码失败。
   */
  const [failed, setFailed] = useState<"none" | "load" | "missing">("none");

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
        if (!cancelled) setFailed("load");
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [evidenceId]);

  return (
    <figure className="rv-shot">
      <div className="rv-shot-cap">
        <span>{title}</span>
      </div>
      {evidenceId === null ? (
        <div className="rv-shot-body">未上传（等陪玩补图）</div>
      ) : failed === "load" ? (
        <div className="rv-shot-body text-[color:var(--mc-red)]">
          截图加载失败（可点右侧「刷新队列」后重试）
        </div>
      ) : failed === "missing" ? (
        <div className="rv-shot-body">图片数据缺失（记录里查不到这张图）</div>
      ) : url === null ? (
        <div className="rv-shot-body animate-pulse" aria-busy="true">
          加载中…
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onZoom(url)}
          className="rv-shot-body w-full border-0"
          aria-label={`放大${title}`}
        >
          {/* 证据是运行时 blob（object URL），next/image 的静态优化不适用。 */}
          {/*
            接管解码失败：浏览器默认会画「图片裂开」的小图标（就是页面里那个碍事的图标），
            这里换成文字空态，界面上不再出现在破图图标。
          */}
          <img
            src={url}
            alt={title}
            onError={() => {
              setUrl(null);
              setFailed("missing");
            }}
          />
        </button>
      )}
    </figure>
  );
}
/** 证据计时/差额的紧凑写法：不足 1 分钟显示秒，否则显示一位小数分钟。 */
function formatEvidenceMinutes(minutes: number): string {
  if (Math.abs(minutes) < 1) {
    return `${Math.round(Math.abs(minutes) * 60)} 秒`;
  }
  return `${minutes.toFixed(1)} 分`;
}

/** 等待时长（原型左栏用 `1h12m` 这种紧凑写法）。 */
function formatWait(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "待补";
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "待补";
  const minutes = Math.max(0, Math.floor((now - parsed) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h${rest}m`;
}

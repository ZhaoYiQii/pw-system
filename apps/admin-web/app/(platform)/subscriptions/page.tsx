"use client";

import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { CalendarClock, ChevronDown, Search, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ApiError, apiFetch } from "../../_lib/api";
import { PlatformShell } from "../../_lib/platform-shell";

interface SubscriptionRow {
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  tenantStatus: string;
  subscriptionId: string | null;
  packageCode: string | null;
  packageName: string | null;
  subscriptionStatus: string | null;
  startsAt: string | null;
  endsAt: string | null;
  orderCount: number;
  storageBytes: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function formatStorage(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function statusMeta(row: SubscriptionRow): {
  text: string;
  cls: string;
  kind: string;
} {
  if (!row.subscriptionStatus || row.subscriptionStatus === "NONE")
    return { text: "无订阅", cls: "pw-off", kind: "attention" };
  if (row.subscriptionStatus !== "ACTIVE")
    return { text: row.subscriptionStatus, cls: "pw-off", kind: "attention" };
  if (!row.endsAt) return { text: "正常", cls: "pw-ok", kind: "active" };
  const days = Math.ceil(
    (new Date(row.endsAt).getTime() - Date.now()) / DAY_MS,
  );
  if (days < 0) return { text: "已到期", cls: "pw-off", kind: "attention" };
  if (days <= 7)
    return { text: `${days} 天到期`, cls: "pw-warn", kind: "attention" };
  return { text: "正常", cls: "pw-ok", kind: "active" };
}

function Inner() {
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("all");
  const [renewing, setRenewing] = useState<SubscriptionRow | null>(null);
  const [period, setPeriod] = useState("12");
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const subscriptionsQuery = useQuery({
    queryKey: ["platform-subscriptions"],
    queryFn: () =>
      apiFetch<SubscriptionRow[]>("/api/v1/platform/subscriptions"),
  });
  const renewMutation = useMutation({
    mutationFn: ({
      subscriptionId,
      months,
      noteText,
    }: {
      subscriptionId: string;
      months: string;
      noteText: string;
    }) =>
      apiFetch<{ subscriptionId: string; endsAt: string }>(
        `/api/v1/platform/subscriptions/${subscriptionId}/renew`,
        {
          method: "POST",
          body: JSON.stringify({
            months: Number(months),
            ...(noteText.trim() ? { note: noteText.trim() } : {}),
          }),
        },
      ),
    onSuccess: (_result, vars) => {
      setNotice(
        `${renewing?.tenantName ?? "门店"}已续费 ${vars.months} 个月，周期已延长。`,
      );
      setRenewing(null);
      setNote("");
      void queryClient.invalidateQueries({
        queryKey: ["platform-subscriptions"],
      });
    },
    onError: (error) =>
      setNotice(
        `续费失败：${error instanceof Error ? error.message : String(error)}`,
      ),
  });
  const rows = subscriptionsQuery.data ?? [];
  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        const matchesKeyword =
          `${row.tenantName} ${row.tenantCode} ${row.packageName ?? ""}`
            .toLowerCase()
            .includes(keyword.trim().toLowerCase());
        const matchesStatus =
          status === "all" || statusMeta(row).kind === status;
        return matchesKeyword && matchesStatus;
      }),
    [keyword, rows, status],
  );
  const attentionCount = rows.filter(
    (row) => statusMeta(row).kind === "attention",
  ).length;
  const activeCount = rows.length - attentionCount;
  const is401 =
    subscriptionsQuery.error instanceof ApiError &&
    subscriptionsQuery.error.status === 401;

  return (
    <PlatformShell>
      {is401 ? (
        <LoginPrompt />
      ) : (
        <>
          <div className="pw-page-head">
            <div>
              <div className="pw-eyebrow">Platform / Subscriptions</div>
              <h1>订阅与用量</h1>
              <p>统一查看门店套餐周期、使用量与续费状态。</p>
            </div>
            <button
              type="button"
              className="pw-btn"
              onClick={() => setStatus("attention")}
            >
              <CalendarClock size={15} /> 查看待处理
            </button>
          </div>

          {notice ? (
            <div className="pw-notice pw-notice-success" aria-live="polite">
              {notice}
            </div>
          ) : null}

          <div className="pw-metrics pw-metrics-3">
            <div className="pw-metric">
              <small>全部订阅</small>
              <b>{rows.length}</b>
              <span>当前纳管门店</span>
            </div>
            <div className="pw-metric">
              <small>正常服务</small>
              <b>{activeCount}</b>
              <span>订阅周期内</span>
            </div>
            <div className="pw-metric">
              <small>待处理</small>
              <b>{attentionCount}</b>
              <span>即将到期 / 未订阅</span>
            </div>
          </div>

          <div className="pw-panel">
            <div className="pw-toolbar">
              <label className="pw-search">
                <Search size={15} aria-hidden />
                <input
                  name="subscription-search"
                  autoComplete="off"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="搜索门店、Code 或套餐…"
                />
              </label>
              <label className="pw-select-wrap">
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                  aria-label="订阅状态"
                >
                  <option value="all">全部状态</option>
                  <option value="active">正常服务</option>
                  <option value="attention">待处理</option>
                </select>
                <ChevronDown size={14} />
              </label>
              <span className="pw-toolbar-count">共 {filtered.length} 条</span>
            </div>
            <div className="pw-table-wrap">
              {subscriptionsQuery.isPending ? (
                <div className="pw-empty">加载订阅数据…</div>
              ) : null}
              {!subscriptionsQuery.isPending && filtered.length === 0 ? (
                <div className="pw-empty">没有符合条件的订阅。</div>
              ) : null}
              {filtered.length > 0 ? (
                <table>
                  <thead>
                    <tr>
                      <th>门店</th>
                      <th>套餐</th>
                      <th>周期</th>
                      <th>订单量</th>
                      <th>存储</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => {
                      const meta = statusMeta(row);
                      return (
                        <tr key={row.tenantId}>
                          <td>
                            <b>{row.tenantName}</b>
                            <span className="pw-cell-sub pw-mono">
                              {row.tenantCode}
                            </span>
                          </td>
                          <td>{row.packageName ?? "—"}</td>
                          <td className="pw-mono">
                            <span>{formatDate(row.startsAt)}</span>
                            <span className="pw-cell-sub">
                              至 {formatDate(row.endsAt)}
                            </span>
                          </td>
                          <td className="pw-mono">
                            {row.orderCount.toLocaleString("zh-CN")}
                          </td>
                          <td className="pw-mono">
                            {formatStorage(row.storageBytes)}
                          </td>
                          <td>
                            <span className={`pw-status ${meta.cls}`}>
                              {meta.text}
                            </span>
                          </td>
                          <td>
                            {row.subscriptionStatus === "ACTIVE" &&
                            row.subscriptionId ? (
                              <button
                                type="button"
                                className="pw-btn pw-small"
                                onClick={() => {
                                  setPeriod("12");
                                  setNote("");
                                  setRenewing(row);
                                }}
                              >
                                续费
                              </button>
                            ) : (
                              <Link
                                className="pw-btn pw-small"
                                href={`/packages?tenantId=${encodeURIComponent(
                                  row.tenantId,
                                )}`}
                              >
                                去配置套餐
                              </Link>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : null}
            </div>
          </div>

          {renewing ? (
            <div
              className="pw-drawer-layer"
              role="dialog"
              aria-modal="true"
              aria-labelledby="renew-title"
            >
              <button
                type="button"
                className="pw-drawer-backdrop"
                aria-label="关闭续费面板"
                onClick={() => setRenewing(null)}
              />
              <section className="pw-drawer">
                <div className="pw-drawer-head">
                  <div>
                    <span className="pw-eyebrow">Renew Subscription</span>
                    <h2 id="renew-title">订阅续费</h2>
                  </div>
                  <button
                    type="button"
                    className="pw-icon-btn"
                    onClick={() => setRenewing(null)}
                    aria-label="关闭"
                  >
                    <X size={17} />
                  </button>
                </div>
                <div className="pw-drawer-body">
                  <div className="pw-summary-card">
                    <small>续费门店</small>
                    <b>{renewing.tenantName}</b>
                    <span>
                      {renewing.tenantCode} ·{" "}
                      {renewing.packageName ?? "未选择套餐"}
                    </span>
                  </div>
                  <div className="pw-field">
                    <label htmlFor="renew-period">续费周期</label>
                    <select
                      id="renew-period"
                      name="renew-period"
                      value={period}
                      onChange={(event) => setPeriod(event.target.value)}
                    >
                      <option value="1">1 个月</option>
                      <option value="3">3 个月</option>
                      <option value="6">6 个月</option>
                      <option value="12">12 个月</option>
                    </select>
                  </div>
                  <div className="pw-field">
                    <label htmlFor="renew-note">内部备注</label>
                    <textarea
                      id="renew-note"
                      name="renew-note"
                      autoComplete="off"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="例如：线下已确认年付…"
                    />
                  </div>
                  <div className="pw-notice">
                    提交后按当前套餐从到期日顺延所选周期，并写入门店审计。
                  </div>
                </div>
                <div className="pw-drawer-foot">
                  <button
                    type="button"
                    className="pw-btn"
                    onClick={() => setRenewing(null)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="pw-btn pw-primary"
                    disabled={
                      renewMutation.isPending || !renewing.subscriptionId
                    }
                    onClick={() =>
                      renewMutation.mutate({
                        subscriptionId: renewing.subscriptionId as string,
                        months: period,
                        noteText: note,
                      })
                    }
                  >
                    {renewMutation.isPending ? "续费中…" : "确认续费"}
                  </button>
                </div>
              </section>
            </div>
          ) : null}
        </>
      )}
    </PlatformShell>
  );
}

function LoginPrompt() {
  return (
    <div className="pw-panel pw-auth-card">
      <div className="pw-panel-body">
        <h2>尚未登录平台账号</h2>
        <p>登录后查看订阅与用量。</p>
        <Link className="pw-btn pw-primary" href="/login">
          去登录
        </Link>
      </div>
    </div>
  );
}

export default function PlatformSubscriptionsPage() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <Inner />
    </QueryClientProvider>
  );
}

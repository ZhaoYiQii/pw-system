"use client";

import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { ApiError, apiFetch } from "../../_lib/api";
import { PlatformShell } from "../../_lib/platform-shell";

interface OverviewData {
  tenants: {
    total: number;
    active: number;
    configError: number;
    inactive: number;
    monthNew: number;
  };
  expiringSoon: number;
  health: {
    outboxPending: number;
    outboxFailed: number;
    storageBytes: number | null;
  };
}

interface SubscriptionRow {
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  tenantStatus: string;
  subscriptionId: string | null;
  packageName: string | null;
  subscriptionStatus: string | null;
  endsAt: string | null;
  orderCount: number;
  storageBytes: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function formatStorage(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes >= 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / DAY_MS);
}

function Inner() {
  const overviewQuery = useQuery({
    queryKey: ["platform-overview"],
    queryFn: () => apiFetch<OverviewData>("/api/v1/platform/overview"),
  });
  const subscriptionsQuery = useQuery({
    queryKey: ["platform-overview-subscriptions"],
    queryFn: () => apiFetch<SubscriptionRow[]>("/api/v1/platform/subscriptions"),
  });

  const overview = overviewQuery.data;
  const rows = subscriptionsQuery.data ?? [];
  const attention = rows.filter((row) => {
    if (row.tenantStatus !== "ACTIVE") return true;
    if (!row.endsAt || row.subscriptionStatus !== "ACTIVE") return false;
    const days = daysUntil(row.endsAt);
    return days >= 0 && days <= 7;
  });
  const is401 =
    overviewQuery.error instanceof ApiError &&
    overviewQuery.error.status === 401;

  return (
    <PlatformShell>
      {is401 ? (
        <div className="pw-panel" style={{ maxWidth: 520, margin: "60px auto" }}>
          <div className="pw-panel-body">
            <h2 style={{ margin: "0 0 8px" }}>尚未登录平台账号</h2>
            <Link className="pw-btn pw-primary" href="/login" style={{ marginTop: 12 }}>
              去登录
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="pw-page-head">
            <div>
              <div className="pw-eyebrow">Platform / Overview</div>
              <h1>平台总览</h1>
              <p>门店健康、订阅到期与今日待办。</p>
            </div>
            <Link className="pw-btn pw-primary" href="/onboard">
              ＋ 一键开店
            </Link>
          </div>

          <div className="pw-metrics">
            <div className="pw-metric">
              <small>门店总数</small>
              <b>{overview?.tenants.total ?? "…"}</b>
            </div>
            <div className="pw-metric">
              <small>营业中</small>
              <b>{overview?.tenants.active ?? "…"}</b>
            </div>
            <div className="pw-metric">
              <small>本月新增</small>
              <b>{overview?.tenants.monthNew ?? "…"}</b>
            </div>
            <div className="pw-metric">
              <small>待续费</small>
              <b>{overview?.expiringSoon ?? "…"}</b>
            </div>
          </div>

          <div className="pw-grid-2">
            <div className="pw-panel">
              <div className="pw-panel-head">
                <h2>需要关注</h2>
                <p>近 7 天</p>
              </div>
              <div className="pw-panel-body" style={{ padding: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>门店</th>
                      <th>事项</th>
                      <th>影响</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attention.length > 0 ? (
                      attention.map((row) => {
                        const days = row.endsAt ? daysUntil(row.endsAt) : null;
                        const reason =
                          row.tenantStatus !== "ACTIVE"
                            ? row.tenantStatus === "INACTIVE"
                              ? "门店已停用"
                              : "门店配置错误"
                            : days !== null
                              ? `订阅 ${days} 天后到期`
                              : "订阅状态异常";
                        return (
                          <tr key={row.tenantId}>
                            <td>
                              <b>{row.tenantName}</b>
                            </td>
                            <td>{reason}</td>
                            <td>增值功能可能受影响</td>
                            <td>
                              <Link
                                className="pw-btn pw-small"
                                href={`/packages?tenantId=${encodeURIComponent(
                                  row.tenantId,
                                )}`}
                              >
                                查看
                              </Link>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <></>
                    )}
                  </tbody>
                </table>
                {attention.length === 0 ? (
                  <div className="pw-empty">当前没有需要处理的门店状态。</div>
                ) : null}
              </div>
            </div>

            <div className="pw-panel">
              <div className="pw-panel-head">
                <h2>平台健康</h2>
              </div>
              <div className="pw-panel-body">
                <div className="pw-addon-row">
                  <span>API / Worker</span>
                  <span className="pw-status pw-ok">正常</span>
                </div>
                <div className="pw-addon-row">
                  <span>Outbox 积压</span>
                  <span
                    className={`pw-status ${
                      (overview?.health.outboxPending ?? 0) > 0 ? "pw-warn" : "pw-ok"
                    }`}
                  >
                    {overview?.health.outboxPending ?? "…"}
                  </span>
                </div>
                <div className="pw-addon-row">
                  <span>通知失败</span>
                  <span
                    className={`pw-status ${
                      (overview?.health.outboxFailed ?? 0) > 0 ? "pw-warn" : "pw-ok"
                    }`}
                  >
                    {overview?.health.outboxFailed ?? "…"}
                  </span>
                </div>
                <div className="pw-addon-row">
                  <span>存储用量</span>
                  <span className="pw-mono">
                    {overview ? formatStorage(overview.health.storageBytes) : "…"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </PlatformShell>
  );
}

export default function PlatformOverviewPage() {
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

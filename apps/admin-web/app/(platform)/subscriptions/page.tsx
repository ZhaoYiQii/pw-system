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

interface SubscriptionRow {
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  tenantStatus: string;
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
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
  }).format(new Date(iso));
}

function formatStorage(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes >= 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function statusMeta(row: SubscriptionRow): {
  text: string;
  cls: string;
} {
  if (!row.subscriptionStatus || row.subscriptionStatus === "NONE") {
    return { text: "无订阅", cls: "pw-off" };
  }
  if (row.subscriptionStatus !== "ACTIVE") {
    return { text: row.subscriptionStatus, cls: "pw-off" };
  }
  if (!row.endsAt) return { text: "正常", cls: "pw-ok" };
  const days = Math.ceil((new Date(row.endsAt).getTime() - Date.now()) / DAY_MS);
  if (days < 0) return { text: "已到期", cls: "pw-off" };
  if (days <= 7) return { text: `${days} 天到期`, cls: "pw-warn" };
  return { text: "正常", cls: "pw-ok" };
}

function Inner() {
  const subscriptionsQuery = useQuery({
    queryKey: ["platform-subscriptions"],
    queryFn: () => apiFetch<SubscriptionRow[]>("/api/v1/platform/subscriptions"),
  });
  const rows = subscriptionsQuery.data ?? [];
  const is401 =
    subscriptionsQuery.error instanceof ApiError &&
    subscriptionsQuery.error.status === 401;

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
              <div className="pw-eyebrow">Platform / Subscriptions</div>
              <h1>订阅与用量</h1>
              <p>到期管理、用量与订阅状态。</p>
            </div>
          </div>
          <div className="pw-panel">
            <div className="pw-panel-head">
              <h2>订阅列表</h2>
              <p>{rows.length} 家门店</p>
            </div>
            <div className="pw-panel-body" style={{ padding: 0 }}>
              {subscriptionsQuery.isPending ? (
                <div className="pw-empty">加载订阅数据…</div>
              ) : null}
              {rows.length > 0 ? (
                <table>
                  <thead>
                    <tr>
                      <th>门店</th>
                      <th>套餐</th>
                      <th>到期时间</th>
                      <th>订单量</th>
                      <th>存储</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const meta = statusMeta(row);
                      return (
                        <tr key={row.tenantId}>
                          <td>
                            <b>{row.tenantName}</b>
                            <span className="pw-mono" style={{ marginLeft: 6, color: "var(--pw-muted)" }}>
                              {row.tenantCode}
                            </span>
                          </td>
                          <td>{row.packageName ?? "—"}</td>
                          <td className="pw-mono">{formatDate(row.endsAt)}</td>
                          <td className="pw-mono">{row.orderCount}</td>
                          <td className="pw-mono">{formatStorage(row.storageBytes)}</td>
                          <td>
                            <span className={`pw-status ${meta.cls}`}>{meta.text}</span>
                          </td>
                          <td>
                            <button type="button" className="pw-btn pw-small" disabled>
                              续费
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : null}
            </div>
          </div>
        </>
      )}
    </PlatformShell>
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

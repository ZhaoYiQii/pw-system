"use client";

import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { ApiError, apiFetch } from "../../../_lib/api";
import { PlatformShell } from "../../../_lib/platform-shell";

interface Tenant {
  id: string;
  code: string;
  name: string;
}

interface AuditRow {
  id: string;
  tenantId: string;
  actorType: string | null;
  actorId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  summary: string | null;
  createdAt: string;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function Inner() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [submittedReason, setSubmittedReason] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const tenantsQuery = useQuery({
    queryKey: ["platform-audit-tenants"],
    queryFn: () => apiFetch<Tenant[]>("/api/v1/platform/tenants"),
  });

  const auditQuery = useQuery({
    queryKey: ["platform-audit", tenantId, submittedReason],
    queryFn: () =>
      apiFetch<AuditRow[]>(
        `/api/v1/platform/tenants/${tenantId}/audit?reason=${encodeURIComponent(
          submittedReason ?? "",
        )}&limit=50`,
      ),
    enabled: tenantId !== null && submittedReason !== null,
  });

  const tenants = tenantsQuery.data ?? [];
  const rows = auditQuery.data ?? [];
  const is401 =
    tenantsQuery.error instanceof ApiError &&
    tenantsQuery.error.status === 401;

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
              <div className="pw-eyebrow">Platform / Audit</div>
              <h1>审计与访问</h1>
              <p>
                平台跨租户只读审计必须填写访问原因（写入审计）。{" "}
                <span className="pw-pending" style={{ marginLeft: 4 }}>
                  平台级汇总审计接口待补
                </span>
              </p>
            </div>
          </div>

          <div className="pw-panel">
            <div className="pw-panel-head">
              <h2>查看指定门店审计</h2>
              <p>每查看一次都会记录一条访问审计</p>
            </div>
            <div className="pw-panel-body">
              <div className="pw-store-pick">
                <span style={{ fontSize: 12, color: "var(--pw-muted)" }}>
                  门店
                </span>
                <select
                  value={tenantId ?? ""}
                  onChange={(event) => {
                    setTenantId(event.target.value || null);
                    setSubmittedReason(null);
                  }}
                  aria-label="选择门店"
                >
                  {tenants.map((tenant) => (
                    <option key={tenant.id} value={tenant.id}>
                      {tenant.name}（{tenant.code}）
                    </option>
                  ))}
                </select>
              </div>
              <div className="pw-field pw-full">
                <label htmlFor="audit-reason">访问原因（必填，≥4 字符）</label>
                <textarea
                  id="audit-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="例如：处理门店 A 的结算客诉"
                />
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <button
                  type="button"
                  className="pw-btn pw-primary"
                  disabled={!tenantId || reason.trim().length < 4}
                  onClick={() => {
                    setMessage(null);
                    setSubmittedReason(reason.trim());
                  }}
                >
                  查看审计
                </button>
                <button
                  type="button"
                  className="pw-btn"
                  onClick={() => {
                    setReason("");
                    setSubmittedReason(null);
                    setMessage(null);
                  }}
                >
                  重置
                </button>
              </div>
              {message ? (
                <div className="pw-notice" style={{ color: "var(--pw-red)" }}>
                  {message}
                </div>
              ) : null}
            </div>
          </div>

          <div className="pw-panel">
            <div className="pw-panel-head">
              <h2>审计记录</h2>
              <p>{submittedReason ? "最近 50 条" : "请先选择门店并填写原因"}</p>
            </div>
            <div className="pw-panel-body" style={{ padding: 0 }}>
              {auditQuery.isPending ? (
                <div className="pw-empty">读取审计中…</div>
              ) : null}
              {!auditQuery.isPending && submittedReason && rows.length === 0 ? (
                <div className="pw-empty">该门店暂无审计记录。</div>
              ) : null}
              {rows.length > 0 ? (
                <table>
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>操作者</th>
                      <th>操作</th>
                      <th>资源</th>
                      <th>摘要</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td className="pw-mono">{formatDateTime(row.createdAt)}</td>
                        <td>
                          {row.actorType === "platform_account"
                            ? row.actorId
                            : (row.actorType ?? "—")}
                        </td>
                        <td className="pw-mono">{row.action}</td>
                        <td className="pw-mono">
                          {row.resourceType ?? "—"} / {row.resourceId ?? "—"}
                        </td>
                        <td style={{ color: "var(--pw-muted)" }}>
                          {row.summary ?? "—"}
                        </td>
                      </tr>
                    ))}
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

export default function PlatformAuditPage() {
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

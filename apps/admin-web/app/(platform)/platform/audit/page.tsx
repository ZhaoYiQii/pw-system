"use client";

import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import Link from "next/link";
import { Download, Filter, Search, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { ApiError, apiFetch } from "../../../_lib/api";
import { PlatformShell } from "../../../_lib/platform-shell";

interface Principal {
  sub: string;
  scope: string;
  role: string;
  username: string;
}

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

interface PlatformAuditRow {
  id: string;
  source: "platform" | "tenant";
  createdAt: string;
  actorId: string | null;
  actorName: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  tenantId: string | null;
  tenantName: string | null;
  summary: string | null;
}

interface PlatformAuditData {
  rows: PlatformAuditRow[];
  metrics: {
    todayPlatformEvents: number;
    todayCrossTenantReads: number;
    activeGrants: number;
  };
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
  const [auditKeyword, setAuditKeyword] = useState("");
  const [eventType, setEventType] = useState("all");

  const meQuery = useQuery({
    queryKey: ["platform-audit-me"],
    queryFn: () => apiFetch<Principal>("/api/v1/platform/me"),
  });
  const tenantsQuery = useQuery({
    queryKey: ["platform-audit-tenants"],
    queryFn: () => apiFetch<Tenant[]>("/api/v1/platform/tenants"),
  });
  const summaryQuery = useQuery({
    queryKey: ["platform-audit-summary"],
    queryFn: () =>
      apiFetch<PlatformAuditData>("/api/v1/platform/audit?limit=200"),
    enabled: meQuery.data?.role === "PLATFORM_SUPER_ADMIN",
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
    retry: false,
  });

  const role = meQuery.data?.role;
  const isSupport = role === "PLATFORM_SUPPORT";
  const tenants = tenantsQuery.data ?? [];
  const rows = auditQuery.data ?? [];
  const summaryRows = summaryQuery.data?.rows ?? [];
  const metrics = summaryQuery.data?.metrics;
  const is401 =
    meQuery.error instanceof ApiError && meQuery.error.status === 401;

  const filteredSummaryRows = useMemo(() => {
    const keyword = auditKeyword.trim().toLowerCase();
    return summaryRows.filter((row) => {
      const matchesKeyword =
        `${row.actorName} ${row.action} ${row.summary ?? ""} ${
          row.tenantName ?? "平台"
        }`
          .toLowerCase()
          .includes(keyword);
      const group =
        row.source === "platform"
          ? row.action.startsWith("access-grant")
            ? "grant"
            : row.action.startsWith("platform.account")
              ? "account"
              : row.action.startsWith("subscription")
                ? "billing"
                : "other"
          : row.action.includes("finance")
            ? "billing"
            : "tenant";
      const matchesType =
        eventType === "all" ||
        (eventType === "account" &&
          (group === "account" || group === "grant")) ||
        (eventType === "billing" && group === "billing") ||
        (eventType === "tenant" && group === "tenant");
      return matchesKeyword && matchesType;
    });
  }, [auditKeyword, eventType, summaryRows]);

  const exportCsv = () => {
    if (filteredSummaryRows.length === 0) {
      setMessage("当前没有可导出的审计记录。");
      return;
    }
    const header = ["时间", "操作者", "事件", "作用范围", "来源", "摘要"];
    const lines = filteredSummaryRows.map((row) => [
      formatDateTime(row.createdAt),
      row.actorName,
      row.action,
      row.tenantName ?? "平台",
      row.source === "platform" ? "平台事件" : "门店事件",
      (row.summary ?? "").replace(/\s+/g, " "),
    ]);
    const csv = [header, ...lines]
      .map((line) =>
        line.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","),
      )
      .join("\r\n");
    const blob = new Blob([`\uFEFF${csv}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `平台审计-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage(`已导出 ${filteredSummaryRows.length} 条审计记录。`);
  };

  const auditError =
    auditQuery.error instanceof ApiError
      ? auditQuery.error.message
      : auditQuery.error
        ? String(auditQuery.error)
        : null;

  return (
    <PlatformShell>
      {is401 ? (
        <div
          className="pw-panel"
          style={{ maxWidth: 520, margin: "60px auto" }}
        >
          <div className="pw-panel-body">
            <h2 style={{ margin: "0 0 8px" }}>尚未登录平台账号</h2>
            <Link
              className="pw-btn pw-primary"
              href="/login"
              style={{ marginTop: 12 }}
            >
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
              <p>聚合查看平台关键操作；跨租户详情访问必须填写原因并留痕。</p>
            </div>
            {!isSupport ? (
              <button
                type="button"
                className="pw-btn"
                disabled={summaryQuery.isPending}
                onClick={exportCsv}
              >
                <Download size={15} /> 导出审计
              </button>
            ) : null}
          </div>

          {message ? (
            <div className="pw-notice pw-notice-success" aria-live="polite">
              {message}
            </div>
          ) : null}

          {isSupport ? (
            <div className="pw-notice">
              <ShieldAlert size={14} />{" "}
              平台运营需要由超级管理员在“平台账号与授权”页授予目标门店的限时临时授权后，才能查看指定门店审计；每次查看都会记录访问原因。
            </div>
          ) : null}

          {!isSupport ? (
            <>
              <div className="pw-metrics pw-metrics-3">
                <div className="pw-metric">
                  <small>今日平台操作</small>
                  <b>
                    {summaryQuery.isPending
                      ? "…"
                      : (metrics?.todayPlatformEvents ?? 0)}
                  </b>
                  <span>账号、费率、订阅、授权</span>
                </div>
                <div className="pw-metric">
                  <small>今日跨租户访问</small>
                  <b>
                    {summaryQuery.isPending
                      ? "…"
                      : (metrics?.todayCrossTenantReads ?? 0)}
                  </b>
                  <span>均已填写访问原因</span>
                </div>
                <div className="pw-metric">
                  <small>生效中临时授权</small>
                  <b>
                    {summaryQuery.isPending
                      ? "…"
                      : (metrics?.activeGrants ?? 0)}
                  </b>
                  <span>含未过期未撤销授权</span>
                </div>
              </div>

              <div className="pw-panel">
                <div className="pw-panel-head">
                  <div>
                    <h2>平台级审计汇总</h2>
                    <span className="pw-panel-kicker">
                      平台账号事件与平台跨租户读取事件
                    </span>
                  </div>
                  <span className="pw-pending">实时接口</span>
                </div>
                <div className="pw-toolbar">
                  <label className="pw-search">
                    <Search size={15} aria-hidden />
                    <input
                      name="audit-search"
                      autoComplete="off"
                      value={auditKeyword}
                      onChange={(event) => setAuditKeyword(event.target.value)}
                      placeholder="搜索操作者、事件或摘要…"
                    />
                  </label>
                  <label className="pw-select-wrap">
                    <Filter size={14} />
                    <select
                      value={eventType}
                      onChange={(event) => setEventType(event.target.value)}
                      aria-label="事件类型"
                    >
                      <option value="all">全部事件</option>
                      <option value="account">账号与授权</option>
                      <option value="billing">订阅与费率</option>
                      <option value="tenant">门店访问</option>
                    </select>
                  </label>
                  <span className="pw-toolbar-count">
                    共 {filteredSummaryRows.length} 条
                  </span>
                </div>
                <div className="pw-table-wrap">
                  {summaryQuery.isPending ? (
                    <div className="pw-empty">加载平台审计…</div>
                  ) : null}
                  {!summaryQuery.isPending &&
                  filteredSummaryRows.length === 0 ? (
                    <div className="pw-empty">暂无可显示的审计记录。</div>
                  ) : null}
                  {filteredSummaryRows.length > 0 ? (
                    <table>
                      <thead>
                        <tr>
                          <th>时间</th>
                          <th>操作者</th>
                          <th>事件</th>
                          <th>作用范围</th>
                          <th>摘要</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredSummaryRows.map((row) => (
                          <tr key={row.id}>
                            <td className="pw-mono">
                              {formatDateTime(row.createdAt)}
                            </td>
                            <td>{row.actorName}</td>
                            <td className="pw-mono">{row.action}</td>
                            <td>{row.tenantName ?? "平台"}</td>
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
          ) : null}

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
                  <option value="">请选择门店</option>
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
              <div className="pw-notice">
                <ShieldAlert size={14} />{" "}
                每次查询都会记录操作者、目标门店、原因与时间；运营账号需有该门店的生效临时授权。
              </div>
              {auditError && submittedReason ? (
                <div className="pw-notice pw-notice-error" aria-live="polite">
                  {auditError}
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
              {!auditQuery.isPending &&
              submittedReason &&
              !auditError &&
              rows.length === 0 ? (
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
                        <td className="pw-mono">
                          {formatDateTime(row.createdAt)}
                        </td>
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

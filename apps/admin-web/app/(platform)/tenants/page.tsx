"use client";

import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { ApiError, apiFetch } from "../../_lib/api";
import { PlatformShell } from "../../_lib/platform-shell";

type TenantStatus = "ACTIVE" | "INACTIVE" | "CONFIG_ERROR";

interface TenantRow {
  id: string;
  code: string;
  name: string;
  status: TenantStatus;
  timezone: string;
  createdAt: string;
  primaryHost?: string | null;
}

const STATUS_TEXT: Record<TenantStatus, string> = {
  ACTIVE: "营业中",
  INACTIVE: "已停用",
  CONFIG_ERROR: "配置错误",
};

const STATUS_CLASS: Record<TenantStatus, string> = {
  ACTIVE: "pw-ok",
  INACTIVE: "",
  CONFIG_ERROR: "pw-off",
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function hostHref(host: string): string {
  return /^https?:\/\//i.test(host) ? host : `https://${host}`;
}

function Inner() {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const tenantsQuery = useQuery({
    queryKey: ["platform-tenants"],
    queryFn: () => apiFetch<TenantRow[]>("/api/v1/platform/tenants"),
  });

  const deactivate = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiFetch<TenantRow>(`/api/v1/platform/tenants/${id}/deactivate`, {
        method: "POST",
      }),
    onSuccess: () => {
      setNotice("门店已停用。");
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: ["platform-tenants"] });
    },
    onError: (error) =>
      setFormError(error instanceof Error ? error.message : String(error)),
  });

  const activate = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiFetch<{ id: string; status: string }>(
        `/api/v1/platform/tenants/${id}/activate`,
        { method: "POST" },
      ),
    onSuccess: () => {
      setNotice("门店已启用。");
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: ["platform-tenants"] });
    },
    onError: (error) =>
      setFormError(error instanceof Error ? error.message : String(error)),
  });

  const tenants = tenantsQuery.data ?? [];
  const busy = deactivate.isPending || activate.isPending;
  const is401 =
    tenantsQuery.error instanceof ApiError &&
    tenantsQuery.error.status === 401;

  return (
    <PlatformShell>
      {is401 ? (
        <div className="pw-panel" style={{ maxWidth: 520, margin: "60px auto" }}>
          <div className="pw-panel-body">
            <h2 style={{ margin: "0 0 8px" }}>尚未登录平台账号</h2>
            <p style={{ color: "var(--pw-muted)", fontSize: 12 }}>
              请先以平台管理员身份登录后再查看门店。
            </p>
            <Link className="pw-btn pw-primary" href="/login" style={{ marginTop: 14 }}>
              去登录
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="pw-page-head">
            <div>
              <div className="pw-eyebrow">Platform / Tenants</div>
              <h1>门店管理</h1>
              <p>查看门店状态与主域名，停用 / 启用门店，或进入门店详情。</p>
            </div>
            <Link className="pw-btn pw-primary" href="/onboard">
              ＋ 一键开店
            </Link>
          </div>

          {notice ? (
            <div
              className="pw-notice"
              style={{ background: "var(--pw-green-soft)", color: "var(--pw-green)" }}
            >
              {notice}
            </div>
          ) : null}
          {formError ? (
            <div
              className="pw-notice"
              style={{ background: "var(--pw-red-soft)", color: "var(--pw-red)" }}
            >
              {formError}
            </div>
          ) : null}

          <div className="pw-panel">
            <div className="pw-panel-head">
              <h2>门店列表</h2>
              <p>{tenants.length} 家</p>
            </div>
            <div className="pw-panel-body" style={{ padding: 0 }}>
              {tenantsQuery.isPending ? (
                <div className="pw-empty">加载中…</div>
              ) : null}
              {!tenantsQuery.isPending && tenants.length === 0 ? (
                <div className="pw-empty">
                  暂无门店，请先一键开店。
                </div>
              ) : null}
              {tenants.length > 0 ? (
                <table>
                  <thead>
                    <tr>
                      <th>门店</th>
                      <th>Code</th>
                      <th>状态</th>
                      <th>主域名</th>
                      <th>时区</th>
                      <th>创建时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tenants.map((tenant) => (
                      <tr key={tenant.id}>
                        <td>
                          <b>{tenant.name}</b>
                        </td>
                        <td className="pw-mono">{tenant.code}</td>
                        <td>
                          <span
                            className={`pw-status ${
                              STATUS_CLASS[tenant.status] ?? ""
                            }`}
                          >
                            {STATUS_TEXT[tenant.status] ?? tenant.status}
                          </span>
                        </td>
                        <td>
                          {tenant.primaryHost ? (
                            <a
                              href={hostHref(tenant.primaryHost)}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                color: "var(--pw-blue)",
                                textDecoration: "none",
                              }}
                            >
                              {tenant.primaryHost}
                            </a>
                          ) : (
                            <span style={{ color: "var(--pw-muted)" }}>—</span>
                          )}
                        </td>
                        <td>{tenant.timezone}</td>
                        <td className="pw-mono">{formatDate(tenant.createdAt)}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <Link
                            className="pw-btn pw-small"
                            href={`/tenants/${encodeURIComponent(tenant.id)}`}
                          >
                            详情
                          </Link>{" "}
                          <Link
                            className="pw-btn pw-small"
                            href={`/packages?tenantId=${encodeURIComponent(
                              tenant.id,
                            )}`}
                          >
                            增值功能
                          </Link>{" "}
                          {tenant.status === "ACTIVE" ? (
                            <button
                              type="button"
                              className="pw-btn pw-small pw-danger"
                              disabled={busy}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `确认停用门店「${tenant.name}」？停用后其 H5 前台将不可用。`,
                                  )
                                ) {
                                  setNotice(null);
                                  deactivate.mutate({ id: tenant.id });
                                }
                              }}
                            >
                              停用
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="pw-btn pw-small"
                              disabled={busy}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `确认重新启用门店「${tenant.name}」？`,
                                  )
                                ) {
                                  setNotice(null);
                                  activate.mutate({ id: tenant.id });
                                }
                              }}
                            >
                              启用
                            </button>
                          )}
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

export default function PlatformTenantsPage() {
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


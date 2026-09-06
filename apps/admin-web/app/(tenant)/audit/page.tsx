"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiFetch } from "../../_lib/api";
import { TenantNav } from "../../_lib/tenant-nav";

interface AuditRow {
  id: string;
  actorType: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  summary: string | null;
  createdAt: string;
}

type PageState =
  | { phase: "loading" }
  | { phase: "unauthenticated" }
  | { phase: "error"; message: string }
  | { phase: "ready" };

export default function AuditPage() {
  const [page, setPage] = useState<PageState>({ phase: "loading" });
  const [rows, setRows] = useState<AuditRow[]>([]);

  const load = useCallback(async () => {
    setPage({ phase: "loading" });
    try {
      setRows(await apiFetch<AuditRow[]>("/api/v1/tenant/audit?limit=100"));
      setPage({ phase: "ready" });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401)
        setPage({ phase: "unauthenticated" });
      else
        setPage({
          phase: "error",
          message: error instanceof Error ? error.message : String(error),
        });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main>
      <TenantNav />
      <div className="page">
        <h1 className="page-title">审计日志</h1>
        <p className="page-desc">门店关键操作的不可变审计记录（已脱敏）。</p>
        {page.phase === "unauthenticated" ? (
          <div className="card">
            <p>尚未登录门店账号。</p>
            <Link className="btn btn-primary" href="/store/login">
              去登录
            </Link>
          </div>
        ) : null}
        {page.phase === "ready" ? (
          <div className="card">
            {rows.length === 0 ? (
              <p className="muted">暂无审计记录。</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>动作</th>
                    <th>摘要</th>
                    <th>操作者</th>
                    <th>资源</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="muted">
                        {new Date(r.createdAt).toLocaleString()}
                      </td>
                      <td>{r.action}</td>
                      <td>{r.summary ?? "-"}</td>
                      <td className="muted">{r.actorType ?? "-"}</td>
                      <td className="muted">
                        {r.resourceType ?? "-"}
                        {r.resourceId ? `:${r.resourceId.slice(0, 8)}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : null}
        {page.phase === "error" ? (
          <p className="banner banner-error">加载失败：{page.message}</p>
        ) : null}
      </div>
    </main>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiFetch } from "../../_lib/api";
import { TenantNav } from "../../_lib/tenant-nav";

interface NotificationRow {
  id: string;
  title: string | null;
  content: string;
  readAt: string | null;
  createdAt: string;
}

type PageState =
  | { phase: "loading" }
  | { phase: "unauthenticated" }
  | { phase: "error"; message: string }
  | { phase: "ready" };

export default function NotificationsPage() {
  const [page, setPage] = useState<PageState>({ phase: "loading" });
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPage({ phase: "loading" });
    try {
      setRows(
        await apiFetch<NotificationRow[]>("/api/v1/tenant/notifications"),
      );
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

  const markRead = async (id: string) => {
    try {
      await apiFetch<unknown>(`/api/v1/tenant/notifications/${id}/read`, {
        method: "POST",
      });
      await load();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    }
  };

  const markAll = async () => {
    try {
      const res = await apiFetch<{ updated: number }>(
        "/api/v1/tenant/notifications/read-all",
        { method: "POST" },
      );
      setMsg(`已将 ${res.updated} 条通知标记为已读。`);
      await load();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <main>
      <TenantNav />
      <div className="page">
        <h1 className="page-title">站内通知</h1>
        <p className="page-desc">订单状态事件推送；支持单项/全部标记已读。</p>
        {msg ? <p className="banner banner-success">{msg}</p> : null}
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
            <div
              className="row-actions"
              style={{ justifyContent: "space-between" }}
            >
              <h2 className="card-title" style={{ margin: 0 }}>
                通知（{rows.length}）
              </h2>
              <button className="btn" onClick={() => void markAll()}>
                全部已读
              </button>
            </div>
            {rows.length === 0 ? <p className="muted">暂无通知。</p> : null}
            {rows.map((n) => (
              <div
                key={n.id}
                className="row-actions"
                style={{
                  justifyContent: "space-between",
                  borderBottom: "1px solid var(--border)",
                  padding: "10px 0",
                  opacity: n.readAt ? 0.72 : 1,
                }}
              >
                <div>
                  <strong>{n.title ?? "系统通知"}</strong>
                  <p className="muted" style={{ margin: "4px 0" }}>
                    {n.content}
                  </p>
                  <span className="muted">
                    {new Date(n.createdAt).toLocaleString()}
                    {n.readAt ? " · 已读" : " · 未读"}
                  </span>
                </div>
                {n.readAt ? null : (
                  <button className="btn" onClick={() => void markRead(n.id)}>
                    标为已读
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : null}
        {page.phase === "error" ? (
          <p className="banner banner-error">加载失败：{page.message}</p>
        ) : null}
      </div>
    </main>
  );
}

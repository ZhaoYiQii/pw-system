"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiFetch } from "../../_lib/api";
import { TenantNav } from "../../_lib/tenant-nav";

interface DisputeRow {
  id: string;
  orderId: string;
  playerId: string;
  reason: string;
  status: "OPEN" | "RESOLVED";
  resolution: string | null;
  createdAt: string;
}

type PageState =
  | { phase: "loading" }
  | { phase: "unauthenticated" }
  | { phase: "error"; message: string }
  | { phase: "ready" };

export default function DisputesPage() {
  const [page, setPage] = useState<PageState>({ phase: "loading" });
  const [rows, setRows] = useState<DisputeRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPage({ phase: "loading" });
    try {
      setRows(await apiFetch<DisputeRow[]>("/api/v1/tenant/disputes"));
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

  const resolve = async (dispute: DisputeRow) => {
    const resolution = window.prompt(
      `处理争议（订单 ${dispute.orderId.slice(0, 8)}…）：请输入处理结论`,
      "",
    );
    if (!resolution?.trim()) return;
    try {
      await apiFetch<unknown>(`/api/v1/tenant/disputes/${dispute.id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ resolution }),
      });
      setOkMsg("争议已处理完成。");
      await load();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <main>
      <TenantNav />
      <div className="page">
        <h1 className="page-title">争议管理</h1>
        <p className="page-desc">客诉争议列表；OPEN 争议可处理为 RESOLVED。</p>
        {msg ? <p className="banner banner-error">{msg}</p> : null}
        {okMsg ? <p className="banner banner-success">{okMsg}</p> : null}
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
              <p className="muted">暂无争议。</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>订单</th>
                    <th>原因</th>
                    <th>状态</th>
                    <th>创建时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.id}>
                      <td className="muted">{d.orderId.slice(0, 8)}…</td>
                      <td>{d.reason}</td>
                      <td>
                        <span
                          className={
                            d.status === "OPEN"
                              ? "badge badge-error"
                              : "badge badge-active"
                          }
                        >
                          {d.status === "OPEN" ? "待处理" : "已处理"}
                        </span>
                      </td>
                      <td className="muted">
                        {new Date(d.createdAt).toLocaleString()}
                      </td>
                      <td>
                        {d.status === "OPEN" ? (
                          <button
                            className="btn"
                            onClick={() => void resolve(d)}
                          >
                            处理
                          </button>
                        ) : (
                          <span className="muted">{d.resolution ?? "-"}</span>
                        )}
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

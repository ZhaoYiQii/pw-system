"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiFetch } from "../../_lib/api";
import { TenantNav } from "../../_lib/tenant-nav";

interface DispatchRow {
  orderId: string;
  dispatchNo: string;
  status: string;
  durationMinutes: number;
  createdAt: string;
}

type PageState =
  | { phase: "loading" }
  | { phase: "unauthenticated" }
  | { phase: "error"; message: string }
  | { phase: "ready" };

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "草稿",
  CONFIRMED: "待发布",
  DISPATCHING: "报名/选人中",
  ASSIGNED: "已选定",
  CANCELLED: "已取消",
};

export default function GameDispatchPage() {
  const [page, setPage] = useState<PageState>({ phase: "loading" });
  const [rows, setRows] = useState<DispatchRow[]>([]);

  const load = useCallback(async () => {
    setPage({ phase: "loading" });
    try {
      const list = await apiFetch<DispatchRow[]>(
        "/api/v1/tenant/game-dispatch",
      );
      setRows(list);
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
        <h1 className="page-title">派单管理</h1>
        <p className="page-desc">
          查看已创建的游戏派单，进入详情后复制群文案、刷新报名或确认陪玩。
        </p>
        {page.phase === "unauthenticated" ? (
          <div className="card">
            <p>尚未登录门店账号。</p>
            <Link className="btn btn-primary" href="/store/login">
              去登录
            </Link>
          </div>
        ) : null}
        {page.phase === "error" ? (
          <p className="banner banner-error">加载失败：{page.message}</p>
        ) : null}
        {page.phase === "ready" ? (
          <div className="card">
            {rows.length === 0 ? (
              <p className="muted">
                暂无派单。先通过老板下单表单生成草稿后即可在这里发布。
              </p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>派单编号</th>
                    <th>状态</th>
                    <th>时长</th>
                    <th>创建时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.orderId}>
                      <td>{row.dispatchNo}</td>
                      <td>
                        <span className="badge badge-active">
                          {STATUS_LABEL[row.status] ?? row.status}
                        </span>
                      </td>
                      <td>{row.durationMinutes} 分钟</td>
                      <td>{new Date(row.createdAt).toLocaleString()}</td>
                      <td>
                        <Link
                          className="btn"
                          href={`/game-dispatch/${row.orderId}`}
                        >
                          详情/复制
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : null}
      </div>
    </main>
  );
}

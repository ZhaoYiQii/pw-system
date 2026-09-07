"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiFetch } from "../../../_lib/api";
import { TenantNav } from "../../../_lib/tenant-nav";

interface AppView {
  id: string;
  playerName: string;
  status: string;
  createdAt: string;
}
interface LineView {
  id: string;
  positionLabel: string;
  requiredCount: number;
  applications: AppView[];
}
interface DispatchDetail {
  dispatchNo: string;
  status: string;
  copyText: string;
  applyUrl: string;
  bossUrl: string;
  durationMinutes: number;
  lines: LineView[];
  round: { roundNo: number; closesAt: string; status: string } | null;
}

type PageState =
  | { phase: "loading" }
  | { phase: "unauthenticated" }
  | { phase: "error"; message: string }
  | { phase: "ready" };

export default function GameDispatchDetailPage() {
  const params = useParams<{ orderId: string }>();
  const [page, setPage] = useState<PageState>({ phase: "loading" });
  const [detail, setDetail] = useState<DispatchDetail | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setPage({ phase: "loading" });
    setMsg(null);
    setOkMsg(null);
    try {
      const data = await apiFetch<DispatchDetail>(
        `/api/v1/tenant/game-dispatch/orders/${params.orderId}`,
      );
      setDetail(data);
      setChecked(new Set());
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
  }, [params.orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const copyText = async () => {
    if (!detail) return;
    try {
      await navigator.clipboard.writeText(detail.copyText);
      setOkMsg("群文案已复制，可直接粘贴到陪玩群。");
    } catch {
      setMsg("复制失败，请手动选择文本复制。");
    }
  };

  const removeApp = async (id: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch<unknown>(
        `/api/v1/tenant/game-dispatch/applications/${id}`,
        {
          method: "DELETE",
        },
      );
      setOkMsg("已移除该报名。");
      await load();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const assign = async () => {
    if (checked.size === 0) {
      setMsg("请先勾选要确认的陪玩");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch<unknown>(
        `/api/v1/tenant/game-dispatch/orders/${params.orderId}/assignment`,
        {
          method: "POST",
          body: JSON.stringify({
            applicationIds: Array.from(checked),
          }),
        },
      );
      setOkMsg("已确认选中，可复制下方选定文案并 @ 对应陪玩。");
      await load();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main>
      <TenantNav />
      <div className="page">
        <h1 className="page-title">派单详情</h1>
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
        {page.phase === "error" ? (
          <p className="banner banner-error">加载失败：{page.message}</p>
        ) : null}
        {page.phase === "ready" && detail ? (
          <>
            <div className="card">
              <div className="row-actions">
                <strong>{detail.dispatchNo}</strong>
                <button className="btn" onClick={() => void load()}>
                  刷新报名
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => void copyText()}
                >
                  复制群文案
                </button>
                <Link className="btn" href="/game-dispatch">
                  返回列表
                </Link>
              </div>
              <pre className="muted" style={{ whiteSpace: "pre-wrap" }}>
                {detail.copyText}
              </pre>
              {detail.applyUrl ? (
                <p className="muted">报名链接：{detail.applyUrl}</p>
              ) : null}
              {detail.bossUrl ? (
                <p className="muted">老板选人链接：{detail.bossUrl}</p>
              ) : null}
            </div>

            {detail.lines.map((line) => (
              <div className="card" key={line.id}>
                <h2 className="card-title">
                  {line.positionLabel}（需 {line.requiredCount} 人）
                </h2>
                {line.applications.length === 0 ? (
                  <p className="muted">暂无报名。</p>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>选择</th>
                        <th>陪玩</th>
                        <th>状态</th>
                        <th>报名时间</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {line.applications.map((app) => (
                        <tr key={app.id}>
                          <td>
                            <input
                              type="checkbox"
                              checked={checked.has(app.id)}
                              disabled={
                                app.status !== "APPLIED" ||
                                busy ||
                                detail.status !== "DISPATCHING"
                              }
                              onChange={(e) => {
                                const next = new Set(checked);
                                if (e.target.checked) next.add(app.id);
                                else next.delete(app.id);
                                setChecked(next);
                              }}
                            />
                          </td>
                          <td>{app.playerName}</td>
                          <td>{app.status}</td>
                          <td>{new Date(app.createdAt).toLocaleString()}</td>
                          <td>
                            <button
                              className="btn btn-danger"
                              disabled={app.status !== "APPLIED" || busy}
                              onClick={() => void removeApp(app.id)}
                            >
                              移除报名
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
            <div className="row-actions">
              <button
                className="btn btn-primary"
                disabled={busy || detail.status !== "DISPATCHING"}
                onClick={() => void assign()}
              >
                确认选中的陪玩
              </button>
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiFetch } from "../../_lib/api";
import { TenantNav } from "../../_lib/tenant-nav";

interface TemplateRow {
  id: string;
  name: string;
  enabled: boolean;
  updatedAt: string;
}

type PageState =
  | { phase: "loading" }
  | { phase: "unauthenticated" }
  | { phase: "error"; message: string }
  | { phase: "ready" };

export default function GameTemplatesPage() {
  const router = useRouter();
  const [page, setPage] = useState<PageState>({ phase: "loading" });
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPage({ phase: "loading" });
    try {
      const list = await apiFetch<TemplateRow[]>(
        "/api/v1/tenant/game-templates",
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

  const create = async () => {
    if (!newName.trim()) {
      setMsg("请先填写模板名称");
      return;
    }
    setBusy(true);
    setMsg(null);
    setOkMsg(null);
    try {
      const created = await apiFetch<{ id: string }>(
        "/api/v1/tenant/game-templates",
        { method: "POST", body: JSON.stringify({ name: newName.trim() }) },
      );
      setNewName("");
      setOkMsg("模板已创建，请补充字段与价目。");
      router.push(`/game-templates/${created.id}`);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (id: string, name: string) => {
    setBusy(true);
    setMsg(null);
    setOkMsg(null);
    try {
      const copied = await apiFetch<{ id: string }>(
        `/api/v1/tenant/game-templates/${id}/copy`,
        { method: "POST" },
      );
      setOkMsg(`已复制为「${name} 副本」。`);
      await load();
      router.push(`/game-templates/${copied.id}`);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`确认删除模板「${name}」？已发布派单不受影响。`))
      return;
    setBusy(true);
    setMsg(null);
    setOkMsg(null);
    try {
      await apiFetch<unknown>(`/api/v1/tenant/game-templates/${id}`, {
        method: "DELETE",
      });
      setOkMsg(`已删除模板「${name}」。`);
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
        <h1 className="page-title">陪玩模板</h1>
        <p className="page-desc">
          每个游戏一套模板：下单字段、位置人数、段位加价与派单文案都可自定义。
        </p>
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
        {page.phase === "ready" ? (
          <>
            <div className="card">
              <h2 className="card-title">新建游戏模板</h2>
              <div className="row-actions">
                <input
                  className="input"
                  placeholder="例如：英雄联盟"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  style={{ maxWidth: 260 }}
                />
                <button
                  className="btn btn-primary"
                  disabled={busy || !newName.trim()}
                  onClick={() => void create()}
                >
                  创建并配置
                </button>
              </div>
            </div>
            <div className="card">
              <h2 className="card-title">模板列表（{rows.length}）</h2>
              {rows.length === 0 ? (
                <p className="muted">暂无模板，先新建一个。</p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>名称</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.name}</td>
                        <td>
                          <span
                            className={
                              row.enabled
                                ? "badge badge-active"
                                : "badge badge-inactive"
                            }
                          >
                            {row.enabled ? "启用" : "停用"}
                          </span>
                        </td>
                        <td>
                          <div className="row-actions">
                            <Link
                              className="btn"
                              href={`/game-templates/${row.id}`}
                            >
                              编辑
                            </Link>
                            <button
                              className="btn"
                              disabled={busy}
                              onClick={() => void copy(row.id, row.name)}
                            >
                              复制
                            </button>
                            <button
                              className="btn btn-danger"
                              disabled={busy}
                              onClick={() => void remove(row.id, row.name)}
                            >
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}

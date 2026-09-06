"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiFetch } from "../../_lib/api";
import { TenantNav } from "../../_lib/tenant-nav";

interface Customer {
  id: string;
  name: string;
  mobile: string | null;
  remark: string | null;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
}

type PageState =
  | { phase: "loading" }
  | { phase: "unauthenticated" }
  | { phase: "error"; message: string }
  | { phase: "ready" };

export default function CustomersPage() {
  const [page, setPage] = useState<PageState>({ phase: "loading" });
  const [rows, setRows] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [newName, setNewName] = useState("");
  const [newMobile, setNewMobile] = useState("");
  const [newRemark, setNewRemark] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    name: string;
    mobile: string;
    remark: string;
  }>({
    name: "",
    mobile: "",
    remark: "",
  });

  const load = useCallback(async (query?: string) => {
    setPage({ phase: "loading" });
    try {
      const list = await apiFetch<Customer[]>(
        `/api/v1/tenant/customers${query ? `?q=${encodeURIComponent(query)}` : ""}`,
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
    setBusy(true);
    setMsg(null);
    setOkMsg(null);
    try {
      await apiFetch<Customer>("/api/v1/tenant/customers", {
        method: "POST",
        body: JSON.stringify({
          name: newName,
          mobile: newMobile || undefined,
          remark: newRemark || undefined,
        }),
      });
      setNewName("");
      setNewMobile("");
      setNewRemark("");
      setOkMsg("已创建客户。");
      await load(q);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async (c: Customer) => {
    setBusy(true);
    setMsg(null);
    setOkMsg(null);
    try {
      await apiFetch<Customer>(`/api/v1/tenant/customers/${c.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: c.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
        }),
      });
      setOkMsg(`已${c.status === "ACTIVE" ? "停用" : "恢复"} ${c.name}。`);
      await load(q);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: Customer) => {
    if (!window.confirm(`确认删除客户「${c.name}」？该操作不可恢复。`)) return;
    setBusy(true);
    setMsg(null);
    setOkMsg(null);
    try {
      await apiFetch<unknown>(`/api/v1/tenant/customers/${c.id}`, {
        method: "DELETE",
      });
      setOkMsg(`已删除 ${c.name}。`);
      await load(q);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (c: Customer) => {
    setEditingId(c.id);
    setEditForm({
      name: c.name,
      mobile: c.mobile ?? "",
      remark: c.remark ?? "",
    });
  };

  const saveEdit = async (c: Customer) => {
    setBusy(true);
    setMsg(null);
    setOkMsg(null);
    try {
      await apiFetch<Customer>(`/api/v1/tenant/customers/${c.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editForm.name,
          mobile: editForm.mobile || null,
          remark: editForm.remark || null,
        }),
      });
      setEditingId(null);
      setOkMsg("已保存修改。");
      await load(q);
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
        <h1 className="page-title">客户</h1>
        <p className="page-desc">
          门店客户档案：新增、搜索、编辑、停用/启用与删除。
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

        {page.phase === "ready" ? (
          <>
            <div className="card">
              <h2 className="card-title">新建客户</h2>
              <form
                className="field-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void create();
                }}
              >
                <div className="field">
                  <label htmlFor="name">姓名</label>
                  <input
                    id="name"
                    className="input"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="mobile">手机（可选）</label>
                  <input
                    id="mobile"
                    className="input"
                    value={newMobile}
                    onChange={(e) => setNewMobile(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="remark">备注</label>
                  <input
                    id="remark"
                    className="input"
                    value={newRemark}
                    onChange={(e) => setNewRemark(e.target.value)}
                  />
                </div>
                <div className="field" style={{ justifyContent: "flex-end" }}>
                  <button
                    className="btn btn-primary"
                    type="submit"
                    disabled={busy}
                  >
                    {busy ? "处理中…" : "新建"}
                  </button>
                </div>
              </form>
            </div>

            <div className="card">
              <div
                className="row-actions"
                style={{
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <h2 className="card-title" style={{ margin: 0 }}>
                  客户列表（{rows.length}）
                </h2>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void load(q);
                  }}
                >
                  <input
                    className="input"
                    placeholder="按姓名/手机搜索"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </form>
              </div>
              {rows.length === 0 ? (
                <p className="muted">暂无客户。</p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>姓名</th>
                      <th>手机</th>
                      <th>备注</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => {
                      const editing = editingId === c.id;
                      return (
                        <tr key={c.id}>
                          <td>
                            {editing ? (
                              <input
                                className="input"
                                value={editForm.name}
                                onChange={(e) =>
                                  setEditForm({
                                    ...editForm,
                                    name: e.target.value,
                                  })
                                }
                              />
                            ) : (
                              c.name
                            )}
                          </td>
                          <td>
                            {editing ? (
                              <input
                                className="input"
                                value={editForm.mobile}
                                onChange={(e) =>
                                  setEditForm({
                                    ...editForm,
                                    mobile: e.target.value,
                                  })
                                }
                              />
                            ) : (
                              (c.mobile ?? <span className="muted">-</span>)
                            )}
                          </td>
                          <td>
                            {editing ? (
                              <input
                                className="input"
                                value={editForm.remark}
                                onChange={(e) =>
                                  setEditForm({
                                    ...editForm,
                                    remark: e.target.value,
                                  })
                                }
                              />
                            ) : (
                              (c.remark ?? <span className="muted">-</span>)
                            )}
                          </td>
                          <td>
                            <span
                              className={
                                c.status === "ACTIVE"
                                  ? "badge badge-active"
                                  : "badge badge-inactive"
                              }
                            >
                              {c.status === "ACTIVE" ? "正常" : "已停用"}
                            </span>
                          </td>
                          <td>
                            <div className="row-actions">
                              {editing ? (
                                <>
                                  <button
                                    className="btn btn-primary"
                                    disabled={busy}
                                    onClick={() => void saveEdit(c)}
                                  >
                                    保存
                                  </button>
                                  <button
                                    className="btn"
                                    onClick={() => setEditingId(null)}
                                  >
                                    取消
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    className="btn"
                                    disabled={busy}
                                    onClick={() => startEdit(c)}
                                  >
                                    编辑
                                  </button>
                                  <button
                                    className="btn"
                                    disabled={busy}
                                    onClick={() => void toggleStatus(c)}
                                  >
                                    {c.status === "ACTIVE" ? "停用" : "启用"}
                                  </button>
                                  <button
                                    className="btn btn-danger"
                                    disabled={busy}
                                    onClick={() => void remove(c)}
                                  >
                                    删除
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : null}
        {page.phase === "error" ? (
          <p className="banner banner-error">加载失败：{page.message}</p>
        ) : null}
      </div>
    </main>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiFetch } from "../../_lib/api";
import { TenantNav } from "../../_lib/tenant-nav";

interface Player {
  id: string;
  name: string;
  mobile: string | null;
  status: "ACTIVE" | "INACTIVE";
  acceptingOrders: boolean;
}
interface Game {
  id: string;
  name: string;
  enabled: boolean;
}
interface Skill {
  id: string;
  gameName: string;
  title: string | null;
}
interface Availability {
  id: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
}
interface PlayerDetail extends Player {
  skills: Skill[];
  availability: Availability[];
}

type PageState =
  | { phase: "loading" }
  | { phase: "unauthenticated" }
  | { phase: "error"; message: string }
  | { phase: "ready" };

export default function PlayersPage() {
  const [page, setPage] = useState<PageState>({ phase: "loading" });
  const [rows, setRows] = useState<Player[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newMobile, setNewMobile] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PlayerDetail | null>(null);
  const [skillGameId, setSkillGameId] = useState("");
  const [availFrom, setAvailFrom] = useState("");
  const [availTo, setAvailTo] = useState("");
  const [availReason, setAvailReason] = useState("");

  const load = useCallback(async () => {
    setPage({ phase: "loading" });
    try {
      const [players, gameList] = await Promise.all([
        apiFetch<Player[]>("/api/v1/tenant/players"),
        apiFetch<Game[]>("/api/v1/tenant/catalog/games"),
      ]);
      setRows(players);
      setGames(gameList.filter((g) => g.enabled));
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

  const loadDetail = async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    setMsg(null);
    try {
      setDetail(await apiFetch<PlayerDetail>(`/api/v1/tenant/players/${id}`));
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    }
  };

  const create = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch<Player>("/api/v1/tenant/players", {
        method: "POST",
        body: JSON.stringify({ name: newName, mobile: newMobile || undefined }),
      });
      setNewName("");
      setNewMobile("");
      setOkMsg("已创建陪玩。");
      await load();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const toggleAccepting = async (p: Player) => {
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch<Player>(`/api/v1/tenant/players/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ acceptingOrders: !p.acceptingOrders }),
      });
      setOkMsg(
        `${p.name} ${p.acceptingOrders ? "已暂停接单" : "已恢复接单"}。`,
      );
      await load();
      if (selectedId === p.id) await loadDetail(p.id);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: Player) => {
    if (!window.confirm(`确认删除陪玩「${p.name}」及其技能/排期？`)) return;
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch<unknown>(`/api/v1/tenant/players/${p.id}`, {
        method: "DELETE",
      });
      if (selectedId === p.id) {
        setSelectedId(null);
        setDetail(null);
      }
      setOkMsg(`已删除 ${p.name}。`);
      await load();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const addSkill = async () => {
    if (!selectedId || !skillGameId) return;
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch<unknown>(`/api/v1/tenant/players/${selectedId}/skills`, {
        method: "POST",
        body: JSON.stringify({ gameId: skillGameId }),
      });
      await loadDetail(selectedId);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const removeSkill = async (skillId: string) => {
    if (!selectedId) return;
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch<unknown>(
        `/api/v1/tenant/players/${selectedId}/skills/${skillId}`,
        { method: "DELETE" },
      );
      await loadDetail(selectedId);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const addAvailability = async () => {
    if (!selectedId || !availFrom || !availTo) {
      setMsg("请填写开始与结束时间");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch<unknown>(
        `/api/v1/tenant/players/${selectedId}/availability`,
        {
          method: "POST",
          body: JSON.stringify({
            startsAt: new Date(availFrom).toISOString(),
            endsAt: new Date(availTo).toISOString(),
            reason: availReason || undefined,
          }),
        },
      );
      setAvailFrom("");
      setAvailTo("");
      setAvailReason("");
      await loadDetail(selectedId);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const removeAvailability = async (availabilityId: string) => {
    if (!selectedId) return;
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch<unknown>(
        `/api/v1/tenant/players/${selectedId}/availability/${availabilityId}`,
        { method: "DELETE" },
      );
      await loadDetail(selectedId);
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
        <h1 className="page-title">陪玩</h1>
        <p className="page-desc">
          陪玩档案、技能与不可接单时间（重叠会被拒绝）。
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
              <div
                className="row-actions"
                style={{
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <h2 className="card-title" style={{ margin: 0 }}>
                  陪玩列表（{rows.length}）
                </h2>
              </div>
              <div className="row-actions" style={{ marginBottom: 12 }}>
                <input
                  className="input"
                  placeholder="姓名"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  style={{ maxWidth: 200 }}
                />
                <input
                  className="input"
                  placeholder="手机（可选）"
                  value={newMobile}
                  onChange={(e) => setNewMobile(e.target.value)}
                  style={{ maxWidth: 200 }}
                />
                <button
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void create()}
                >
                  新建陪玩
                </button>
              </div>
              {rows.length === 0 ? (
                <p className="muted">暂无陪玩。</p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>姓名</th>
                      <th>手机</th>
                      <th>接单</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td>{p.mobile ?? <span className="muted">-</span>}</td>
                        <td>
                          <span
                            className={
                              p.acceptingOrders
                                ? "badge badge-active"
                                : "badge badge-inactive"
                            }
                          >
                            {p.acceptingOrders ? "接单中" : "暂停"}
                          </span>
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              className="btn"
                              onClick={() => void loadDetail(p.id)}
                            >
                              {selectedId === p.id ? "刷新" : "详情"}
                            </button>
                            <button
                              className="btn"
                              disabled={busy}
                              onClick={() => void toggleAccepting(p)}
                            >
                              {p.acceptingOrders ? "暂停接单" : "恢复接单"}
                            </button>
                            <button
                              className="btn btn-danger"
                              disabled={busy}
                              onClick={() => void remove(p)}
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
            {selectedId && detail ? (
              <div className="card">
                <h2 className="card-title">
                  {detail.name} · 详情
                  <span
                    className={
                      detail.acceptingOrders
                        ? "badge badge-active"
                        : "badge badge-inactive"
                    }
                    style={{ marginLeft: 8 }}
                  >
                    {detail.acceptingOrders ? "接单中" : "暂停接单"}
                  </span>
                </h2>

                <h3 className="card-title">技能</h3>
                {detail.skills.length === 0 ? (
                  <p className="muted">暂无技能。</p>
                ) : (
                  <table className="data-table">
                    <tbody>
                      {detail.skills.map((s) => (
                        <tr key={s.id}>
                          <td>{s.gameName}</td>
                          <td className="muted">{s.title ?? "-"}</td>
                          <td>
                            <button
                              className="btn btn-danger"
                              disabled={busy}
                              onClick={() => void removeSkill(s.id)}
                            >
                              移除
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div className="row-actions">
                  <select
                    className="input"
                    value={skillGameId}
                    onChange={(e) => setSkillGameId(e.target.value)}
                    style={{ maxWidth: 220 }}
                  >
                    <option value="">选择游戏…</option>
                    {games.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn btn-primary"
                    disabled={busy || !skillGameId}
                    onClick={() => void addSkill()}
                  >
                    添加技能
                  </button>
                </div>

                <h3 className="card-title" style={{ marginTop: 20 }}>
                  不可接单时间
                </h3>
                {detail.availability.length === 0 ? (
                  <p className="muted">暂无设置。</p>
                ) : (
                  <table className="data-table">
                    <tbody>
                      {detail.availability.map((a) => (
                        <tr key={a.id}>
                          <td>{new Date(a.startsAt).toLocaleString()}</td>
                          <td>→</td>
                          <td>{new Date(a.endsAt).toLocaleString()}</td>
                          <td className="muted">{a.reason ?? "-"}</td>
                          <td>
                            <button
                              className="btn btn-danger"
                              disabled={busy}
                              onClick={() => void removeAvailability(a.id)}
                            >
                              删除
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div className="row-actions" style={{ alignItems: "flex-end" }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label>开始</label>
                    <input
                      className="input"
                      type="datetime-local"
                      value={availFrom}
                      onChange={(e) => setAvailFrom(e.target.value)}
                    />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>结束</label>
                    <input
                      className="input"
                      type="datetime-local"
                      value={availTo}
                      onChange={(e) => setAvailTo(e.target.value)}
                    />
                  </div>
                  <div className="field" style={{ margin: 0, flex: 1 }}>
                    <label>原因（可选）</label>
                    <input
                      className="input"
                      value={availReason}
                      onChange={(e) => setAvailReason(e.target.value)}
                    />
                  </div>
                  <button
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => void addAvailability()}
                  >
                    添加不可用时间
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  );
}

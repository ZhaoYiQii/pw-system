"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiFetch, clearAccessToken } from "../../_lib/api";

type TenantStatus = "ACTIVE" | "INACTIVE" | "CONFIG_ERROR";

interface Tenant {
  id: string;
  code: string;
  name: string;
  status: TenantStatus;
  timezone: string;
  createdAt: string;
}

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "unauthenticated" }
  | { phase: "ready"; tenants: Tenant[] };

const statusLabel: Record<TenantStatus, { text: string; className: string }> = {
  ACTIVE: { text: "正常", className: "badge badge-active" },
  INACTIVE: { text: "已停用", className: "badge badge-inactive" },
  CONFIG_ERROR: { text: "配置错误", className: "badge badge-error" }
};

export default function PlatformTenantsPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const tenants = await apiFetch<Tenant[]>("/api/v1/platform/tenants");
      setState({ phase: "ready", tenants });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setState({ phase: "unauthenticated" });
      } else {
        setState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
      }
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createTenant = async () => {
    setBusy(true);
    setFormError(null);
    setNotice(null);
    try {
      const created = await apiFetch<Tenant>("/api/v1/platform/tenants", {
        method: "POST",
        body: JSON.stringify({
          code,
          name,
          ...(host.trim() !== "" ? { primaryHost: host.trim() } : {})
        })
      });
      setCode("");
      setName("");
      setHost("");
      setNotice(`已创建门店 ${created.code}（${created.name}）。`);
      await reload();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const deactivateTenant = async (id: string, label: string) => {
    if (!window.confirm(`确认停用门店「${label}」？停用后其 H5 前台将不可用。`)) return;
    setBusy(true);
    setFormError(null);
    setNotice(null);
    try {
      await apiFetch<unknown>(`/api/v1/platform/tenants/${id}/deactivate`, { method: "POST" });
      setNotice(`已停用门店「${label}」。`);
      await reload();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const logout = () => {
    clearAccessToken();
    router.push("/login");
  };

  if (state.phase === "loading") return <p className="page">加载中…</p>;

  return (
    <main>
      <nav className="topnav">
        <span className="brand">PW SaaS</span>
        <Link href="/tenants">租户管理</Link>
        <Link href="/packages">套餐与功能</Link>
        <span className="spacer" />
        <button className="btn" onClick={logout}>
          退出
        </button>
      </nav>
      <div className="page">
        <h1 className="page-title">平台租户</h1>
        <p className="page-desc">创建门店、停用门店，或进入门店开通增值功能。</p>
        {notice ? <p className="banner banner-success">{notice}</p> : null}
        {formError ? <p className="banner banner-error">{formError}</p> : null}

        {state.phase === "error" ? (
          <p className="banner banner-error">加载失败：{state.message}（请确认 API 已启动）</p>
        ) : null}
        {state.phase === "unauthenticated" ? (
          <div className="card">
            <p>尚未登录平台账号。</p>
            <Link className="btn btn-primary" href="/login">
              去登录
            </Link>
          </div>
        ) : null}

        {state.phase === "ready" ? (
          <>
            <div className="card">
              <h2 className="card-title">新建门店</h2>
              <p className="card-desc">填写后平台自动创建租户；主域名可选，用于 H5 前台解析。</p>
              <form
                className="field-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  void createTenant();
                }}
              >
                <div className="field">
                  <label htmlFor="code">门店 code</label>
                  <input
                    id="code"
                    className="input"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="name">门店名称</label>
                  <input
                    id="name"
                    className="input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="host">主域名（可选）</label>
                  <input
                    id="host"
                    className="input"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="shop.example.com"
                  />
                </div>
                <div className="field" style={{ justifyContent: "flex-end" }}>
                  <button className="btn btn-primary" type="submit" disabled={busy}>
                    {busy ? "处理中…" : "创建"}
                  </button>
                </div>
              </form>
            </div>

            <div className="card">
              <h2 className="card-title">租户列表（{state.tenants.length}）</h2>
              {state.tenants.length === 0 ? (
                <p className="muted">暂无门店，请先创建。</p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>code</th>
                      <th>名称</th>
                      <th>状态</th>
                      <th>时区</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.tenants.map((tenant) => {
                      const badge = statusLabel[tenant.status] ?? statusLabel.INACTIVE;
                      return (
                        <tr key={tenant.id}>
                          <td>{tenant.code}</td>
                          <td>{tenant.name}</td>
                          <td>
                            <span className={badge.className}>{badge.text}</span>
                          </td>
                          <td className="muted">{tenant.timezone}</td>
                          <td>
                            <div className="row-actions">
                              <Link className="btn" href={`/packages?tenantId=${tenant.id}`}>
                                套餐/功能
                              </Link>
                              {tenant.status === "ACTIVE" ? (
                                <button
                                  className="btn btn-danger"
                                  disabled={busy}
                                  onClick={() => void deactivateTenant(tenant.id, tenant.name)}
                                >
                                  停用
                                </button>
                              ) : null}
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
      </div>
    </main>
  );
}


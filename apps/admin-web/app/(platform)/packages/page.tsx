"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiFetch, clearAccessToken } from "../../_lib/api";
import { featureDescription, featureLabel } from "../../_lib/feature-catalog";

interface Tenant {
  id: string;
  code: string;
  name: string;
  status: string;
}

interface FeatureState {
  featureKey: string;
  core: boolean;
  enabled: boolean;
}

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "unauthenticated" }
  | { phase: "ready" };

export default function PlatformPackagesPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [features, setFeatures] = useState<FeatureState[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedTenant = useMemo(
    () => tenants.find((t) => t.id === tenantId) ?? null,
    [tenants, tenantId],
  );

  const loadTenants = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const list = await apiFetch<Tenant[]>("/api/v1/platform/tenants");
      setTenants(list);
      setState({ phase: "ready" });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setState({ phase: "unauthenticated" });
      } else {
        setState({
          phase: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }, []);

  const loadFeatures = useCallback(async (id: string) => {
    setFeatures(null);
    setMessage(null);
    setNotice(null);
    try {
      const list = await apiFetch<FeatureState[]>(
        `/api/v1/platform/tenants/${id}/entitlements`,
      );
      setFeatures(list);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void loadTenants();
  }, [loadTenants]);

  useEffect(() => {
    if (!tenantId) return;
    void loadFeatures(tenantId);
  }, [tenantId, loadFeatures]);

  useEffect(() => {
    if (state.phase !== "ready" || tenants.length === 0) return;
    if (tenantId && tenants.some((t) => t.id === tenantId)) return;
    const fromQuery =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("tenantId")
        : null;
    const preferred = tenants.find((t) => t.id === fromQuery) ?? tenants[0];
    if (!preferred) return;
    setTenantId(preferred.id);
  }, [state.phase, tenants, tenantId]);

  const toggle = async (featureKey: string, next: boolean) => {
    if (!tenantId) return;
    setBusyKey(featureKey);
    setMessage(null);
    setNotice(null);
    try {
      const list = await apiFetch<FeatureState[]>(
        `/api/v1/platform/tenants/${tenantId}/entitlements`,
        {
          method: "POST",
          body: JSON.stringify({ featureKey, enabled: next }),
        },
      );
      setFeatures(list);
      setNotice(`已${next ? "开启" : "关闭"} ${featureLabel(featureKey)}。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyKey(null);
    }
  };

  const logout = () => {
    clearAccessToken();
    router.push("/login");
  };

  if (state.phase === "loading") return <p className="page">加载中…</p>;

  const core = (features ?? []).filter((f) => f.core);
  const addons = (features ?? []).filter((f) => !f.core);

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
        <h1 className="page-title">套餐与增值功能</h1>
        <p className="page-desc">
          为门店开通或关闭增值功能。关闭后，门店后台对应的功能入口会隐藏，
          相关服务也会停用。
        </p>

        {state.phase === "unauthenticated" ? (
          <div className="card">
            <p>尚未登录平台账号。</p>
            <Link className="btn btn-primary" href="/login">
              去登录
            </Link>
          </div>
        ) : null}

        {state.phase === "error" ? (
          <p className="banner banner-error">加载失败：{state.message}</p>
        ) : null}

        {state.phase === "ready" ? (
          <>
            <div className="card">
              <h2 className="card-title">选择门店</h2>
              {tenants.length === 0 ? (
                <p className="muted">暂无门店，请先在租户管理创建。</p>
              ) : (
                <select
                  className="input"
                  style={{ maxWidth: 360 }}
                  value={tenantId ?? ""}
                  onChange={(e) => setTenantId(e.target.value || null)}
                >
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}（{t.code}）
                    </option>
                  ))}
                </select>
              )}
              {selectedTenant ? (
                <p className="muted" style={{ marginTop: 8 }}>
                  当前：{selectedTenant.name}（{selectedTenant.code}）· 状态{" "}
                  {selectedTenant.status}
                </p>
              ) : null}
            </div>

            {message ? <p className="banner banner-error">{message}</p> : null}
            {notice ? <p className="banner banner-success">{notice}</p> : null}

            {features === null && tenantId ? (
              <p className="muted">加载功能清单…</p>
            ) : null}

            {features !== null ? (
              <>
                <div className="card">
                  <h2 className="card-title">核心功能（永久启用）</h2>
                  <p className="card-desc">随套餐长期提供，不可单独关闭。</p>
                  <table className="data-table">
                    <tbody>
                      {core.map((f) => (
                        <tr key={f.featureKey}>
                          <td style={{ width: 40 }}>
                            <span className="badge badge-info">常开</span>
                          </td>
                          <td>
                            <strong>{featureLabel(f.featureKey)}</strong>
                            <div className="muted">
                              {featureDescription(f.featureKey)}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="card">
                  <h2 className="card-title">增值功能（可销售）</h2>
                  <p className="card-desc">
                    按门店经营需要逐个开通；开启后，商家后台会出现对应的功能入口。
                  </p>
                  <table className="data-table">
                    <tbody>
                      {addons.map((f) => {
                        return (
                          <tr key={f.featureKey}>
                            <td>
                              <label className="switch">
                                <input
                                  type="checkbox"
                                  checked={f.enabled}
                                  disabled={busyKey !== null}
                                  onChange={() =>
                                    void toggle(f.featureKey, !f.enabled)
                                  }
                                />
                                <span className="slider" />
                              </label>
                            </td>
                            <td>
                              <strong>{featureLabel(f.featureKey)}</strong>
                              <div className="muted">
                                {featureDescription(f.featureKey)}
                              </div>
                            </td>
                            <td>
                              <span
                                className={
                                  f.enabled
                                    ? "badge badge-active"
                                    : "badge badge-inactive"
                                }
                              >
                                {f.enabled ? "已开启" : "已关闭"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  );
}

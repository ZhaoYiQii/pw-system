"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiFetch, clearAccessToken } from "../../_lib/api";

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

const FEATURE_LABELS: Record<string, string> = {
  "core.tenancy": "租户与域名解析",
  "core.identity": "身份与账号体系",
  "core.audit": "审计日志",
  "core.customers": "客户管理",
  "core.players": "陪玩管理",
  "core.catalog": "服务目录与价格",
  "core.orders": "订单",
  "core.dispatch": "派单",
  "core.sessions": "服务场次",
  "core.settlements": "结算",
  "addon.customer_self_service": "客户自助服务",
  "addon.player_order_hall": "陪玩接单大厅",
  "addon.ai_requirement_parser": "AI 需求解析",
  "addon.ai_match_recommendation": "AI 匹配推荐",
  "addon.ai_anomaly_detection": "AI 异常检测",
  "addon.advanced_reports": "高级报表",
  "addon.custom_domain": "自定义域名",
  "addon.independent_miniprogram": "独立小程序",
  "addon.online_payment": "在线支付",
  "addon.enterprise_wechat_notifications": "企业微信通知",
  "addon.chain_stores": "连锁门店",
  "addon.open_api": "开放 API",
};

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
      setNotice(
        `已${next ? "开启" : "关闭"} ${FEATURE_LABELS[featureKey] ?? featureKey}。`,
      );
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
        <h1 className="page-title">套餐与功能开关</h1>
        <p className="page-desc">
          为门店开通/关闭增值功能（核心功能永久启用）。后端 API
          与前端菜单同时受开关约束。
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
                  <p className="card-desc">
                    随套餐提供，不可关闭；平台只管理下方增值功能。
                  </p>
                  <table className="data-table">
                    <tbody>
                      {core.map((f) => (
                        <tr key={f.featureKey}>
                          <td style={{ width: 40 }}>
                            <span className="badge badge-info">常开</span>
                          </td>
                          <td>
                            {FEATURE_LABELS[f.featureKey] ?? f.featureKey}
                          </td>
                          <td className="muted">{f.featureKey}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="card">
                  <h2 className="card-title">增值功能（可销售）</h2>
                  <p className="card-desc">
                    关闭后对应模块的 API 返回 403，前端入口同步隐藏（Slice 3+
                    逐步接入）。
                  </p>
                  <table className="data-table">
                    <tbody>
                      {addons.map((f) => {
                        const label =
                          FEATURE_LABELS[f.featureKey] ?? f.featureKey;
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
                              {label}
                              <div className="muted">{f.featureKey}</div>
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


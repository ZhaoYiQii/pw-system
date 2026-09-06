"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiFetch, clearAccessToken } from "../../_lib/api";

interface BrandConfig {
  primaryColor: string;
  accentColor: string;
  logoText: string;
  borderRadius: number;
}

interface StorefrontConfig {
  allowCustomerSelection: boolean;
  showServiceDuration: boolean;
}

interface TenantConfigV1 {
  schemaVersion: "v1";
  brand: BrandConfig;
  storefront: StorefrontConfig;
}

interface EffectiveConfig {
  status: "ACTIVE" | "CONFIG_ERROR";
  version: number;
  config: TenantConfigV1 | null;
  hasSaved: boolean;
}

interface ConfigVersionRow {
  id: string;
  version: number;
  status: string;
  createdAt: string;
}

interface FeatureState {
  featureKey: string;
  core: boolean;
  enabled: boolean;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_CONFIG: TenantConfigV1 = {
  schemaVersion: "v1",
  brand: {
    primaryColor: "#2f54eb",
    accentColor: "#fa8c16",
    logoText: "PW",
    borderRadius: 8,
  },
  storefront: { allowCustomerSelection: true, showServiceDuration: true },
};

type PageState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "unauthenticated" }
  | { phase: "ready" };

export default function TenantSettingsPage() {
  const router = useRouter();
  const [page, setPage] = useState<PageState>({ phase: "loading" });
  const [effective, setEffective] = useState<EffectiveConfig | null>(null);
  const [versions, setVersions] = useState<ConfigVersionRow[]>([]);
  const [addons, setAddons] = useState<FeatureState[]>([]);
  const [form, setForm] = useState<TenantConfigV1>(DEFAULT_CONFIG);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPage({ phase: "loading" });
    try {
      const [cfg, ver, feats] = await Promise.all([
        apiFetch<EffectiveConfig>("/api/v1/tenant/config"),
        apiFetch<ConfigVersionRow[]>("/api/v1/tenant/config/versions"),
        apiFetch<FeatureState[]>("/api/v1/tenant/features"),
      ]);
      setEffective(cfg);
      setVersions(ver);
      setAddons(feats.filter((f) => !f.core));
      if (cfg.config) setForm(cfg.config);
      setPage({ phase: "ready" });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setPage({ phase: "unauthenticated" });
      } else {
        setPage({
          phase: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const validate = (): string | null => {
    if (!HEX_COLOR.test(form.brand.primaryColor))
      return "主色必须是 6 位十六进制颜色（如 #2f54eb）。";
    if (!HEX_COLOR.test(form.brand.accentColor))
      return "辅色必须是 6 位十六进制颜色（如 #fa8c16）。";
    const text = form.brand.logoText.trim();
    if (text.length < 1 || text.length > 40)
      return "门店文字需为 1-40 个字符。";
    const radius = form.brand.borderRadius;
    if (!Number.isInteger(radius) || radius < 0 || radius > 24)
      return "圆角需为 0-24 的整数。";
    return null;
  };

  const applyEffective = (cfg: EffectiveConfig) => {
    setEffective(cfg);
    if (cfg.config) setForm(cfg.config);
  };

  const refreshVersions = async () => {
    const ver = await apiFetch<ConfigVersionRow[]>(
      "/api/v1/tenant/config/versions",
    );
    setVersions(ver);
  };

  const save = async () => {
    const invalid = validate();
    setMessage(invalid);
    if (invalid) return;
    setBusy(true);
    setNotice(null);
    try {
      const cfg = await apiFetch<EffectiveConfig>("/api/v1/tenant/config", {
        method: "POST",
        body: JSON.stringify({ config: form }),
      });
      applyEffective(cfg);
      await refreshVersions();
      setNotice(`配置已保存并生效（版本 v${cfg.version}）。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const rollback = async () => {
    setBusy(true);
    setMessage(null);
    setNotice(null);
    try {
      const cfg = await apiFetch<EffectiveConfig>(
        "/api/v1/tenant/config/rollback",
        {
          method: "POST",
        },
      );
      applyEffective(cfg);
      await refreshVersions();
      setNotice(`已回滚到上一版本（当前 v${cfg.version}）。`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setMessage("没有可回滚的上一版本。");
      } else {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setBusy(false);
    }
  };

  const logout = () => {
    clearAccessToken();
    router.push("/store/login");
  };

  const configError = effective?.status === "CONFIG_ERROR";
  const canRollback = versions.length > 1;

  if (page.phase === "loading") return <p className="page">加载中…</p>;

  return (
    <main>
      <nav className="topnav">
        <span className="brand">PW SaaS</span>
        <Link href="/settings">门店设置</Link>
        <span className="spacer" />
        <button className="btn" onClick={logout}>
          退出
        </button>
      </nav>
      <div className="page">
        <h1 className="page-title">门店设置</h1>
        <p className="page-desc">
          品牌主题仅允许受限 design token（hex 颜色 / 文字 / 圆角），不接收任意
          HTML/CSS/JS。
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
          <>
            {configError ? (
              <p className="banner banner-error">
                当前配置异常（CONFIG_ERROR），门店前台暂不可用。请修正后保存，或回滚到上一有效版本。
              </p>
            ) : null}
            {message ? <p className="banner banner-error">{message}</p> : null}
            {notice ? <p className="banner banner-success">{notice}</p> : null}

            <div className="card">
              <div
                className="row-actions"
                style={{ justifyContent: "space-between" }}
              >
                <div>
                  <h2 className="card-title">品牌与前台</h2>
                  <p className="card-desc">
                    当前生效版本 v{effective?.version ?? 0}
                    {effective?.hasSaved ? "" : "（默认配置，尚未保存）"}
                  </p>
                </div>
                <div className="row-actions">
                  <button
                    className="btn"
                    disabled={busy || !canRollback}
                    title={canRollback ? "" : "需要至少两个版本"}
                    onClick={() => void rollback()}
                  >
                    回滚上一版本
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => void save()}
                  >
                    {busy ? "处理中…" : "保存并生效"}
                  </button>
                </div>
              </div>

              <div className="field-row">
                <div className="field">
                  <label htmlFor="primaryColor">
                    主色{" "}
                    <span
                      className="swatch-preview"
                      style={{ backgroundColor: form.brand.primaryColor }}
                    />
                  </label>
                  <input
                    id="primaryColor"
                    className="input"
                    type="color"
                    value={form.brand.primaryColor}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        brand: { ...form.brand, primaryColor: e.target.value },
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="accentColor">
                    辅色{" "}
                    <span
                      className="swatch-preview"
                      style={{ backgroundColor: form.brand.accentColor }}
                    />
                  </label>
                  <input
                    id="accentColor"
                    className="input"
                    type="color"
                    value={form.brand.accentColor}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        brand: { ...form.brand, accentColor: e.target.value },
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="logoText">门店文字（1-40 字符）</label>
                  <input
                    id="logoText"
                    className="input"
                    maxLength={40}
                    value={form.brand.logoText}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        brand: { ...form.brand, logoText: e.target.value },
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="borderRadius">圆角（0-24 px）</label>
                  <input
                    id="borderRadius"
                    className="input"
                    type="number"
                    min={0}
                    max={24}
                    step={1}
                    value={form.brand.borderRadius}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        brand: {
                          ...form.brand,
                          borderRadius: Number(e.target.value),
                        },
                      })
                    }
                  />
                </div>
              </div>

              <div className="field">
                <label
                  style={{ display: "flex", gap: 8, alignItems: "center" }}
                >
                  <input
                    type="checkbox"
                    checked={form.storefront.allowCustomerSelection}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        storefront: {
                          ...form.storefront,
                          allowCustomerSelection: e.target.checked,
                        },
                      })
                    }
                  />
                  前台允许客户自选陪玩
                </label>
              </div>
              <div className="field">
                <label
                  style={{ display: "flex", gap: 8, alignItems: "center" }}
                >
                  <input
                    type="checkbox"
                    checked={form.storefront.showServiceDuration}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        storefront: {
                          ...form.storefront,
                          showServiceDuration: e.target.checked,
                        },
                      })
                    }
                  />
                  前台展示服务时长
                </label>
              </div>
            </div>

            <div className="card">
              <h2 className="card-title">配置版本历史</h2>
              <p className="card-desc">
                每次保存生成新版本；回滚将上一版本重新置为生效。
              </p>
              {versions.length === 0 ? (
                <p className="muted">暂无保存记录（当前使用平台默认配置）。</p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>版本</th>
                      <th>状态</th>
                      <th>保存时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {versions.map((row) => (
                      <tr key={row.id}>
                        <td>v{row.version}</td>
                        <td>
                          <span
                            className={
                              row.status === "ACTIVE"
                                ? "badge badge-active"
                                : row.status === "CONFIG_ERROR"
                                  ? "badge badge-error"
                                  : "badge badge-inactive"
                            }
                          >
                            {row.status === "ACTIVE"
                              ? "当前生效"
                              : row.status === "CONFIG_ERROR"
                                ? "配置异常"
                                : "历史版本"}
                          </span>
                        </td>
                        <td className="muted">
                          {new Date(row.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card">
              <h2 className="card-title">增值功能（只读）</h2>
              <p className="card-desc">
                增值功能由平台在「套餐与功能开关」中开通/关闭，这里仅展示当前状态。
              </p>
              {addons.length === 0 ? (
                <p className="muted">加载中…</p>
              ) : (
                <table className="data-table">
                  <tbody>
                    {addons.map((f) => (
                      <tr key={f.featureKey}>
                        <td>{f.featureKey}</td>
                        <td>
                          <span
                            className={
                              f.enabled
                                ? "badge badge-active"
                                : "badge badge-inactive"
                            }
                          >
                            {f.enabled ? "已开通" : "未开通"}
                          </span>
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


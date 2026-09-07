"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiFetch } from "../../_lib/api";
import { featureDescription, featureLabel } from "../../_lib/feature-catalog";
import { TenantNav } from "../../_lib/tenant-nav";

interface FeatureRow {
  featureKey: string;
  enabled: boolean;
}

type PageState =
  | { phase: "loading" }
  | { phase: "unauthenticated" }
  | { phase: "error"; message: string }
  | { phase: "ready" };

export default function AiPage() {
  const [page, setPage] = useState<PageState>({ phase: "loading" });
  const [features, setFeatures] = useState<FeatureRow[]>([]);
  const [capabilities, setCapabilities] = useState<{
    supported: boolean;
    provider?: string;
    reason?: string;
  } | null>(null);

  const load = useCallback(async () => {
    setPage({ phase: "loading" });
    try {
      const [feats, caps] = await Promise.all([
        apiFetch<FeatureRow[]>("/api/v1/tenant/features"),
        apiFetch<{
          supported: boolean;
          provider?: string;
          reason?: string;
        }>("/api/v1/tenant/ai/capabilities"),
      ]);
      setFeatures(feats);
      setCapabilities(caps);
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
        <h1 className="page-title">AI 需求助手</h1>
        <p className="page-desc">
          查看 AI 相关功能的开通与实际可用状态；未配置服务商时会明确提示不可用，
          不伪装成功。
        </p>
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
              <h2 className="card-title">AI 能力</h2>
              <p className="muted">
                {capabilities?.supported
                  ? `可用（服务商：${capabilities.provider ?? "-"}）`
                  : `不可用：${capabilities?.reason ?? "未配置"}`}
              </p>
            </div>
            <div className="card">
              <h2 className="card-title">AI 增值功能（只读）</h2>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>功能</th>
                    <th>说明</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {features
                    .filter((f) => f.featureKey.startsWith("addon.ai_"))
                    .map((f) => (
                      <tr key={f.featureKey}>
                        <td>{featureLabel(f.featureKey)}</td>
                        <td className="muted">
                          {featureDescription(f.featureKey)}
                        </td>
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
              {features.filter((f) => f.featureKey.startsWith("addon.ai_"))
                .length === 0 ? (
                <p className="muted">
                  尚未开通 AI 增值功能，可让平台方在“套餐与增值功能”页开通。
                </p>
              ) : null}
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

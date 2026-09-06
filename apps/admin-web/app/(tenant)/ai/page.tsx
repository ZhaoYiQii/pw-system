"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiFetch } from "../../_lib/api";
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
          解析订单需求与推荐陪玩的能力状态；未配置外部 Provider
          时明确显示不可用，不伪装成功。
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
                  ? `可用（Provider: ${capabilities.provider ?? "-"}）`
                  : `不可用：${capabilities?.reason ?? "未配置"}`}
              </p>
            </div>
            <div className="card">
              <h2 className="card-title">套餐开关（只读）</h2>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Feature</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {features
                    .filter((f) => f.featureKey.startsWith("addon.ai_"))
                    .map((f) => (
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
              {features.filter((f) => f.featureKey.startsWith("addon.ai_"))
                .length === 0 ? (
                <p className="muted">套餐未包含任何 AI addon。</p>
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

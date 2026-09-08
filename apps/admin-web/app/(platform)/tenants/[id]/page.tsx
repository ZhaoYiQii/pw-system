"use client";

import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ApiError, apiFetch } from "../../../_lib/api";
import {
  featureDescription,
  featureLabel,
} from "../../../_lib/feature-catalog";
import { PlatformShell } from "../../../_lib/platform-shell";

interface PlatformTenantDetail {
  id: string;
  code: string;
  name: string;
  status: string;
  timezone: string;
  createdAt: string;
  primaryHost: string | null;
  ownerUsername: string | null;
  packageCode: string | null;
  packageName: string | null;
  subscriptionStatus: string | null;
  startsAt: string | null;
  endsAt: string | null;
  platformFeeBp: number | null;
  storeCutBp: number | null;
  brandPrimary: string | null;
  brandAccent: string | null;
  logoText: string | null;
}

interface FeatureState {
  featureKey: string;
  core: boolean;
  enabled: boolean;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function Inner() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ["platform-tenant-detail", id],
    queryFn: () =>
      apiFetch<PlatformTenantDetail>(
        `/api/v1/platform/tenants/${id}/detail`,
      ),
    enabled: id !== undefined,
    retry: false,
  });

  const entitlementsQuery = useQuery({
    queryKey: ["platform-tenant-detail-entitlements", id],
    queryFn: () =>
      apiFetch<FeatureState[]>(
        `/api/v1/platform/tenants/${id}/entitlements`,
      ),
    enabled: id !== undefined,
  });

  const detail = detailQuery.data;
  const features = entitlementsQuery.data ?? [];
  const addons = features.filter((f) => !f.core);
  const is401 =
    detailQuery.error instanceof ApiError &&
    detailQuery.error.status === 401;
  const is404 =
    detailQuery.error instanceof ApiError &&
    detailQuery.error.status === 404;

  const toggle = useMutation({
    mutationFn: ({
      featureKey,
      next,
    }: {
      featureKey: string;
      next: boolean;
    }) =>
      apiFetch<FeatureState[]>(`/api/v1/platform/tenants/${id}/entitlements`, {
        method: "POST",
        body: JSON.stringify({ featureKey, enabled: next }),
      }),
    onSuccess: (_data, vars) => {
      setNotice(
        `已${vars.next ? "开启" : "关闭"} ${featureLabel(vars.featureKey)}。`,
      );
      setMessage(null);
      void queryClient.invalidateQueries({
        queryKey: ["platform-tenant-detail-entitlements", id],
      });
    },
    onError: (error) =>
      setMessage(error instanceof Error ? error.message : String(error)),
  });

  const deactivate = useMutation({
    mutationFn: () =>
      apiFetch<unknown>(`/api/v1/platform/tenants/${id}/deactivate`, {
        method: "POST",
      }),
    onSuccess: () => {
      setNotice("门店已停用。");
      void queryClient.invalidateQueries({
        queryKey: ["platform-tenant-detail", id],
      });
    },
    onError: (error) =>
      setMessage(error instanceof Error ? error.message : String(error)),
  });

  return (
    <PlatformShell>
      {is401 ? (
        <div className="pw-panel" style={{ maxWidth: 520, margin: "60px auto" }}>
          <div className="pw-panel-body">
            <h2 style={{ margin: "0 0 8px" }}>尚未登录平台账号</h2>
            <Link className="pw-btn pw-primary" href="/login" style={{ marginTop: 12 }}>
              去登录
            </Link>
          </div>
        </div>
      ) : detailQuery.isPending || !detail ? (
        <div className="pw-empty">{is404 ? "门店不存在。" : "加载门店…"}</div>
      ) : (
        <>
          <div className="pw-page-head">
            <div>
              <div className="pw-eyebrow">Platform / Tenant</div>
              <h1>{detail.name}</h1>
              <p>
                {detail.code} · {detail.status}
              </p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Link className="pw-btn" href="/tenants">
                ← 返回门店管理
              </Link>
              <Link
                className="pw-btn pw-primary"
                href={`/packages?tenantId=${encodeURIComponent(detail.id)}`}
              >
                开通增值功能
              </Link>
              {detail.status === "ACTIVE" ? (
                <button
                  type="button"
                  className="pw-btn pw-danger"
                  disabled={deactivate.isPending}
                  onClick={() => {
                    if (window.confirm(`确认停用门店「${detail.name}」？`)) {
                      setNotice(null);
                      deactivate.mutate();
                    }
                  }}
                >
                  停用门店
                </button>
              ) : null}
            </div>
          </div>

          {notice ? (
            <div
              className="pw-notice"
              style={{ background: "var(--pw-green-soft)", color: "var(--pw-green)" }}
            >
              {notice}
            </div>
          ) : null}
          {message ? (
            <div
              className="pw-notice"
              style={{ background: "var(--pw-red-soft)", color: "var(--pw-red)" }}
            >
              {message}
            </div>
          ) : null}

          <div className="pw-grid-2">
            <div className="pw-panel">
              <div className="pw-panel-head">
                <h2>基本与订阅</h2>
              </div>
              <div className="pw-panel-body">
                <div className="pw-detail-grid">
                  <div className="pw-field">
                    <label>门店名称</label>
                    <input value={detail.name} readOnly />
                  </div>
                  <div className="pw-field">
                    <label>Code / Host</label>
                    <input
                      value={`${detail.code} / ${detail.primaryHost ?? "—"}`}
                      readOnly
                    />
                  </div>
                  <div className="pw-field">
                    <label>状态 / 时区</label>
                    <input value={`${detail.status} / ${detail.timezone}`} readOnly />
                  </div>
                  <div className="pw-field">
                    <label>创建时间</label>
                    <input value={formatDate(detail.createdAt)} readOnly />
                  </div>
                  <div className="pw-field">
                    <label>店主账号</label>
                    <input value={detail.ownerUsername ?? "—"} readOnly />
                  </div>
                  <div className="pw-field">
                    <label>套餐</label>
                    <input
                      value={`${detail.packageName ?? "—"}${
                        detail.packageCode ? `（${detail.packageCode}）` : ""
                      }`}
                      readOnly
                    />
                  </div>
                  <div className="pw-field">
                    <label>到期时间</label>
                    <input value={formatDate(detail.endsAt)} readOnly />
                  </div>
                  <div className="pw-field">
                    <label>分账费率（平台 / 门店）</label>
                    <input
                      value={`${detail.platformFeeBp ?? "—"}bp / ${
                        detail.storeCutBp ?? "—"
                      }bp`}
                      readOnly
                    />
                  </div>
                  <div className="pw-field">
                    <label>品牌主色 / 点缀色</label>
                    <input
                      value={`${detail.brandPrimary ?? "—"} / ${
                        detail.brandAccent ?? "—"
                      }`}
                      readOnly
                    />
                  </div>
                  <div className="pw-field">
                    <label>品牌文字</label>
                    <input value={detail.logoText ?? "—"} readOnly />
                  </div>
                </div>
              </div>
            </div>

            <div className="pw-panel">
              <div className="pw-panel-head">
                <h2>增值功能</h2>
                <p>作用于该门店</p>
              </div>
              <div className="pw-panel-body">
                {entitlementsQuery.isPending ? (
                  <div className="pw-empty">加载中…</div>
                ) : (
                  addons.map((feature) => (
                    <div className="pw-addon-row" key={feature.featureKey}>
                      <span>
                        <b>{featureLabel(feature.featureKey)}</b>
                        <span
                          style={{
                            display: "block",
                            color: "var(--pw-muted)",
                            fontSize: 11,
                          }}
                        >
                          {featureDescription(feature.featureKey)}
                        </span>
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={feature.enabled}
                        className={`pw-toggle ${feature.enabled ? "pw-on" : ""}`}
                        disabled={toggle.isPending}
                        onClick={() =>
                          toggle.mutate({
                            featureKey: feature.featureKey,
                            next: !feature.enabled,
                          })
                        }
                      />
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </PlatformShell>
  );
}

export default function PlatformTenantDetailPage() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <Inner />
    </QueryClientProvider>
  );
}

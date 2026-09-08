"use client";

import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, apiFetch } from "../../_lib/api";
import {
  featureDescription,
  featureLabel,
} from "../../_lib/feature-catalog";
import { PlatformShell } from "../../_lib/platform-shell";

interface Tenant {
  id: string;
  code: string;
  name: string;
  status: string;
}

interface PackageDef {
  code: string;
  name: string;
  addons: string[];
  durationDays: number;
}

interface FeatureState {
  featureKey: string;
  core: boolean;
  enabled: boolean;
}

function Inner() {
  const queryClient = useQueryClient();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const tenantsQuery = useQuery({
    queryKey: ["platform", "tenants"],
    queryFn: () => apiFetch<Tenant[]>("/api/v1/platform/tenants"),
  });

  const packagesQuery = useQuery({
    queryKey: ["platform", "packages"],
    queryFn: () => apiFetch<PackageDef[]>("/api/v1/platform/packages"),
  });

  const entitlementsQuery = useQuery({
    queryKey: ["platform", "entitlements", tenantId],
    queryFn: () =>
      apiFetch<FeatureState[]>(
        `/api/v1/platform/tenants/${tenantId}/entitlements`,
      ),
    enabled: tenantId !== null,
  });

  const tenants = tenantsQuery.data ?? [];

  useEffect(() => {
    if (!tenantsQuery.isPending && tenants.length > 0) {
      const fromQuery =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("tenantId")
          : null;
      const preferred = tenants.find((t) => t.id === fromQuery) ?? tenants[0];
      if (preferred && tenantId !== preferred.id) setTenantId(preferred.id);
    }
  }, [tenantsQuery.isPending, tenants, tenantId]);

  const assign = useMutation({
    mutationFn: ({ packageCode }: { packageCode: string }) =>
      apiFetch<unknown>(`/api/v1/platform/tenants/${tenantId}/package`, {
        method: "POST",
        body: JSON.stringify({ packageCode }),
      }),
    onSuccess: () => {
      setNotice("套餐已指派，增值功能已按套餐同步。");
      setMessage(null);
      void queryClient.invalidateQueries({
        queryKey: ["platform", "entitlements", tenantId],
      });
    },
    onError: (error) =>
      setMessage(error instanceof Error ? error.message : String(error)),
  });

  const toggle = useMutation({
    mutationFn: ({
      featureKey,
      next,
    }: {
      featureKey: string;
      next: boolean;
    }) =>
      apiFetch<FeatureState[]>(
        `/api/v1/platform/tenants/${tenantId}/entitlements`,
        {
          method: "POST",
          body: JSON.stringify({ featureKey, enabled: next }),
        },
      ),
    onSuccess: (_data, vars) => {
      setNotice(
        `已${vars.next ? "开启" : "关闭"} ${featureLabel(vars.featureKey)}。`,
      );
      setMessage(null);
      void queryClient.invalidateQueries({
        queryKey: ["platform", "entitlements", tenantId],
      });
    },
    onError: (error) =>
      setMessage(error instanceof Error ? error.message : String(error)),
  });

  const selectedTenant = tenants.find((t) => t.id === tenantId) ?? null;
  const features = entitlementsQuery.data ?? [];
  const addons = features.filter((f) => !f.core);
  const is401 =
    tenantsQuery.error instanceof ApiError &&
    tenantsQuery.error.status === 401;

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
      ) : (
        <>
          <div className="pw-page-head">
            <div>
              <div className="pw-eyebrow">Platform / Packages</div>
              <h1>套餐与增值功能</h1>
              <p>随套餐或按门店逐个开通；关闭后入口隐藏且服务停用。</p>
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

          <div className="pw-panel">
            <div className="pw-panel-body" style={{ paddingTop: 12 }}>
              <div className="pw-store-pick">
                <span style={{ fontSize: 12, color: "var(--pw-muted)" }}>
                  作用于门店
                </span>
                <select
                  value={tenantId ?? ""}
                  onChange={(event) => setTenantId(event.target.value || null)}
                  aria-label="选择门店"
                >
                  {tenants.map((tenant) => (
                    <option key={tenant.id} value={tenant.id}>
                      {tenant.name}
                    </option>
                  ))}
                </select>
                <span className="pw-pending">接口已就绪：packages / entitlements</span>
              </div>
            </div>
          </div>

          <div className="pw-panel">
            <div className="pw-panel-head">
              <h2>套餐定义</h2>
              <p>
                {(packagesQuery.data ?? []).map((p) => p.code).join(" / ")}
              </p>
            </div>
            <div className="pw-panel-body" style={{ padding: 0 }}>
              {(packagesQuery.data ?? []).length > 0 ? (
                <table>
                  <thead>
                    <tr>
                      <th>套餐</th>
                      <th>周期</th>
                      <th>包含增值功能</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(packagesQuery.data ?? []).map((pkg) => (
                      <tr key={pkg.code}>
                        <td>
                          <b>{pkg.name}</b>
                          <span className="pw-mono" style={{ marginLeft: 8, color: "var(--pw-muted)" }}>
                            {pkg.code}
                          </span>
                        </td>
                        <td className="pw-mono">{pkg.durationDays} 天</td>
                        <td style={{ color: "var(--pw-muted)" }}>
                          {pkg.addons.length > 0
                            ? pkg.addons.map((key) => featureLabel(key)).join(" · ")
                            : "仅核心功能"}
                        </td>
                        <td>
                          <span className="pw-status pw-ok">可选</span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="pw-btn pw-small pw-primary"
                            disabled={!tenantId || assign.isPending}
                            onClick={() => assign.mutate({ packageCode: pkg.code })}
                          >
                            {assign.isPending ? "指派中…" : "指派此套餐"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="pw-empty">加载套餐…</div>
              )}
            </div>
          </div>

          <div className="pw-panel">
            <div className="pw-panel-head">
              <h2>增值功能清单（addon）</h2>
              <p>选中门店后开关</p>
            </div>
            <div className="pw-panel-body">
              {!tenantId ? (
                <div className="pw-empty">请先选择一家门店。</div>
              ) : entitlementsQuery.isPending ? (
                <div className="pw-empty">加载功能清单…</div>
              ) : addons.length === 0 ? (
                <div className="pw-empty">暂无增值功能数据。</div>
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
                      aria-label={`${featureLabel(feature.featureKey)}开关`}
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
          {selectedTenant ? (
            <p style={{ color: "var(--pw-muted)", fontSize: 11 }}>
              当前：{selectedTenant.name}（{selectedTenant.code}）· 状态{" "}
              {selectedTenant.status}
            </p>
          ) : null}
        </>
      )}
    </PlatformShell>
  );
}

export default function PlatformPackagesPage() {
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


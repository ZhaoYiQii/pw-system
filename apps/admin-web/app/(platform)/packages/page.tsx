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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError, apiFetch } from "../../_lib/api";
import { featureDescription, featureLabel } from "../../_lib/feature-catalog";
import { PlatformShell } from "../../_lib/platform-shell";

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

function Inner() {
  const queryClient = useQueryClient();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const tenantsQuery = useQuery({
    queryKey: ["platform", "tenants"],
    queryFn: () => apiFetch<Tenant[]>("/api/v1/platform/tenants"),
  });
  const featuresQuery = useQuery({
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

  const toggle = useMutation({
    mutationFn: ({ featureKey, next }: { featureKey: string; next: boolean }) =>
      apiFetch<FeatureState[]>(
        `/api/v1/platform/tenants/${tenantId}/entitlements`,
        {
          method: "POST",
          body: JSON.stringify({ featureKey, enabled: next }),
        },
      ),
    onSuccess: (_d, vars) => {
      setNotice(
        `已${vars.next ? "开启" : "关闭"} ${featureLabel(vars.featureKey)}。`,
      );
      void queryClient.invalidateQueries({
        queryKey: ["platform", "entitlements", tenantId],
      });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });

  const selectedTenant = tenants.find((t) => t.id === tenantId) ?? null;
  const features = featuresQuery.data ?? null;
  const core = (features ?? []).filter((f) => f.core);
  const addons = (features ?? []).filter((f) => !f.core);

  if (
    tenantsQuery.error instanceof ApiError &&
    tenantsQuery.error.status === 401
  ) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>尚未登录平台账号</CardTitle>
          <CardDescription>请先以平台管理员身份登录。</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/login">去登录</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {notice ? <p className="text-sm text-emerald-600">{notice}</p> : null}
      {message ? <p className="text-sm text-destructive">{message}</p> : null}
      {tenantsQuery.isError ? (
        <p className="text-sm text-destructive">
          加载失败：
          {tenantsQuery.error instanceof Error
            ? tenantsQuery.error.message
            : String(tenantsQuery.error)}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>选择门店</CardTitle>
          <CardDescription>为门店开通或关闭增值功能。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {tenants.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              暂无门店，请先在租户管理创建。
            </p>
          ) : (
            <select
              className="flex h-9 max-w-md rounded-md border border-input bg-transparent px-3 py-1 text-sm"
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
            <p className="text-sm text-muted-foreground">
              当前：{selectedTenant.name}（{selectedTenant.code}）· 状态{" "}
              {selectedTenant.status}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {features === null && tenantId ? (
        <p className="text-sm text-muted-foreground">加载功能清单…</p>
      ) : null}

      {features !== null ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>核心功能（永久启用）</CardTitle>
              <CardDescription>随套餐长期提供，不可单独关闭。</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>功能</TableHead>
                    <TableHead>说明</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {core.map((f) => (
                    <TableRow key={f.featureKey}>
                      <TableCell className="font-medium">
                        {featureLabel(f.featureKey)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {featureDescription(f.featureKey)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>增值功能（可销售）</CardTitle>
              <CardDescription>
                按门店经营需要逐个开通；开启后商家后台出现对应入口。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>状态</TableHead>
                    <TableHead>功能</TableHead>
                    <TableHead>说明</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {addons.map((f) => (
                    <TableRow key={f.featureKey}>
                      <TableCell>
                        <Badge variant={f.enabled ? "default" : "outline"}>
                          {f.enabled ? "已开启" : "已关闭"}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">
                        {featureLabel(f.featureKey)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {featureDescription(f.featureKey)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={toggle.isPending}
                          onClick={() =>
                            toggle.mutate({
                              featureKey: f.featureKey,
                              next: !f.enabled,
                            })
                          }
                        >
                          {f.enabled ? "关闭" : "开启"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
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
    <PlatformShell>
      <h1 className="text-2xl font-semibold tracking-tight">套餐与增值功能</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        为门店开通或关闭增值功能；关闭后入口隐藏且服务停用。
      </p>
      <div className="mt-6">
        <QueryClientProvider client={queryClient}>
          <Inner />
        </QueryClientProvider>
      </div>
    </PlatformShell>
  );
}

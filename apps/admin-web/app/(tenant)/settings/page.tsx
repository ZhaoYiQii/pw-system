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
import { Input } from "@/components/ui/input";
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
import { TenantShell } from "../../_lib/tenant-shell";

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

function Inner() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<TenantConfigV1>(DEFAULT_CONFIG);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const effectiveQuery = useQuery({
    queryKey: ["settings", "effective"],
    queryFn: () => apiFetch<EffectiveConfig>("/api/v1/tenant/config"),
  });
  const versionsQuery = useQuery({
    queryKey: ["settings", "versions"],
    queryFn: () =>
      apiFetch<ConfigVersionRow[]>("/api/v1/tenant/config/versions"),
  });
  const featuresQuery = useQuery({
    queryKey: ["settings", "features"],
    queryFn: () => apiFetch<FeatureState[]>("/api/v1/tenant/features"),
  });

  const effective = effectiveQuery.data ?? null;
  const versions = versionsQuery.data ?? [];
  const addons = (featuresQuery.data ?? []).filter((f) => !f.core);

  useEffect(() => {
    if (!dirty && effective?.config) setForm(effective.config);
  }, [dirty, effective]);

  const invalidMessage = (): string | null => {
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

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ["settings"] });

  const save = useMutation({
    mutationFn: () =>
      apiFetch<EffectiveConfig>("/api/v1/tenant/config", {
        method: "POST",
        body: JSON.stringify({ config: form }),
      }),
    onSuccess: (cfg) => {
      setDirty(false);
      setNotice(`配置已保存并生效（版本 v${cfg.version}）。`);
      refresh();
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });

  const rollback = useMutation({
    mutationFn: () =>
      apiFetch<EffectiveConfig>("/api/v1/tenant/config/rollback", {
        method: "POST",
      }),
    onSuccess: (cfg) => {
      setDirty(false);
      setNotice(`已回滚到上一版本（当前 v${cfg.version}）。`);
      refresh();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409)
        setMessage("没有可回滚的上一版本。");
      else setMessage(e instanceof Error ? e.message : String(e));
    },
  });

  const submitSave = () => {
    const invalid = invalidMessage();
    setMessage(invalid);
    if (invalid) return;
    save.mutate();
  };

  if (
    effectiveQuery.error instanceof ApiError &&
    effectiveQuery.error.status === 401
  ) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>尚未登录门店账号</CardTitle>
          <CardDescription>请先以门店角色登录。</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/store/login">去登录</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (effectiveQuery.isPending || !effective) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">加载中…</p>
    );
  }

  const configError = effective.status === "CONFIG_ERROR";
  const canRollback = versions.length > 1;
  const busy = save.isPending || rollback.isPending;

  return (
    <div className="flex flex-col gap-6">
      {configError ? (
        <p className="text-sm text-destructive">
          当前配置异常（CONFIG_ERROR），门店前台暂不可用。请修正后保存，或回滚到上一有效版本。
        </p>
      ) : null}
      {message ? <p className="text-sm text-destructive">{message}</p> : null}
      {notice ? <p className="text-sm text-emerald-600">{notice}</p> : null}
      {effectiveQuery.isError ? (
        <p className="text-sm text-destructive">
          加载失败：
          {effectiveQuery.error instanceof Error
            ? effectiveQuery.error.message
            : String(effectiveQuery.error)}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>品牌与前台</CardTitle>
              <CardDescription>
                当前生效版本 v{effective.version}
                {effective.hasSaved ? "" : "（默认配置，尚未保存）"}。
                品牌主题仅允许受限 design token，不接收任意 HTML/CSS/JS。
              </CardDescription>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="outline"
                disabled={busy || !canRollback}
                title={canRollback ? "" : "需要至少两个版本"}
                onClick={() => rollback.mutate()}
              >
                回滚上一版本
              </Button>
              <Button disabled={busy} onClick={submitSave}>
                {busy ? "处理中…" : "保存并生效"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="primaryColor">
                主色
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id="primaryColor"
                  type="color"
                  className="h-9 w-16 p-1"
                  value={form.brand.primaryColor}
                  onChange={(e) => {
                    setDirty(true);
                    setForm({
                      ...form,
                      brand: { ...form.brand, primaryColor: e.target.value },
                    });
                  }}
                />
                <span className="text-sm text-muted-foreground">
                  {form.brand.primaryColor}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="accentColor">
                辅色
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id="accentColor"
                  type="color"
                  className="h-9 w-16 p-1"
                  value={form.brand.accentColor}
                  onChange={(e) => {
                    setDirty(true);
                    setForm({
                      ...form,
                      brand: { ...form.brand, accentColor: e.target.value },
                    });
                  }}
                />
                <span className="text-sm text-muted-foreground">
                  {form.brand.accentColor}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="logoText">
                门店文字（1-40 字符）
              </label>
              <Input
                id="logoText"
                maxLength={40}
                value={form.brand.logoText}
                onChange={(e) => {
                  setDirty(true);
                  setForm({
                    ...form,
                    brand: { ...form.brand, logoText: e.target.value },
                  });
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="borderRadius">
                圆角（0-24 px）
              </label>
              <Input
                id="borderRadius"
                type="number"
                min={0}
                max={24}
                step={1}
                value={form.brand.borderRadius}
                onChange={(e) => {
                  setDirty(true);
                  setForm({
                    ...form,
                    brand: {
                      ...form.brand,
                      borderRadius: Number(e.target.value),
                    },
                  });
                }}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.storefront.allowCustomerSelection}
              onChange={(e) => {
                setDirty(true);
                setForm({
                  ...form,
                  storefront: {
                    ...form.storefront,
                    allowCustomerSelection: e.target.checked,
                  },
                });
              }}
            />
            前台允许客户自选陪玩
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.storefront.showServiceDuration}
              onChange={(e) => {
                setDirty(true);
                setForm({
                  ...form,
                  storefront: {
                    ...form.storefront,
                    showServiceDuration: e.target.checked,
                  },
                });
              }}
            />
            前台展示服务时长
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>配置版本历史</CardTitle>
          <CardDescription>
            每次保存生成新版本；回滚将上一版本重新置为生效。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {versions.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              暂无保存记录（当前使用平台默认配置）。
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>版本</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>保存时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>v{row.version}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          row.status === "ACTIVE"
                            ? "default"
                            : row.status === "CONFIG_ERROR"
                              ? "destructive"
                              : "outline"
                        }
                      >
                        {row.status === "ACTIVE"
                          ? "当前生效"
                          : row.status === "CONFIG_ERROR"
                            ? "配置异常"
                            : "历史版本"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(row.createdAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>增值功能（只读）</CardTitle>
          <CardDescription>
            增值功能由平台在「套餐与增值功能」中开通/关闭，这里仅展示当前状态。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {addons.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              暂无增值功能。
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>功能</TableHead>
                  <TableHead>说明</TableHead>
                  <TableHead>状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {addons.map((f) => (
                  <TableRow key={f.featureKey}>
                    <TableCell className="font-medium">
                      {featureLabel(f.featureKey)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {featureDescription(f.featureKey)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={f.enabled ? "default" : "outline"}>
                        {f.enabled ? "已开通" : "未开通"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function TenantSettingsPage() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <TenantShell>
      <h1 className="text-2xl font-semibold tracking-tight">门店设置</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        品牌主题、前台选项与增值功能状态。
      </p>
      <div className="mt-6">
        <QueryClientProvider client={queryClient}>
          <Inner />
        </QueryClientProvider>
      </div>
    </TenantShell>
  );
}

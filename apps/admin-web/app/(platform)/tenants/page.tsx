"use client";

import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { ApiError, apiFetch, clearAccessToken } from "../../_lib/api";

type TenantStatus = "ACTIVE" | "INACTIVE" | "CONFIG_ERROR";

interface TenantRow {
  id: string;
  code: string;
  name: string;
  status: TenantStatus;
  timezone: string;
  createdAt: string;
  primaryHost?: string | null;
}

interface PackageOption {
  code: string;
  name: string;
  addons: string[];
  durationDays: number;
}

interface OnboardResult {
  tenantId: string;
  tenantCode: string;
}

const STATUS_META: Record<
  TenantStatus,
  { text: string; variant: "default" | "outline" | "destructive" }
> = {
  ACTIVE: { text: "正常", variant: "default" },
  INACTIVE: { text: "已停用", variant: "outline" },
  CONFIG_ERROR: { text: "配置错误", variant: "destructive" },
};

function defaultHostFor(code: string): string {
  const c = code.trim().toLowerCase();
  return c ? `${c}.example.com` : "";
}

function primaryDomainHref(host: string): string {
  return /^https?:\/\//i.test(host) ? host : `https://${host}`;
}

function Inner() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [ownerUsername, setOwnerUsername] = useState("owner");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [packageCode, setPackageCode] = useState("BASIC");
  const [brandPrimary, setBrandPrimary] = useState("#2f54eb");
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const tenantsQuery = useQuery({
    queryKey: ["platform-tenants"],
    queryFn: () => apiFetch<TenantRow[]>("/api/v1/platform/tenants"),
  });

  const packagesQuery = useQuery({
    queryKey: ["platform-packages"],
    queryFn: () => apiFetch<PackageOption[]>("/api/v1/platform/packages"),
  });

  const onboard = useMutation({
    mutationFn: (): Promise<OnboardResult> => {
      const resolvedHost =
        host.trim() !== "" ? host.trim() : defaultHostFor(code);
      return apiFetch<OnboardResult>("/api/v1/platform/onboarding/tenants", {
        method: "POST",
        body: JSON.stringify({
          code: code.trim(),
          name: name.trim(),
          host: resolvedHost,
          ownerUsername: ownerUsername.trim(),
          ownerPassword,
          brandPrimary,
          packageCode,
        }),
      });
    },
    onSuccess: () => {
      setNotice(
        `已开通门店「${code.trim()}」。店主账号 ${ownerUsername.trim()} 可用同一密码在商家端登录。`,
      );
      setCode("");
      setName("");
      setHost("");
      setOwnerPassword("");
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: ["platform-tenants"] });
      void queryClient.invalidateQueries({ queryKey: ["platform-packages"] });
    },
    onError: (error) =>
      setFormError(error instanceof Error ? error.message : String(error)),
  });

  const deactivate = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiFetch<unknown>(`/api/v1/platform/tenants/${id}/deactivate`, {
        method: "POST",
      }),
    onSuccess: () => {
      setNotice("门店已停用。");
      void queryClient.invalidateQueries({ queryKey: ["platform-tenants"] });
    },
    onError: (error) =>
      setFormError(error instanceof Error ? error.message : String(error)),
  });

  const queryError =
    tenantsQuery.error instanceof ApiError ? tenantsQuery.error : null;

  const logout = () => {
    clearAccessToken();
    router.push("/login");
  };

  if (queryError?.status === 401) {
    return (
      <main className="min-h-screen bg-[#f4f5f7]">
        <PlatformHeader onLogout={logout} />
        <div className="mx-auto max-w-6xl px-6 py-8">
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
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f4f5f7]">
      <PlatformHeader onLogout={logout} />
      <div className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">平台租户</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          一键开通门店、停用门店，或进入门店开通增值功能。
        </p>

        <div className="mt-6 flex flex-col gap-6">
          {notice ? <p className="text-sm text-emerald-600">{notice}</p> : null}
          {formError ? (
            <p className="text-sm text-destructive">{formError}</p>
          ) : null}
          {tenantsQuery.isError && queryError ? (
            <p className="text-sm text-destructive">
              加载失败：
              {queryError.message}（请确认 API 已启动）
            </p>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>一键开通新门店</CardTitle>
              <CardDescription>
                一次创建租户、店主账号、域名、品牌与套餐，店主可直接登录商家端。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-4 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!code.trim() || !name.trim() || ownerPassword.length < 8)
                    return;
                  onboard.mutate();
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium" htmlFor="code">
                    门店 code
                  </label>
                  <Input
                    id="code"
                    placeholder="如 lol01"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    小写字母/数字开头，2–32 位，全局唯一。
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium" htmlFor="name">
                    门店名称
                  </label>
                  <Input
                    id="name"
                    placeholder="如 西西 Club"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium" htmlFor="host">
                    主域名（H5 前台）
                  </label>
                  <Input
                    id="host"
                    placeholder={defaultHostFor(code) || "shop.example.com"}
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    留空将自动生成{" "}
                    {defaultHostFor(code) || "{code}.example.com"}。
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium" htmlFor="owner">
                    店主账号
                  </label>
                  <Input
                    id="owner"
                    value={ownerUsername}
                    onChange={(e) => setOwnerUsername(e.target.value)}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    店主用此账号登录商家端。
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium" htmlFor="password">
                    店主密码
                  </label>
                  <Input
                    id="password"
                    type="password"
                    value={ownerPassword}
                    onChange={(e) => setOwnerPassword(e.target.value)}
                    minLength={8}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    至少 8 位；请平台直接交付给店主。
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium" htmlFor="package">
                    开通套餐
                  </label>
                  <select
                    id="package"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                    value={packageCode}
                    onChange={(e) => setPackageCode(e.target.value)}
                  >
                    {(packagesQuery.data ?? []).map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.name}（{p.durationDays} 天）
                      </option>
                    ))}
                  </select>
                  {packagesQuery.isError ? (
                    <p className="text-xs text-destructive">
                      套餐加载失败，默认使用基础版。
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium" htmlFor="brand">
                    品牌主色（H5）
                  </label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="brand"
                      type="color"
                      className="h-9 w-16 p-1"
                      value={brandPrimary}
                      onChange={(e) => setBrandPrimary(e.target.value)}
                    />
                    <span className="text-sm text-muted-foreground">
                      {brandPrimary}
                    </span>
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <Button
                    type="submit"
                    disabled={
                      onboard.isPending ||
                      !code.trim() ||
                      !name.trim() ||
                      ownerPassword.length < 8
                    }
                  >
                    {onboard.isPending ? "开通中…" : "一键开通"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                门店列表（{tenantsQuery.data?.length ?? 0}）
              </CardTitle>
              <CardDescription>
                开通后店主可登录商家端开始使用。
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tenantsQuery.isPending ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  加载中…
                </p>
              ) : null}
              {!tenantsQuery.isPending && tenantsQuery.data?.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  暂无门店，请先一键开通。
                </p>
              ) : null}
              {tenantsQuery.data && tenantsQuery.data.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>code</TableHead>
                      <TableHead>名称</TableHead>
                      <TableHead>主域名</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>时区</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tenantsQuery.data.map((tenant) => {
                      const meta =
                        STATUS_META[tenant.status] ?? STATUS_META.INACTIVE;
                      return (
                        <TableRow key={tenant.id}>
                          <TableCell className="font-medium">
                            {tenant.code}
                          </TableCell>
                          <TableCell>{tenant.name}</TableCell>
                          <TableCell className="max-w-[240px]">
                            {tenant.primaryHost ? (
                              <a
                                href={primaryDomainHref(tenant.primaryHost)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="break-all text-sky-600 hover:underline"
                              >
                                {tenant.primaryHost}
                              </a>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={meta.variant}>{meta.text}</Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {tenant.timezone}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button asChild variant="outline" size="sm">
                                <Link href={`/packages?tenantId=${tenant.id}`}>
                                  套餐/功能
                                </Link>
                              </Button>
                              {tenant.status === "ACTIVE" ? (
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  disabled={deactivate.isPending}
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        `确认停用门店「${tenant.name}」？停用后其 H5 前台将不可用。`,
                                      )
                                    ) {
                                      setFormError(null);
                                      deactivate.mutate({ id: tenant.id });
                                    }
                                  }}
                                >
                                  停用
                                </Button>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}

function PlatformHeader({ onLogout }: { onLogout: () => void }) {
  return (
    <header className="flex items-center gap-5 border-b bg-white px-6 py-3">
      <span className="font-semibold">PW SaaS</span>
      <nav className="flex items-center gap-4 text-sm">
        <Link href="/tenants" className="font-medium text-foreground">
          租户管理
        </Link>
        <Link
          href="/packages"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          套餐与功能
        </Link>
      </nav>
      <span className="flex-1" />
      <Button variant="outline" size="sm" onClick={onLogout}>
        退出
      </Button>
    </header>
  );
}

export default function PlatformTenantsPage() {
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

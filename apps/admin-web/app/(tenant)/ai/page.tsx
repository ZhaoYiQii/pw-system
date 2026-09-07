"use client";

import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import Link from "next/link";
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

interface FeatureRow {
  featureKey: string;
  enabled: boolean;
}

function Inner() {
  const overview = useQuery({
    queryKey: ["ai", "overview"],
    queryFn: async () => {
      const [features, capabilities] = await Promise.all([
        apiFetch<FeatureRow[]>("/api/v1/tenant/features"),
        apiFetch<{
          supported: boolean;
          provider?: string;
          reason?: string;
        }>("/api/v1/tenant/ai/capabilities"),
      ]);
      return { features, capabilities };
    },
  });

  if (overview.error instanceof ApiError && overview.error.status === 401) {
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

  const aiFeatures = (overview.data?.features ?? []).filter((f) =>
    f.featureKey.startsWith("addon.ai_"),
  );

  return (
    <div className="flex flex-col gap-6">
      {overview.isError ? (
        <p className="text-sm text-destructive">
          加载失败：
          {overview.error instanceof Error
            ? overview.error.message
            : String(overview.error)}
        </p>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>AI 能力</CardTitle>
          <CardDescription>
            未配置服务商时明确提示不可用，不伪装成功。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {overview.isPending ? (
            <p className="text-sm text-muted-foreground">加载中…</p>
          ) : (
            <p className="text-sm">
              {overview.data?.capabilities.supported
                ? `可用（服务商：${overview.data.capabilities.provider ?? "-"}）`
                : `不可用：${overview.data?.capabilities.reason ?? "未配置"}`}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI 增值功能（只读）</CardTitle>
          <CardDescription>开通由平台在套餐与增值功能中管理。</CardDescription>
        </CardHeader>
        <CardContent>
          {aiFeatures.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              尚未开通 AI 增值功能，可让平台方在“套餐与增值功能”页开通。
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
                {aiFeatures.map((f) => (
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

export default function AiPage() {
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
      <h1 className="text-2xl font-semibold tracking-tight">AI 需求助手</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        查看 AI 能力与增值功能开通状态。
      </p>
      <div className="mt-6">
        <QueryClientProvider client={queryClient}>
          <Inner />
        </QueryClientProvider>
      </div>
    </TenantShell>
  );
}

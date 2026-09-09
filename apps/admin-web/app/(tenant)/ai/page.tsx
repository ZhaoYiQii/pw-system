"use client";

import {
  QueryClient,
  QueryClientProvider,
  useMutation,
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
import { Input } from "@/components/ui/input";
import { ApiError, apiFetch } from "../../_lib/api";
import { TenantShell } from "../../_lib/tenant-shell";

interface FeatureRow {
  featureKey: string;
  enabled: boolean;
}

interface Capabilities {
  supported: boolean;
  provider?: string;
  reason?: string;
}

interface ProductOption {
  id: string;
  name: string;
  enabled: boolean;
}

interface PricingOption {
  id: string;
  durationSeconds: number;
  enabled: boolean;
}

interface ParseResult {
  runId: string;
  missing: string[];
  confidenceBp: number;
  status: string;
  note: string;
}

const MISSING_LABELS: Record<string, string> = {
  description: "需求描述",
  serviceProductId: "服务项目",
  durationSeconds: "服务时长",
  desiredStartAt: "期望开始时间",
};

function Inner() {
  const [description, setDescription] = useState("");
  const [productId, setProductId] = useState("");
  const [durationSeconds, setDurationSeconds] = useState("");
  const [desiredStart, setDesiredStart] = useState("");
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const overview = useQuery({
    queryKey: ["ai", "overview"],
    queryFn: async () => {
      const [features, capabilities, products] = await Promise.all([
        apiFetch<FeatureRow[]>("/api/v1/tenant/features"),
        apiFetch<Capabilities>("/api/v1/tenant/ai/capabilities"),
        apiFetch<ProductOption[]>("/api/v1/tenant/catalog/products"),
      ]);
      return { features, capabilities, products };
    },
  });

  const pricingQuery = useQuery({
    queryKey: ["ai", "pricing", productId],
    queryFn: () =>
      apiFetch<PricingOption[]>(
        `/api/v1/tenant/catalog/products/${productId}/pricing`,
      ),
    enabled: productId !== "",
  });

  const parse = useMutation({
    mutationFn: () =>
      apiFetch<ParseResult>("/api/v1/tenant/ai/parse-requirement", {
        method: "POST",
        body: JSON.stringify({
          description,
          serviceProductId: productId || null,
          durationSeconds: durationSeconds ? Number(durationSeconds) : null,
          desiredStartAt: desiredStart
            ? new Date(desiredStart).toISOString()
            : null,
        }),
      }),
    onSuccess: (result) => {
      setMessage(null);
      setParseResult(result);
    },
    onError: (error) => {
      setParseResult(null);
      setMessage(error instanceof Error ? error.message : String(error));
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

  const features = overview.data?.features ?? [];
  const aiEnabled = features.find(
    (f) => f.featureKey === "addon.ai_requirement_parser",
  )?.enabled;
  const capabilities = overview.data?.capabilities;
  const products = (overview.data?.products ?? []).filter((p) => p.enabled);
  const durations = (pricingQuery.data ?? []).filter((d) => d.enabled);
  const ready = parseResult?.missing.length === 0;

  return (
    <div className="flex flex-col gap-6">
      {message ? <p className="text-sm text-destructive">{message}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>AI 能力</CardTitle>
          <CardDescription>
            未配置外部 AI 服务商时，仅做本地结构化校验并明确标注，不伪造智能生成。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Badge variant={capabilities?.supported ? "default" : "outline"}>
            {capabilities?.supported
              ? `外部 AI：${capabilities.provider ?? "-"}`
              : "本地确定性预检"}
          </Badge>
          <Badge variant={aiEnabled ? "default" : "outline"}>
            {aiEnabled ? "AI 需求解析已开通" : "AI 需求解析未开通"}
          </Badge>
          {!capabilities?.supported ? (
            <span className="text-xs text-muted-foreground">
              {capabilities?.reason ?? "未配置 AI Provider"}
            </span>
          ) : null}
        </CardContent>
      </Card>

      {aiEnabled ? (
        <Card>
          <CardHeader>
            <CardTitle>需求解析预览</CardTitle>
            <CardDescription>
              粘贴客户需求并补充结构化字段；解析结果只作为建议，创建订单前必须人工确认。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">客户需求描述 *</span>
              <textarea
                className="min-h-28 rounded-md border bg-background p-2 text-sm"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="例如：今晚 8 点王者荣耀五排，打 3 小时，找两个陪玩……"
              />
            </label>
            <div className="grid gap-4 md:grid-cols-3">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">服务项目</span>
                <select
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                  value={productId}
                  onChange={(event) => {
                    setProductId(event.target.value);
                    setDurationSeconds("");
                  }}
                >
                  <option value="">请选择…</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">服务时长</span>
                <select
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                  value={durationSeconds}
                  onChange={(event) => setDurationSeconds(event.target.value)}
                  disabled={!productId}
                >
                  <option value="">先选服务项目…</option>
                  {durations.map((pricing) => (
                    <option
                      key={pricing.id}
                      value={String(pricing.durationSeconds)}
                    >
                      {Math.round(pricing.durationSeconds / 60)} 分钟
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">期望开始时间</span>
                <Input
                  type="datetime-local"
                  value={desiredStart}
                  onChange={(event) => setDesiredStart(event.target.value)}
                />
              </label>
            </div>
            <div>
              <Button
                disabled={parse.isPending || description.trim().length === 0}
                onClick={() => parse.mutate()}
              >
                {parse.isPending ? "解析中…" : "解析为结构化建议"}
              </Button>
            </div>

            {parseResult ? (
              <div className="rounded-md border bg-muted/30 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant={ready ? "default" : "outline"}>
                    {ready ? "字段完整" : "缺少必要需求"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    置信度 {Math.round(parseResult.confidenceBp / 100)}% ·{" "}
                    {parseResult.status}
                  </span>
                </div>
                <p className="mt-3 text-sm">{parseResult.note}</p>
                {parseResult.missing.length > 0 ? (
                  <ul className="mt-2 flex flex-wrap gap-2 text-xs">
                    {parseResult.missing.map((key) => (
                      <li key={key}>
                        <Badge variant="outline">
                          缺 {MISSING_LABELS[key] ?? key}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {ready ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button asChild size="sm">
                      <Link href="/game-dispatch/new">
                        带入新建派单（默认主流程）
                      </Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link href="/orders">去订单台账确认</Link>
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>AI 需求解析未开通</CardTitle>
            <CardDescription>
              请让平台方在「套餐与增值功能」中为门店开启
              addon.ai_requirement_parser。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" asChild>
              <Link href="/settings">前往门店设置查看增值功能</Link>
            </Button>
          </CardContent>
        </Card>
      )}
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
        粘贴需求 → 结构化解析预览 → 人工确认后创建订单草稿。
      </p>
      <div className="mt-6">
        <QueryClientProvider client={queryClient}>
          <Inner />
        </QueryClientProvider>
      </div>
    </TenantShell>
  );
}

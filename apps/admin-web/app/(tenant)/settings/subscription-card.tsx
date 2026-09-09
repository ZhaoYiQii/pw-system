"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { apiFetch } from "../../_lib/api";

interface SubscriptionView {
  id: string;
  packageCode: string;
  status: string;
  startsAt: string;
  endsAt: string | null;
}

interface FeatureState {
  featureKey: string;
  core: boolean;
  enabled: boolean;
}

interface Me {
  role: string;
  username: string;
}

const PACKAGE_LABELS: Record<string, string> = {
  BASIC: "基础版",
  PRO: "专业版",
  PREMIUM: "旗舰版",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("zh-CN", { hour12: false });
}

export function SubscriptionCard() {
  const subscriptionQuery = useQuery({
    queryKey: ["settings", "subscription"],
    queryFn: () =>
      apiFetch<SubscriptionView | null>("/api/v1/tenant/subscription"),
  });
  const featuresQuery = useQuery({
    queryKey: ["settings", "features"],
    queryFn: () => apiFetch<FeatureState[]>("/api/v1/tenant/features"),
  });
  const meQuery = useQuery({
    queryKey: ["settings", "me"],
    queryFn: () => apiFetch<Me>("/api/v1/tenant/me"),
  });

  const subscription = subscriptionQuery.data;
  const addonCount = (featuresQuery.data ?? []).filter(
    (feature: FeatureState) => !feature.core && feature.enabled,
  ).length;
  const role = meQuery.data?.role;
  const expired =
    subscription?.endsAt !== null &&
    subscription?.endsAt !== undefined &&
    new Date(subscription.endsAt).getTime() < Date.now();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>套餐与订阅</CardTitle>
            <CardDescription>
              当前套餐周期与增值功能状态；续费/换套餐由平台端处理。
            </CardDescription>
          </div>
          {subscription ? (
            <Badge variant={expired ? "destructive" : "default"}>
              {expired
                ? "已到期"
                : subscription.status === "ACTIVE"
                  ? "生效中"
                  : subscription.status}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {subscriptionQuery.isPending ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            加载中…
          </p>
        ) : subscription ? (
          <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-muted-foreground">套餐</p>
              <p className="mt-1 font-medium">
                {PACKAGE_LABELS[subscription.packageCode] ??
                  subscription.packageCode}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">生效时间</p>
              <p className="mt-1 font-medium tabular-nums">
                {formatDate(subscription.startsAt)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">到期时间</p>
              <p className="mt-1 font-medium tabular-nums">
                {formatDate(subscription.endsAt)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">已开通增值功能</p>
              <p className="mt-1 font-medium tabular-nums">{addonCount} 项</p>
            </div>
          </div>
        ) : (
          <p className="py-4 text-center text-sm text-muted-foreground">
            暂无生效订阅，请联系平台开通套餐。
          </p>
        )}
        {subscriptionQuery.isError ? (
          <p className="mt-3 text-sm text-destructive">
            加载失败：
            {subscriptionQuery.error instanceof Error
              ? subscriptionQuery.error.message
              : String(subscriptionQuery.error)}
          </p>
        ) : null}
        <div className="mt-4 flex items-center justify-between gap-3 border-t pt-4 text-xs text-muted-foreground">
          <span>
            当前登录角色：{role ?? "加载中…"} · 增值功能变更需平台操作。
          </span>
          <Button variant="outline" size="sm" asChild>
            <a href="#addons">查看增值功能</a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

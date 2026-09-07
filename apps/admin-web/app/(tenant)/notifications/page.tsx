"use client";

import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ApiError, apiFetch } from "../../_lib/api";
import { TenantShell } from "../../_lib/tenant-shell";

interface NotificationRow {
  id: string;
  title: string | null;
  content: string;
  readAt: string | null;
  createdAt: string;
}

function Inner() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const rowsQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiFetch<NotificationRow[]>("/api/v1/tenant/notifications"),
  });

  const markRead = useMutation({
    mutationFn: (id: string) =>
      apiFetch<unknown>(`/api/v1/tenant/notifications/${id}/read`, {
        method: "POST",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });

  const markAll = useMutation({
    mutationFn: () =>
      apiFetch<{ updated: number }>("/api/v1/tenant/notifications/read-all", {
        method: "POST",
      }),
    onSuccess: (res) => {
      setNotice(`已将 ${res.updated} 条通知标记为已读。`);
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });

  const unauthorized =
    rowsQuery.error instanceof ApiError && rowsQuery.error.status === 401;
  if (unauthorized) {
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

  return (
    <div className="flex flex-col gap-6">
      {notice ? <p className="text-sm text-emerald-600">{notice}</p> : null}
      {message ? <p className="text-sm text-destructive">{message}</p> : null}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>站内通知</CardTitle>
              <CardDescription>
                订单状态事件推送；支持单项/全部标记已读。
              </CardDescription>
            </div>
            <Button
              variant="outline"
              disabled={markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              全部已读
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {rowsQuery.isPending ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              加载中…
            </p>
          ) : null}
          {rowsQuery.isError && !unauthorized ? (
            <p className="text-sm text-destructive">
              加载失败：
              {rowsQuery.error instanceof Error
                ? rowsQuery.error.message
                : String(rowsQuery.error)}
            </p>
          ) : null}
          {!rowsQuery.isPending && rowsQuery.data?.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              暂无通知。
            </p>
          ) : null}
          <div className="flex flex-col divide-y">
            {(rowsQuery.data ?? []).map((n) => (
              <div
                key={n.id}
                className={`flex items-start justify-between gap-4 py-3 ${
                  n.readAt ? "opacity-70" : ""
                }`}
              >
                <div className="min-w-0">
                  <p className="font-medium">{n.title ?? "系统通知"}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {n.content}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(n.createdAt).toLocaleString()}
                    {n.readAt ? " · 已读" : " · 未读"}
                  </p>
                </div>
                {!n.readAt ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={markRead.isPending}
                    onClick={() => markRead.mutate(n.id)}
                  >
                    标为已读
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function NotificationsPage() {
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
      <h1 className="text-2xl font-semibold tracking-tight">站内通知</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        门店关键操作与订单状态推送。
      </p>
      <div className="mt-6">
        <QueryClientProvider client={queryClient}>
          <Inner />
        </QueryClientProvider>
      </div>
    </TenantShell>
  );
}

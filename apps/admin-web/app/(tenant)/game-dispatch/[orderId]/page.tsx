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
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ApiError, apiFetch } from "../../../_lib/api";
import { TenantNav } from "../../../_lib/tenant-nav";

interface AppView {
  id: string;
  playerName: string;
  status: string;
  createdAt: string;
}
interface LineView {
  id: string;
  positionLabel: string;
  requiredCount: number;
  applications: AppView[];
}
interface DispatchDetail {
  dispatchNo: string;
  status: string;
  copyText: string;
  applyUrl: string;
  bossUrl: string;
  lines: LineView[];
  round: { roundNo: number; closesAt: string; status: string } | null;
}

function Inner({ orderId }: { orderId: string }) {
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ["game-dispatch-detail", orderId],
    queryFn: () =>
      apiFetch<DispatchDetail>(
        `/api/v1/tenant/game-dispatch/orders/${orderId}`,
      ),
  });

  const removeApp = useMutation({
    mutationFn: (id: string) =>
      apiFetch<unknown>(`/api/v1/tenant/game-dispatch/applications/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      setMessage("已移除该报名。");
      void queryClient.invalidateQueries({
        queryKey: ["game-dispatch-detail", orderId],
      });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });

  const assign = useMutation({
    mutationFn: () =>
      apiFetch<DispatchDetail>(
        `/api/v1/tenant/game-dispatch/orders/${orderId}/assignment`,
        {
          method: "POST",
          body: JSON.stringify({ applicationIds: Array.from(checked) }),
        },
      ),
    onSuccess: () => {
      setMessage("已确认选中，可复制选定文案并 @ 对应陪玩。");
      setChecked(new Set());
      void queryClient.invalidateQueries({
        queryKey: ["game-dispatch-detail", orderId],
      });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });

  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.copyText);
      setMessage("群文案已复制，可直接粘贴到陪玩群。");
    } catch {
      setMessage("复制失败，请手动选择文本复制。");
    }
  };

  if (isError) {
    return error instanceof ApiError && error.status === 401 ? (
      <Button asChild variant="outline">
        <Link href="/store/login">去登录</Link>
      </Button>
    ) : (
      <p className="text-sm text-destructive">
        加载失败：{error instanceof Error ? error.message : String(error)}
      </p>
    );
  }
  if (isPending || !data) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">加载中…</p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {message ? <p className="text-sm text-emerald-600">{message}</p> : null}
      <Card>
        <CardHeader>
          <CardTitle>{data.dispatchNo}</CardTitle>
          <CardDescription>
            复制后发到陪玩群；老板选人链接可转发给老板。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <pre className="whitespace-pre-wrap rounded-md bg-muted p-4 text-sm">
            {data.copyText}
          </pre>
          {data.applyUrl ? (
            <p className="break-all text-xs text-muted-foreground">
              报名链接：{data.applyUrl}
            </p>
          ) : null}
          {data.bossUrl ? (
            <p className="break-all text-xs text-muted-foreground">
              老板选人链接：{data.bossUrl}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void copy()}>复制群文案</Button>
            <Button
              variant="outline"
              onClick={() =>
                void queryClient.invalidateQueries({
                  queryKey: ["game-dispatch-detail", orderId],
                })
              }
            >
              刷新报名
            </Button>
            <Button asChild variant="ghost">
              <Link href="/game-dispatch">返回列表</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {data.lines.map((line) => {
        const remaining = line.requiredCount - checked.size;
        return (
          <Card key={line.id}>
            <CardHeader>
              <CardTitle>
                {line.positionLabel}（需 {line.requiredCount} 人）
              </CardTitle>
              <CardDescription>
                {remaining > 0 ? `还差 ${remaining} 人` : "人数已足够"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {line.applications.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">暂无报名。</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {line.applications.map((app) => (
                    <div
                      key={app.id}
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                    >
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          disabled={
                            app.status !== "APPLIED" ||
                            data.status !== "DISPATCHING"
                          }
                          checked={checked.has(app.id)}
                          onChange={(e) => {
                            const next = new Set(checked);
                            if (e.target.checked) next.add(app.id);
                            else next.delete(app.id);
                            setChecked(next);
                          }}
                        />
                        <span className="font-medium">{app.playerName}</span>
                        <span className="text-xs text-muted-foreground">
                          {app.status === "APPLIED" ? "已报名" : app.status}
                        </span>
                      </label>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={
                          app.status !== "APPLIED" || removeApp.isPending
                        }
                        onClick={() => removeApp.mutate(app.id)}
                      >
                        移除报名
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
      <div>
        <Button
          disabled={
            checked.size === 0 ||
            data.status !== "DISPATCHING" ||
            assign.isPending
          }
          onClick={() => assign.mutate()}
        >
          确认选中的陪玩
        </Button>
      </div>
    </div>
  );
}

export default function GameDispatchDetailPage() {
  const params = useParams<{ orderId: string }>();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <main className="min-h-screen bg-[#f4f5f7]">
      <TenantNav />
      <div className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">派单详情</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          复制群文案、刷新报名并确认陪玩。
        </p>
        <div className="mt-6">
          <QueryClientProvider client={queryClient}>
            <Inner orderId={params.orderId} />
          </QueryClientProvider>
        </div>
      </div>
    </main>
  );
}

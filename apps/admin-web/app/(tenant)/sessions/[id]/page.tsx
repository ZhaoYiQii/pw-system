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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ApiError, apiFetch, getAccessToken } from "../../../_lib/api";
import { TenantShell } from "../../../_lib/tenant-shell";

interface SessionEvent {
  id: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  occurredAt: string;
}

interface SessionEvidence {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string | null;
  createdAt: string;
}

interface SessionAdjustment {
  id: string;
  originalDurationSeconds: number;
  requestedDurationSeconds: number;
  reason: string;
  status: string;
}

interface SessionDetail {
  id: string;
  flow: "CLASSIC" | "GAME_DISPATCH";
  slotId: string | null;
  orderId: string;
  playerId: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  events: SessionEvent[];
  evidence: SessionEvidence[];
  adjustments: SessionAdjustment[];
}

const API_ORIGIN =
  process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://127.0.0.1:3000";

const STATUS_TEXT: Record<string, string> = {
  SCHEDULED: "待开始",
  STARTED: "进行中",
  ENDED: "已结束",
  ADJUSTMENT_PENDING: "调整待复核",
  CONFIRMED: "已确认",
};

const EVENT_TEXT: Record<string, string> = {
  SESSION_STARTED: "场次开始",
  SESSION_ENDED: "场次结束",
  SESSION_CONFIRMED: "场次确认",
  SESSION_ADJUSTMENT_REJECTED: "调整被驳回",
  SLOT_SESSION_STARTED: "档位场次开始",
  SLOT_SESSION_ENDED: "档位场次结束",
};

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "-";
  const m = Math.floor(seconds / 60);
  return `${m} 分 ${seconds % 60} 秒`;
}

function Inner({ sessionId }: { sessionId: string }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isPending, isError, error: queryError } = useQuery({
    queryKey: ["session-detail", sessionId],
    queryFn: () =>
      apiFetch<SessionDetail>(`/api/v1/tenant/sessions/${sessionId}`),
  });

  const refresh = () => {
    setError(null);
    setMessage(null);
    void queryClient.invalidateQueries({
      queryKey: ["session-detail", sessionId],
    });
  };

  const transition = useMutation({
    mutationFn: (action: "start" | "end") =>
      apiFetch<SessionDetail>(
        `/api/v1/tenant/orders/${data?.orderId as string}/session/${action}`,
        { method: "POST" },
      ),
    onSuccess: () => {
      setMessage("场次状态已更新。");
      refresh();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const reviewAdjustment = useMutation({
    mutationFn: ({
      adjustmentId,
      approve,
    }: {
      adjustmentId: string;
      approve: boolean;
    }) =>
      apiFetch<SessionDetail>(
        `/api/v1/tenant/sessions/${sessionId}/adjustments/${adjustmentId}/review`,
        {
          method: "POST",
          body: JSON.stringify({ approve }),
        },
      ),
    onSuccess: () => {
      setMessage("调整已复核。");
      refresh();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const openEvidence = async (evidence: SessionEvidence) => {
    setError(null);
    try {
      const headers = new Headers();
      const token = getAccessToken();
      if (token) headers.set("authorization", `Bearer ${token}`);
      const evidencePath =
        data?.flow === "GAME_DISPATCH"
          ? `/api/v1/tenant/slot-evidence/${evidence.id}`
          : `/api/v1/tenant/evidence/${evidence.id}`;
      const res = await fetch(
        `${API_ORIGIN}${evidencePath}`,
        { headers },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(
        `证据打开失败：${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  if (queryError instanceof ApiError && queryError.status === 401) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>尚未登录门店账号</CardTitle>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/store/login">去登录</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (isError) {
    return (
      <p className="text-sm text-destructive">
        加载失败：
        {queryError instanceof Error
          ? queryError.message
          : String(queryError)}
      </p>
    );
  }
  if (isPending || !data) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        加载中…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {message ? <p className="text-sm text-emerald-600">{message}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            场次详情
            <Badge variant={data.status === "STARTED" ? "default" : "outline"}>
              {STATUS_TEXT[data.status] ?? data.status}
            </Badge>
            <Badge variant={data.flow === "GAME_DISPATCH" ? "outline" : "default"}>
              {data.flow === "GAME_DISPATCH" ? "GD 档位场次" : "CLASSIC"}
            </Badge>
          </CardTitle>
          <CardDescription>
            订单 {data.orderId} · 陪玩 {data.playerId} ·{" "}
            {data.flow === "GAME_DISPATCH"
              ? "证据由 GAME_DISPATCH 档位会话提供"
              : "时长调整可复核"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">开始时间</dt>
              <dd>
                {data.startedAt
                  ? new Date(data.startedAt).toLocaleString()
                  : "-"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">结束时间</dt>
              <dd>
                {data.endedAt ? new Date(data.endedAt).toLocaleString() : "-"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">服务时长</dt>
              <dd>{formatDuration(data.durationSeconds)}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            {data.status === "STARTED" && data.flow === "CLASSIC" ? (
              <Button
                disabled={transition.isPending}
                onClick={() => transition.mutate("end")}
              >
                结束场次
              </Button>
            ) : null}
            {data.flow === "GAME_DISPATCH" ? (
              <Button asChild variant="outline">
                <Link href={`/game-dispatch/${data.orderId}`}>
                  打开派单订单详情
                </Link>
              </Button>
            ) : null}
            <Button variant="outline" onClick={refresh}>
              刷新
            </Button>
            <Button asChild variant="ghost">
              <Link href="/sessions">返回台账</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>事件时间线</CardTitle>
        </CardHeader>
        <CardContent>
          {data.events.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">暂无事件。</p>
          ) : (
            <ol className="space-y-2 text-sm">
              {data.events.map((e) => (
                <li key={e.id} className="flex items-start gap-3">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-muted-foreground/50" />
                  <span>
                    <b>{EVENT_TEXT[e.eventType] ?? e.eventType}</b>
                    <span className="text-muted-foreground">
                      {" "}
                      · {new Date(e.occurredAt).toLocaleString()}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>证据（{data.evidence.length}）</CardTitle>
          <CardDescription>
            点击“查看/下载”将从后端鉴权读取原始文件。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.evidence.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">
              暂无证据。陪玩开始/结束前需上传真实图片或视频。
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {data.evidence.map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {ev.originalName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {ev.mimeType} · {(ev.sizeBytes / 1024).toFixed(0)} KB ·{" "}
                      {new Date(ev.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void openEvidence(ev)}
                  >
                    查看/下载
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>时长调整</CardTitle>
        </CardHeader>
        <CardContent>
          {data.adjustments.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">暂无调整申请。</p>
          ) : (
            <div className="flex flex-col gap-3">
              {data.adjustments.map((a) => (
                <div
                  key={a.id}
                  className="rounded-md border px-3 py-2 text-sm"
                >
                  <p>
                    原 {formatDuration(a.originalDurationSeconds)} → 申请{" "}
                    {formatDuration(a.requestedDurationSeconds)}
                  </p>
                  <p className="text-muted-foreground">{a.reason}</p>
                  <p className="mt-1">
                    <Badge
                      variant={
                        a.status === "APPROVED"
                          ? "default"
                          : a.status === "REJECTED"
                            ? "outline"
                            : "destructive"
                      }
                    >
                      {a.status === "PENDING"
                        ? "待复核"
                        : a.status === "APPROVED"
                          ? "已通过"
                          : "已驳回"}
                    </Badge>
                  </p>
                  {a.status === "PENDING" ? (
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        disabled={reviewAdjustment.isPending}
                        onClick={() =>
                          reviewAdjustment.mutate({
                            adjustmentId: a.id,
                            approve: true,
                          })
                        }
                      >
                        通过调整
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={reviewAdjustment.isPending}
                        onClick={() =>
                          reviewAdjustment.mutate({
                            adjustmentId: a.id,
                            approve: false,
                          })
                        }
                      >
                        驳回
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function SessionDetailPage() {
  const params = useParams<{ id: string }>();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <TenantShell>
      <h1 className="text-2xl font-semibold tracking-tight">场次详情</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        事件时间线、证据查看与时长调整复核。
      </p>
      <div className="mt-6">
        <QueryClientProvider client={queryClient}>
          <Inner sessionId={params.id} />
        </QueryClientProvider>
      </div>
    </TenantShell>
  );
}

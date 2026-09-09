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
import { Input } from "@/components/ui/input";
import { ApiError, apiFetch } from "../../../_lib/api";
import { TenantShell } from "../../../_lib/tenant-shell";
import { formatFenYuan } from "../../../_lib/money";

interface DisputeEvent {
  id: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorType: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
}

interface EarningInfo {
  id: string;
  amountFen: string;
  status: string;
  settlementBatchStatus: string | null;
  settlementBatchNo: string | null;
}

interface DisputeDetail {
  id: string;
  orderId: string;
  orderNo: string;
  playerId: string;
  playerName: string;
  customerProfileId: string;
  customerName: string;
  earningId: string | null;
  earning: EarningInfo | null;
  reason: string;
  status: "OPEN" | "RESOLVED";
  openedBy: string | null;
  resolvedBy: string | null;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
  events: DisputeEvent[];
}

const EVENT_TEXT: Record<string, string> = {
  DISPUTE_OPENED: "争议发起",
  DISPUTE_RESOLVED: "争议处理",
};

function Inner({ disputeId }: { disputeId: string }) {
  const queryClient = useQueryClient();
  const [resolution, setResolution] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isPending, isError, error: queryError } = useQuery({
    queryKey: ["dispute-detail", disputeId],
    queryFn: () => apiFetch<DisputeDetail>(`/api/v1/tenant/disputes/${disputeId}`),
  });

  const resolve = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string; status: string }>(
        `/api/v1/tenant/disputes/${disputeId}/resolve`,
        {
          method: "POST",
          body: JSON.stringify({ resolution }),
        },
      ),
    onSuccess: () => {
      setMessage("争议已处理完成。");
      setResolution("");
      void queryClient.invalidateQueries({
        queryKey: ["dispute-detail", disputeId],
      });
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

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
            争议 {data.orderNo}
            <Badge variant={data.status === "OPEN" ? "destructive" : "default"}>
              {data.status === "OPEN" ? "待处理" : "已处理"}
            </Badge>
          </CardTitle>
          <CardDescription>
            客户 {data.customerName} · 陪玩 {data.playerName}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <p className="font-medium">争议原因</p>
            <p className="mt-1 text-muted-foreground">{data.reason}</p>
          </div>

          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">发起时间</dt>
              <dd>{new Date(data.createdAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">关联订单</dt>
              <dd className="font-mono text-xs">{data.orderNo}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">处理结果</dt>
              <dd>{data.resolution ?? "-"}</dd>
            </div>
          </dl>

          {data.earning ? (
            <div className="rounded-md border px-3 py-2 text-sm">
              <p className="text-muted-foreground">应收与结算冻结</p>
              <p>
                应收金额 {formatFenYuan(data.earning.amountFen)} · earning
                状态 {data.earning.status}
              </p>
              <p>
                结算批次：
                {data.earning.settlementBatchNo
                  ? `${data.earning.settlementBatchNo}（${data.earning.settlementBatchStatus}）`
                  : "未入批次"}
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              未关联独立 earning；争议会阻止同订单应收进入结算。
            </p>
          )}

          {data.status === "OPEN" ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Input
                className="flex-1"
                placeholder="处理结论（会写入时间线并解除/标记争议）"
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
              />
              <Button
                disabled={!resolution.trim() || resolve.isPending}
                onClick={() => resolve.mutate()}
              >
                处理并关闭争议
              </Button>
            </div>
          ) : null}

          <Button asChild variant="ghost">
            <Link href="/disputes">返回争议列表</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>处理时间线</CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
    </div>
  );
}

export default function DisputeDetailPage() {
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
      <h1 className="text-2xl font-semibold tracking-tight">争议详情</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        争议事实、结算冻结状态与处理时间线。
      </p>
      <div className="mt-6">
        <QueryClientProvider client={queryClient}>
          <Inner disputeId={params.id} />
        </QueryClientProvider>
      </div>
    </TenantShell>
  );
}

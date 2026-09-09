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
import { TenantShell } from "../../_lib/tenant-shell";

interface SessionRow {
  id: string;
  flow: "CLASSIC" | "GAME_DISPATCH";
  slotId: string | null;
  orderId: string;
  orderNo: string;
  playerId: string;
  playerName: string;
  customerName: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  evidenceCount: number;
  adjustmentPendingCount: number;
  createdAt: string;
}

const STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "SCHEDULED", label: "待开始" },
  { value: "NOT_STARTED", label: "待开始(GD)" },
  { value: "STARTED", label: "进行中" },
  { value: "ENDED", label: "已结束" },
  { value: "ADJUSTMENT_PENDING", label: "调整待复核" },
  { value: "CONFIRMED", label: "已确认" },
] as const;

const STATUS_TEXT: Record<string, string> = {
  SCHEDULED: "待开始",
  NOT_STARTED: "待开始",
  STARTED: "进行中",
  ENDED: "已结束",
  ADJUSTMENT_PENDING: "调整待复核",
  CONFIRMED: "已确认",
};

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "-";
  const m = Math.floor(seconds / 60);
  return `${m} 分 ${seconds % 60} 秒`;
}

function Inner() {
  const [status, setStatus] = useState("");
  const rowsQuery = useQuery({
    queryKey: ["sessions", status],
    queryFn: () => {
      const query = status ? `?status=${encodeURIComponent(status)}` : "";
      return apiFetch<SessionRow[]>(`/api/v1/tenant/sessions${query}`);
    },
  });

  if (rowsQuery.error instanceof ApiError && rowsQuery.error.status === 401) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>尚未登录门店账号</CardTitle>
          <CardDescription>场次台账需要门店员工权限。</CardDescription>
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
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>场次与证据</CardTitle>
          <CardDescription>
            统一展示 CLASSIC 服务场次与 GAME_DISPATCH 档位场次：
            开始/结束、证据数量与待复核调整。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <select
            className="h-9 w-56 rounded-md border bg-background px-2 text-sm"
            aria-label="按场次状态筛选"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {rowsQuery.isError ? (
            <p className="text-sm text-destructive">
              加载失败：
              {rowsQuery.error instanceof Error
                ? rowsQuery.error.message
                : String(rowsQuery.error)}
            </p>
          ) : null}
          {rowsQuery.isPending ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              加载中…
            </p>
          ) : null}
          {!rowsQuery.isPending &&
          !rowsQuery.isError &&
          rowsQuery.data?.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              暂无场次。
            </p>
          ) : null}
          {rowsQuery.data && rowsQuery.data.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>订单</TableHead>
                  <TableHead>流程</TableHead>
                  <TableHead>客户</TableHead>
                  <TableHead>陪玩</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">时长</TableHead>
                  <TableHead className="text-right">证据</TableHead>
                  <TableHead className="text-right">待复核调整</TableHead>
                  <TableHead className="text-right">开始时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rowsQuery.data.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link
                        href={`/sessions/${s.id}`}
                        className="font-mono text-xs font-medium hover:underline"
                      >
                        {s.orderNo}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.flow === "GAME_DISPATCH" ? "outline" : "default"}>
                        {s.flow === "GAME_DISPATCH" ? "GD" : "CLASSIC"}
                      </Badge>
                    </TableCell>
                    <TableCell>{s.customerName}</TableCell>
                    <TableCell>{s.playerName}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          s.status === "ADJUSTMENT_PENDING"
                            ? "destructive"
                            : s.status === "STARTED"
                              ? "default"
                              : "outline"
                        }
                      >
                        {STATUS_TEXT[s.status] ?? s.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatDuration(s.durationSeconds)}
                    </TableCell>
                    <TableCell className="text-right">
                      {s.evidenceCount}
                    </TableCell>
                    <TableCell className="text-right">
                      {s.adjustmentPendingCount}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.startedAt
                        ? new Date(s.startedAt).toLocaleString()
                        : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

export default function SessionsPage() {
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
      <h1 className="text-2xl font-semibold tracking-tight">场次与证据</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        独立场次台账、证据核对与时长调整复核。
      </p>
      <div className="mt-6">
        <QueryClientProvider client={queryClient}>
          <Inner />
        </QueryClientProvider>
      </div>
    </TenantShell>
  );
}

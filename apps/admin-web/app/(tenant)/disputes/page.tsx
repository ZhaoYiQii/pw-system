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

interface DisputeRow {
  id: string;
  orderId: string;
  playerId: string;
  reason: string;
  status: "OPEN" | "RESOLVED";
  resolution: string | null;
  createdAt: string;
}

function Inner() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const rowsQuery = useQuery({
    queryKey: ["disputes"],
    queryFn: () => apiFetch<DisputeRow[]>("/api/v1/tenant/disputes"),
  });

  const resolve = useMutation({
    mutationFn: (dispute: DisputeRow) => {
      const resolution = window.prompt(
        `处理争议（订单 ${dispute.orderId.slice(0, 8)}…）：请输入处理结论`,
        "",
      );
      if (!resolution?.trim()) throw new Error("已取消或结论为空");
      return apiFetch<unknown>(
        `/api/v1/tenant/disputes/${dispute.id}/resolve`,
        {
          method: "POST",
          body: JSON.stringify({ resolution }),
        },
      );
    },
    onSuccess: () => {
      setNotice("争议已处理完成。");
      void queryClient.invalidateQueries({ queryKey: ["disputes"] });
    },
    onError: (e) =>
      setMessage(
        e instanceof Error && e.message !== "已取消或结论为空" ? e.message : "",
      ),
  });

  if (rowsQuery.error instanceof ApiError && rowsQuery.error.status === 401) {
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
      {rowsQuery.isError ? (
        <p className="text-sm text-destructive">
          加载失败：
          {rowsQuery.error instanceof Error
            ? rowsQuery.error.message
            : String(rowsQuery.error)}
        </p>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>争议管理（{rowsQuery.data?.length ?? 0}）</CardTitle>
          <CardDescription>
            客诉争议列表；OPEN 争议可处理为已处理。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rowsQuery.isPending ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              加载中…
            </p>
          ) : null}
          {!rowsQuery.isPending && rowsQuery.data?.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              暂无争议。
            </p>
          ) : null}
          {rowsQuery.data && rowsQuery.data.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>订单</TableHead>
                  <TableHead>原因</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead>处理结果 / 操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rowsQuery.data.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-mono text-xs">
                      {d.orderId.slice(0, 8)}…
                    </TableCell>
                    <TableCell>{d.reason}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          d.status === "OPEN" ? "destructive" : "default"
                        }
                      >
                        {d.status === "OPEN" ? "待处理" : "已处理"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(d.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {d.status === "OPEN" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={resolve.isPending}
                          onClick={() => resolve.mutate(d)}
                        >
                          处理
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">
                          {d.resolution ?? "-"}
                        </span>
                      )}
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

export default function DisputesPage() {
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
      <h1 className="text-2xl font-semibold tracking-tight">争议管理</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        客诉争议列表；处理结论会记录到争议时间线。
      </p>
      <div className="mt-6">
        <QueryClientProvider client={queryClient}>
          <Inner />
        </QueryClientProvider>
      </div>
    </TenantShell>
  );
}

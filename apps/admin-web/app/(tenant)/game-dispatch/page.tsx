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
import { TenantNav } from "../../_lib/tenant-nav";

interface DispatchRow {
  orderId: string;
  dispatchNo: string;
  status: string;
  durationMinutes: number;
  createdAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "草稿",
  CONFIRMED: "待发布",
  DISPATCHING: "报名/选人中",
  ASSIGNED: "已选定",
  CANCELLED: "已取消",
};

function Inner() {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["game-dispatch"],
    queryFn: () => apiFetch<DispatchRow[]>("/api/v1/tenant/game-dispatch"),
  });

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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-4">
          <span>派单列表（{data?.length ?? 0}）</span>
          <Button asChild size="sm">
            <Link href="/game-dispatch/new">新建派单</Link>
          </Button>
        </CardTitle>
        <CardDescription>
          进入详情可复制群文案、刷新报名并确认陪玩。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            加载中…
          </p>
        ) : null}
        {!isPending && data?.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            暂无派单。通过下单表单生成草稿后可在此发布。
          </p>
        ) : null}
        {data && data.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>派单编号</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>时长</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row) => (
                <TableRow key={row.orderId}>
                  <TableCell className="font-medium">
                    {row.dispatchNo}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {STATUS_LABEL[row.status] ?? row.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{row.durationMinutes} 分钟</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(row.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/game-dispatch/${row.orderId}`}>
                        详情/复制
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function GameDispatchPage() {
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
      <div className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">派单管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          查看游戏派单、复制群文案并管理报名。
        </p>
        <div className="mt-6">
          <QueryClientProvider client={queryClient}>
            <Inner />
          </QueryClientProvider>
        </div>
      </div>
    </main>
  );
}

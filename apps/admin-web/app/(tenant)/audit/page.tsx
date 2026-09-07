"use client";

import {
  QueryClient,
  QueryClientProvider,
  useQuery,
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

interface AuditRow {
  id: string;
  actorType: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  summary: string | null;
  createdAt: string;
}

function Inner() {
  const auditQuery = useQuery({
    queryKey: ["audit"],
    queryFn: () => apiFetch<AuditRow[]>("/api/v1/tenant/audit?limit=100"),
  });

  if (auditQuery.error instanceof ApiError && auditQuery.error.status === 401) {
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
    <Card>
      <CardHeader>
        <CardTitle>审计日志（{auditQuery.data?.length ?? 0}）</CardTitle>
        <CardDescription>
          门店关键操作的不可变审计记录（已脱敏）。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {auditQuery.isPending ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            加载中…
          </p>
        ) : null}
        {auditQuery.isError ? (
          <p className="text-sm text-destructive">
            加载失败：
            {auditQuery.error instanceof Error
              ? auditQuery.error.message
              : String(auditQuery.error)}
          </p>
        ) : null}
        {!auditQuery.isPending && auditQuery.data?.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            暂无审计记录。
          </p>
        ) : null}
        {auditQuery.data && auditQuery.data.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>动作</TableHead>
                <TableHead>摘要</TableHead>
                <TableHead>操作者</TableHead>
                <TableHead>资源</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditQuery.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="font-medium">{r.action}</TableCell>
                  <TableCell>{r.summary ?? "-"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.actorType ?? "-"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.resourceType ?? "-"}
                    {r.resourceId ? `:${r.resourceId.slice(0, 8)}` : ""}
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

export default function AuditPage() {
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
      <h1 className="text-2xl font-semibold tracking-tight">审计日志</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        门店关键操作的不可变审计记录。
      </p>
      <div className="mt-6">
        <QueryClientProvider client={queryClient}>
          <Inner />
        </QueryClientProvider>
      </div>
    </TenantShell>
  );
}

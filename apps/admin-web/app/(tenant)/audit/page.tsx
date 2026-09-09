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
import { Input } from "@/components/ui/input";
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
  actorId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  summary: string | null;
  createdAt: string;
}

const PAGE_SIZE = 50;

function Inner() {
  const [keyword, setKeyword] = useState("");
  const [action, setAction] = useState("");
  const [actorType, setActorType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);

  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });
  if (keyword.trim()) params.set("q", keyword.trim());
  if (action.trim()) params.set("action", action.trim());
  if (actorType) params.set("actorType", actorType);
  if (from) params.set("from", new Date(from).toISOString());
  if (to) params.set("to", new Date(to).toISOString());

  const auditQuery = useQuery({
    queryKey: ["audit", keyword, action, actorType, from, to, offset],
    queryFn: () =>
      apiFetch<AuditRow[]>(`/api/v1/tenant/audit?${params.toString()}`),
  });

  const rows = auditQuery.data ?? [];
  const hasMore = rows.length === PAGE_SIZE;

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

  const exportCsv = async () => {
    setExporting(true);
    setDownloadMessage(null);
    try {
      const data = await apiFetch<{ csv: string; filename: string }>(
        `/api/v1/tenant/audit/export?${params.toString()}`,
      );
      const blob = new Blob(["\uFEFF" + data.csv], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = data.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setDownloadMessage(`已导出 ${data.csv.split("\n").length - 1} 条记录。`);
    } catch (error) {
      setDownloadMessage(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {downloadMessage ? (
        <p
          className={
            downloadMessage.startsWith("已导出")
              ? "text-sm text-emerald-600"
              : "text-sm text-destructive"
          }
        >
          {downloadMessage}
        </p>
      ) : null}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle>
                审计日志（{rows.length === PAGE_SIZE ? "≥" : ""}
                {rows.length + offset} 条）
              </CardTitle>
              <CardDescription>
                门店关键操作的不可变审计记录（已脱敏）；支持筛选与 CSV 导出。
              </CardDescription>
            </div>
            <Button
              variant="outline"
              disabled={exporting || auditQuery.isPending}
              onClick={() => void exportCsv()}
            >
              {exporting ? "导出中…" : "导出 CSV"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">关键词</span>
              <Input
                value={keyword}
                onChange={(event) => {
                  setKeyword(event.target.value);
                  setOffset(0);
                }}
                placeholder="动作/摘要/资源"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">动作</span>
              <Input
                value={action}
                onChange={(event) => {
                  setAction(event.target.value);
                  setOffset(0);
                }}
                placeholder="如 order.create"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">操作者类型</span>
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={actorType}
                onChange={(event) => {
                  setActorType(event.target.value);
                  setOffset(0);
                }}
              >
                <option value="">全部</option>
                <option value="TENANT_OWNER">店老板</option>
                <option value="TENANT_ADMIN">店长</option>
                <option value="CUSTOMER_SERVICE">客服</option>
                <option value="FINANCE">财务</option>
                <option value="PLAYER">陪玩</option>
                <option value="CUSTOMER">客户</option>
                <option value="platform_account">平台账号</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">开始时间</span>
              <Input
                type="datetime-local"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value);
                  setOffset(0);
                }}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">结束时间</span>
              <Input
                type="datetime-local"
                value={to}
                onChange={(event) => {
                  setTo(event.target.value);
                  setOffset(0);
                }}
              />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasMore}
              onClick={() => setOffset((value) => value + PAGE_SIZE)}
            >
              下一页
            </Button>
          </div>
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
          {!auditQuery.isPending && rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              没有符合条件的审计记录。
            </p>
          ) : null}
          {rows.length > 0 ? (
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
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {new Date(row.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-medium">{row.action}</TableCell>
                    <TableCell>{row.summary ?? "-"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.actorType ?? "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.resourceType ?? "-"}
                      {row.resourceId ? `:${row.resourceId.slice(0, 8)}` : ""}
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
        门店关键操作的不可变审计记录，支持筛选与导出。
      </p>
      <div className="mt-6">
        <QueryClientProvider client={queryClient}>
          <Inner />
        </QueryClientProvider>
      </div>
    </TenantShell>
  );
}

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
import { ApiError, apiFetch } from "../../../_lib/api";
import { formatFenYuan } from "../../../_lib/money";
import { TenantShell } from "../../../_lib/tenant-shell";

/**
 * S4-7b：门店「对账差异」。
 *
 * 对账（S4-3）本来只在后台跑：拉微信账单 → 比本地账本 → 差异落库。差异是**门店自己的账**，
 * 钱对不对得上只有门店知道业务上发生了什么，所以这里把账单文件与差异摆出来。
 *
 * 只读页面：不提供"标记已解决"按钮——差异的判定与修复在平台侧/人工核对，门店端先看得见。
 */

interface StatementView {
  id: string;
  billType: string;
  billDate: string;
  subMchid: string;
  totalCount: number;
  totalFen: string;
  downloadedAt: string;
}

interface DifferenceView {
  id: string;
  kind: string;
  kindLabel: string;
  amountFen: string | null;
  detail: string | null;
  paymentOrderId: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

interface ReconciliationView {
  statements: StatementView[];
  differences: DifferenceView[];
  unresolvedCount: number;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fmtTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "—";
}

function Inner() {
  const reconciliationQuery = useQuery({
    queryKey: ["payments", "reconciliation"],
    queryFn: () =>
      apiFetch<ReconciliationView>("/api/v1/tenant/payments/reconciliation"),
  });

  const unauthorized =
    reconciliationQuery.error instanceof ApiError &&
    reconciliationQuery.error.status === 401;
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

  const data = reconciliationQuery.data;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>
                对账差异
                {data ? `（未解决 ${data.unresolvedCount}）` : ""}
              </CardTitle>
              <CardDescription>
                每日按子商户拉微信账单，与门店本地账本比对：微信有而本地没有、金额不一致等都会列在这里。
                本页只读，不修改任何账目。
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={reconciliationQuery.isFetching}
              onClick={() => void reconciliationQuery.refetch()}
            >
              {reconciliationQuery.isFetching ? "刷新中…" : "刷新"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {reconciliationQuery.isPending ? (
            <p className="text-sm text-muted-foreground">加载中…</p>
          ) : null}
          {reconciliationQuery.isError ? (
            <p className="text-sm text-destructive">
              加载失败：{errorText(reconciliationQuery.error)}
            </p>
          ) : null}

          {!reconciliationQuery.isPending &&
          !reconciliationQuery.isError &&
          data?.differences.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {data.statements.length === 0
                ? "还没有账单文件：微信支付开通后，每日对账会自动拉取并按子商户留档。"
                : "账目一致：最近对账没有发现差异。"}
            </p>
          ) : null}

          {data && data.differences.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-64">差异类型</TableHead>
                  <TableHead className="w-28 text-right">金额</TableHead>
                  <TableHead>明细</TableHead>
                  <TableHead className="w-24">状态</TableHead>
                  <TableHead className="w-40">发现时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.differences.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-sm">
                      {row.kindLabel}
                      <span className="block font-mono text-xs text-muted-foreground">
                        {row.kind}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {row.amountFen === null
                        ? "—"
                        : formatFenYuan(row.amountFen)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.detail ?? "—"}
                      {row.paymentOrderId ? (
                        <span className="block font-mono text-xs text-muted-foreground">
                          支付单 {row.paymentOrderId}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={row.resolvedAt ? "secondary" : "destructive"}
                      >
                        {row.resolvedAt ? "已解决" : "未解决"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtTime(row.createdAt)}
                      {row.resolvedAt ? (
                        <span className="block">
                          解决 {fmtTime(row.resolvedAt)}
                        </span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>账单文件</CardTitle>
          <CardDescription>
            最近 5 份微信账单（按子商户、按自然日留档，含文件摘要与合计）。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data && data.statements.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">账单日</TableHead>
                  <TableHead className="w-24">类型</TableHead>
                  <TableHead className="w-40">子商户号</TableHead>
                  <TableHead className="w-24 text-right">笔数</TableHead>
                  <TableHead className="w-32 text-right">合计</TableHead>
                  <TableHead>下载时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.statements.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">
                      {row.billDate}
                    </TableCell>
                    <TableCell className="text-xs">{row.billType}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.subMchid}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {row.totalCount}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatFenYuan(row.totalFen)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtTime(row.downloadedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">
              还没有账单文件。
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function PaymentsReconciliationPage() {
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
      <h1 className="text-2xl font-semibold tracking-tight">对账差异</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        微信账单与门店账本的比对结果（只读）。
      </p>
      <div className="mt-6">
        <QueryClientProvider client={queryClient}>
          <Inner />
        </QueryClientProvider>
      </div>
    </TenantShell>
  );
}

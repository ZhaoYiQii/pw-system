"use client";

import {
  QueryClient,
  QueryClientProvider,
  useQuery,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError, apiFetch } from "../../../_lib/api";
import { TenantShell } from "../../../_lib/tenant-shell";
import { formatFenYuan } from "../../../_lib/money";

interface Customer {
  id: string;
  name: string;
  mobile: string | null;
  remark: string | null;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
}

interface WalletEntry {
  id: string;
  txNo: string;
  type: string;
  amountFen: string;
  balanceAfterFen: string;
  reason: string | null;
  createdAt: string;
}

interface CustomerAccount {
  customerId: string;
  wallet: {
    bossNo: string;
    balanceFen: string;
    entries: WalletEntry[];
  } | null;
}

interface OrderHistoryRow {
  orderId: string;
  orderNo: string;
  dispatchNo: string | null;
  processType: "CLASSIC" | "GAME_DISPATCH";
  status: string;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
}

const WALLET_TYPE_TEXT: Record<string, string> = {
  RECHARGE: "充值",
  DEDUCT: "消费扣款",
};

const ORDER_STATUS_TEXT: Record<string, string> = {
  DRAFT: "草稿",
  CONFIRMED: "已确认",
  DISPATCHING: "派单中",
  ASSIGNED: "已指派",
  READY: "就绪",
  IN_PROGRESS: "服务中",
  PENDING_CONFIRMATION: "待确认",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
};

function Inner({ customerId }: { customerId: string }) {
  const customerQuery = useQuery({
    queryKey: ["customer-detail", customerId],
    queryFn: () => apiFetch<Customer>(`/api/v1/tenant/customers/${customerId}`),
  });
  const accountQuery = useQuery({
    queryKey: ["customer-account", customerId],
    queryFn: () =>
      apiFetch<CustomerAccount>(
        `/api/v1/tenant/customers/${customerId}/account`,
      ),
  });
  const ordersQuery = useQuery({
    queryKey: ["customer-orders", customerId],
    queryFn: () =>
      apiFetch<OrderHistoryRow[]>(
        `/api/v1/tenant/customers/${customerId}/orders`,
      ),
  });

  if (
    customerQuery.error instanceof ApiError &&
    customerQuery.error.status === 401
  ) {
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
  if (customerQuery.isPending || !customerQuery.data) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        加载中…
      </p>
    );
  }

  const customer = customerQuery.data;
  const account = accountQuery.data?.wallet ?? null;

  return (
    <div className="flex flex-col gap-6">
      {customerQuery.isError ||
      accountQuery.isError ||
      ordersQuery.isError ? (
        <p className="text-sm text-destructive">
          部分数据加载失败，请刷新重试。
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {customer.name}
            <Badge variant={customer.status === "ACTIVE" ? "default" : "outline"}>
              {customer.status === "ACTIVE" ? "正常" : "已停用"}
            </Badge>
          </CardTitle>
          <CardDescription>客户档案详情</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">手机</dt>
              <dd>{customer.mobile ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">备注</dt>
              <dd>{customer.remark ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">建档时间</dt>
              <dd>{new Date(customer.createdAt).toLocaleString()}</dd>
            </div>
          </dl>
          <Button asChild variant="ghost">
            <Link href="/customers">返回客户列表</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>账户与余额</CardTitle>
          <CardDescription>老板钱包（Boss Wallet）余额与账变流水。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {account === null ? (
            <p className="py-3 text-sm text-muted-foreground">
              该客户尚未开通老板钱包，暂无余额流水。
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-6">
                <div>
                  <p className="text-sm text-muted-foreground">老板编号</p>
                  <p className="font-mono text-sm font-semibold">
                    {account.bossNo}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">账户余额</p>
                  <p className="text-2xl font-semibold">
                    {formatFenYuan(account.balanceFen)}
                  </p>
                </div>
              </div>
              {account.entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无流水。</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>时间</TableHead>
                      <TableHead>类型</TableHead>
                      <TableHead>原因</TableHead>
                      <TableHead className="text-right">变动</TableHead>
                      <TableHead className="text-right">余额</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {account.entries.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="text-muted-foreground">
                          {new Date(e.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {WALLET_TYPE_TEXT[e.type] ?? e.type}
                        </TableCell>
                        <TableCell>{e.reason ?? "-"}</TableCell>
                        <TableCell
                          className={`text-right font-medium ${
                            e.type === "RECHARGE"
                              ? "text-emerald-600"
                              : "text-destructive"
                          }`}
                        >
                          {e.type === "RECHARGE" ? "+" : "-"}
                          {formatFenYuan(e.amountFen)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatFenYuan(e.balanceAfterFen)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>历史订单（{ordersQuery.data?.length ?? 0}）</CardTitle>
          <CardDescription>包含旧 CLASSIC 流程与 GAME_DISPATCH 新流程。</CardDescription>
        </CardHeader>
        <CardContent>
          {ordersQuery.isPending ? (
            <p className="py-3 text-sm text-muted-foreground">加载中…</p>
          ) : null}
          {!ordersQuery.isPending &&
          (ordersQuery.data?.length ?? 0) === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">暂无订单。</p>
          ) : null}
          {ordersQuery.data && ordersQuery.data.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>订单号</TableHead>
                  <TableHead>流程</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>备注</TableHead>
                  <TableHead>创建时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordersQuery.data.map((o) => (
                  <TableRow key={o.orderId}>
                    <TableCell>
                      {o.processType === "GAME_DISPATCH" ? (
                        <Link
                          href={`/game-dispatch/${o.orderId}`}
                          className="font-mono text-xs font-medium hover:underline"
                        >
                          {o.orderNo}
                        </Link>
                      ) : (
                        <span className="font-mono text-xs font-medium">
                          {o.orderNo}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {o.processType === "GAME_DISPATCH" ? "GD" : "CLASSIC"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {ORDER_STATUS_TEXT[o.status] ?? o.status}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {o.remark ?? "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(o.createdAt).toLocaleString()}
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

export default function CustomerDetailPage() {
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
      <h1 className="text-2xl font-semibold tracking-tight">客户档案</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        档案、账户余额/账变与历史订单。
      </p>
      <div className="mt-6">
        <QueryClientProvider client={queryClient}>
          <Inner customerId={params.id} />
        </QueryClientProvider>
      </div>
    </TenantShell>
  );
}

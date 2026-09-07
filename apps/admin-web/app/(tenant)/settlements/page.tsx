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
import { TenantNav } from "../../_lib/tenant-nav";
import { formatFenYuan } from "../../_lib/money";

interface BatchRow {
  id: string;
  batchNo: string;
  status: "DRAFT" | "REVIEWED" | "APPROVED" | "PAID" | "VOID";
  totalAmountFen: string;
  itemCount: number;
  createdBy: string | null;
  createdAt: string;
}

interface PendingEarning {
  id: string;
  playerId: string;
  amountFen: string;
  playerName: string;
  orderNo: string;
  createdAt: string;
}

interface BatchDetailItem {
  earningId: string;
  amountFen: string;
  playerName: string;
  orderNo: string;
  createdAt: string;
}

interface BatchDetail {
  id: string;
  batchNo: string;
  status: BatchRow["status"];
  totalAmountFen: string;
  itemCount: number;
  items: BatchDetailItem[];
}

const STATUS_META: Record<
  BatchRow["status"],
  { text: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  DRAFT: { text: "草稿", variant: "secondary" },
  REVIEWED: { text: "已复核", variant: "outline" },
  APPROVED: { text: "已批准", variant: "default" },
  PAID: { text: "已支付", variant: "default" },
  VOID: { text: "已作废", variant: "destructive" },
};

function Inner() {
  const queryClient = useQueryClient();
  const [selectedEarningIds, setSelectedEarningIds] = useState<string[]>([]);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const batchesQuery = useQuery({
    queryKey: ["settlement-batches"],
    queryFn: () => apiFetch<BatchRow[]>("/api/v1/tenant/settlements"),
  });
  const earningsQuery = useQuery({
    queryKey: ["settlement-earnings"],
    queryFn: () =>
      apiFetch<PendingEarning[]>("/api/v1/tenant/settlements/earnings"),
  });
  const detailQuery = useQuery({
    queryKey: ["settlement-batch", activeBatchId],
    queryFn: () =>
      apiFetch<BatchDetail>(`/api/v1/tenant/settlements/${activeBatchId}`),
    enabled: activeBatchId !== null,
  });

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["settlement-batches"] });
    void queryClient.invalidateQueries({ queryKey: ["settlement-earnings"] });
    if (activeBatchId)
      void queryClient.invalidateQueries({
        queryKey: ["settlement-batch", activeBatchId],
      });
  };

  const addToBatch = useMutation({
    mutationFn: async (earningIds: string[]) => {
      const draft = batchesQuery.data?.find((b) => b.status === "DRAFT");
      if (draft) {
        await apiFetch<unknown>(
          `/api/v1/tenant/settlements/${draft.id}/items`,
          {
            method: "POST",
            body: JSON.stringify({ earningIds }),
          },
        );
        return draft.id;
      }
      const created = await apiFetch<{ id: string }>(
        "/api/v1/tenant/settlements",
        { method: "POST" },
      );
      await apiFetch<unknown>(
        `/api/v1/tenant/settlements/${created.id}/items`,
        {
          method: "POST",
          body: JSON.stringify({ earningIds }),
        },
      );
      return created.id;
    },
    onSuccess: (batchId) => {
      setActiveBatchId(batchId);
      setSelectedEarningIds([]);
      setNotice("已将所选应收加入结算批次。");
      setError(null);
      refreshAll();
    },
    onError: (e) =>
      setError(e instanceof Error ? e.message : String(e)),
  });

  const transition = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      apiFetch<unknown>(
        `/api/v1/tenant/settlements/${id}/${action}`,
        { method: "POST" },
      ),
    onSuccess: (_data, vars) => {
      const label: Record<string, string> = {
        review: "完成复核",
        approve: "完成批准",
        pay: "登记支付",
        void: "已作废",
      };
      setNotice(`批次已${label[vars.action] ?? "更新"}。`);
      refreshAll();
    },
    onError: (e) =>
      setError(e instanceof Error ? e.message : String(e)),
  });

  const queryUnauthorized =
    batchesQuery.error instanceof ApiError &&
    batchesQuery.error.status === 401;
  if (queryUnauthorized) {
    return (
      <main className="min-h-screen bg-[#f4f5f7]">
        <TenantNav />
        <div className="mx-auto max-w-6xl px-6 py-8">
          <Card>
            <CardHeader>
              <CardTitle>尚未登录商家端</CardTitle>
              <CardDescription>结算需要店主或财务账号。</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href="/store/login">去登录</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  const draftBatch = batchesQuery.data?.find((b) => b.status === "DRAFT");
  const toggleEarning = (id: string) => {
    setSelectedEarningIds((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id],
    );
  };
  const actionFor = (batch: BatchRow) => {
    const btn = (label: string, action: string) => (
      <Button
        key={action}
        variant="outline"
        size="sm"
        disabled={transition.isPending}
        onClick={() => transition.mutate({ id: batch.id, action })}
      >
        {label}
      </Button>
    );
    if (batch.status === "DRAFT") {
      return (
        <div className="flex justify-end gap-2">
          {btn("复核", "review")}
          {btn("作废", "void")}
        </div>
      );
    }
    if (batch.status === "REVIEWED") {
      return (
        <div className="flex justify-end gap-2">
          {btn("批准", "approve")}
          {btn("作废", "void")}
        </div>
      );
    }
    if (batch.status === "APPROVED") {
      return (
        <div className="flex justify-end gap-2">
          {btn("登记线下支付", "pay")}
        </div>
      );
    }
    return null;
  };

  return (
    <main className="min-h-screen bg-[#f4f5f7]">
      <TenantNav />
      <div className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">结算批次</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          将陪玩待结算收入按批次复核、批准并登记线下支付。
        </p>
        <div className="mt-6 flex flex-col gap-6">
          {notice ? <p className="text-sm text-emerald-600">{notice}</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <Card>
            <CardHeader>
              <CardTitle>待结算应收</CardTitle>
              <CardDescription>
                勾选应收后加入草稿批次；若没有草稿批次会自动新建。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between pb-3">
                <p className="text-sm text-muted-foreground">
                  {draftBatch
                    ? `当前草稿批次：${draftBatch.batchNo}`
                    : "暂无草稿批次"}
                </p>
                <Button
                  disabled={selectedEarningIds.length === 0}
                  onClick={() =>
                    addToBatch.mutate(selectedEarningIds)
                  }
                >
                  {addToBatch.isPending
                    ? "加入中…"
                    : draftBatch
                      ? "加入草稿批次"
                      : "新建批次并加入"}
                </Button>
              </div>
              {earningsQuery.isPending ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  加载中…
                </p>
              ) : null}
              {!earningsQuery.isPending &&
              earningsQuery.data?.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  暂无待结算应收。
                </p>
              ) : null}
              {earningsQuery.data && earningsQuery.data.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <input
                          type="checkbox"
                          aria-label="全选"
                          checked={
                            earningsQuery.data.length > 0 &&
                            earningsQuery.data.every((e) =>
                              selectedEarningIds.includes(e.id),
                            )
                          }
                          onChange={(e) =>
                            setSelectedEarningIds(
                              e.target.checked
                                ? earningsQuery.data.map((x) => x.id)
                                : [],
                            )
                          }
                        />
                      </TableHead>
                      <TableHead>陪玩</TableHead>
                      <TableHead>订单号</TableHead>
                      <TableHead className="text-right">应收金额</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {earningsQuery.data.map((earning) => (
                      <TableRow key={earning.id}>
                        <TableCell>
                          <input
                            type="checkbox"
                            aria-label={`选择 ${earning.orderNo}`}
                            checked={selectedEarningIds.includes(earning.id)}
                            onChange={() => toggleEarning(earning.id)}
                          />
                        </TableCell>
                        <TableCell className="font-medium">
                          {earning.playerName}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {earning.orderNo}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatFenYuan(earning.amountFen)}
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
              <CardTitle>
                批次列表（{batchesQuery.data?.length ?? 0}）
              </CardTitle>
              <CardDescription>
                点击批次可查看其中明细；DRAFT/REVIEWED 支持作废退回。
              </CardDescription>
            </CardHeader>
            <CardContent>
              {batchesQuery.isPending ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  加载中…
                </p>
              ) : null}
              {!batchesQuery.isPending &&
              batchesQuery.data?.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  暂无批次，请先在“待结算应收”创建。
                </p>
              ) : null}
              {batchesQuery.data && batchesQuery.data.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>批次号</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead className="text-right">笔数</TableHead>
                      <TableHead className="text-right">合计</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batchesQuery.data.map((batch) => {
                      const meta = STATUS_META[batch.status];
                      return (
                        <TableRow
                          key={batch.id}
                          className={
                            activeBatchId === batch.id
                              ? "bg-accent/40"
                              : undefined
                          }
                        >
                          <TableCell>
                            <button
                              type="button"
                              className="text-left text-sm font-medium hover:underline"
                              onClick={() => setActiveBatchId(batch.id)}
                            >
                              {batch.batchNo}
                            </button>
                          </TableCell>
                          <TableCell>
                            <Badge variant={meta.variant}>{meta.text}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {batch.itemCount}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatFenYuan(batch.totalAmountFen)}
                          </TableCell>
                          <TableCell>{actionFor(batch)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : null}
            </CardContent>
          </Card>

          {activeBatchId ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  批次明细：
                  {detailQuery.data?.batchNo ?? "…"}
                </CardTitle>
                <CardDescription>
                  合计 {formatFenYuan(detailQuery.data?.totalAmountFen ?? "0")}，
                  {detailQuery.data?.itemCount ?? 0} 笔。
                </CardDescription>
              </CardHeader>
              <CardContent>
                {detailQuery.isPending ? (
                  <p className="text-sm text-muted-foreground">加载中…</p>
                ) : null}
                {detailQuery.data && detailQuery.data.items.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    该批次暂无明细。
                  </p>
                ) : null}
                {detailQuery.data && detailQuery.data.items.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>陪玩</TableHead>
                        <TableHead>订单号</TableHead>
                        <TableHead className="text-right">金额</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detailQuery.data.items.map((item) => (
                        <TableRow key={item.earningId}>
                          <TableCell className="font-medium">
                            {item.playerName}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {item.orderNo}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatFenYuan(item.amountFen)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </main>
  );
}

export default function SettlementsPage() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <Inner />
    </QueryClientProvider>
  );
}

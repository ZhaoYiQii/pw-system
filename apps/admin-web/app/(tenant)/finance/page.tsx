"use client";

import {
  QueryClient,
  QueryClientProvider,
  useMutation,
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
import { formatFenYuan, sumFen } from "../../_lib/money";

interface Rules {
  platformFeeBp: number;
  storeCutBp: number;
}
interface Split {
  platformFeeFen: string;
  storeCutFen: string;
  playerShareFen: string;
}
interface FinanceLedgerRow {
  id: string;
  source: "LEGACY" | "SLOT";
  amountFen: string;
  status: string;
  playerId: string;
  playerName: string;
  orderNo: string;
  batchNo: string | null;
  createdAt: string;
}
interface FinanceLedger {
  paidFen: string;
  unpaidFen: string;
  rows: FinanceLedgerRow[];
}

function pct(bp: number): string {
  return `${(bp / 100).toFixed(2)}%`;
}

function Inner() {
  const [storeCut, setStoreCut] = useState("");
  const [amount, setAmount] = useState("");
  const [split, setSplit] = useState<Split | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const rulesQuery = useQuery({
    queryKey: ["finance", "rules"],
    queryFn: () => apiFetch<Rules>("/api/v1/tenant/finance-rules"),
  });
  const ledgerQuery = useQuery({
    queryKey: ["finance", "ledger"],
    queryFn: () =>
      apiFetch<FinanceLedger>("/api/v1/tenant/settlements/ledger"),
  });

  const saveStoreCut = useMutation({
    mutationFn: () =>
      apiFetch<Rules>("/api/v1/tenant/finance-rules/store-cut", {
        method: "POST",
        body: JSON.stringify({ storeCutBp: Number(storeCut) }),
      }),
    onSuccess: () => {
      setNotice("已保存门店抽成。");
      rulesQuery.refetch();
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });

  const preview = useMutation({
    mutationFn: () =>
      apiFetch<Split>("/api/v1/tenant/finance-rules/split-preview", {
        method: "POST",
        body: JSON.stringify({ amountFen: amount }),
      }),
    onSuccess: (data) => setSplit(data),
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });

  const rules = rulesQuery.data ?? null;

  if (rulesQuery.error instanceof ApiError && rulesQuery.error.status === 401) {
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
      {rulesQuery.isError ? (
        <p className="text-sm text-destructive">
          加载失败：
          {rulesQuery.error instanceof Error
            ? rulesQuery.error.message
            : String(rulesQuery.error)}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>当前费率（基点 bp，1% = 100bp）</CardTitle>
          <CardDescription>
            平台费/门店抽成按“老板应付金额”拆分；陪玩到手为剩余（尾差归陪玩）。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {rules ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>角色</TableHead>
                  <TableHead>费率</TableHead>
                  <TableHead>说明</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>平台服务费</TableCell>
                  <TableCell>
                    {rules.platformFeeBp} bp（{pct(rules.platformFeeBp)}）
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    由平台后台调整
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>门店抽成</TableCell>
                  <TableCell>
                    {rules.storeCutBp} bp（{pct(rules.storeCutBp)}）
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    本店可调整
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>陪玩到手</TableCell>
                  <TableCell>
                    {10000 - rules.platformFeeBp - rules.storeCutBp} bp（
                    {pct(10000 - rules.platformFeeBp - rules.storeCutBp)}）
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    剩余部分（尾差归陪玩）
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">加载中…</p>
          )}
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (storeCut.trim()) saveStoreCut.mutate();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="store-cut">
                门店抽成（bp，0-10000）
              </label>
              <Input
                id="store-cut"
                type="number"
                className="w-48"
                value={storeCut}
                onChange={(e) => setStoreCut(e.target.value)}
                placeholder="如 2000 = 20%"
              />
            </div>
            <Button
              type="submit"
              disabled={saveStoreCut.isPending || !storeCut}
            >
              保存门店抽成
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>收入账本</CardTitle>
          <CardDescription>
            CLASSIC earning 与 GAME_DISPATCH slot_earning 两套应收合并展示；
            金额为陪玩口径，状态按服务端为准。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {ledgerQuery.isPending ? (
            <p className="py-3 text-sm text-muted-foreground">加载中…</p>
          ) : null}
          {ledgerQuery.isError ? (
            <p className="text-sm text-destructive">
              加载失败：
              {ledgerQuery.error instanceof Error
                ? ledgerQuery.error.message
                : String(ledgerQuery.error)}
            </p>
          ) : null}
          {ledgerQuery.data ? (
            <>
              <div className="flex flex-wrap gap-6 text-sm">
                <p>
                  已支付 <b className="font-mono">{formatFenYuan(ledgerQuery.data.paidFen)}</b>
                </p>
                <p>
                  未支付 <b className="font-mono">{formatFenYuan(ledgerQuery.data.unpaidFen)}</b>
                </p>
                <p>
                  记录数{" "}
                  <b className="font-mono">{ledgerQuery.data.rows.length}</b>
                </p>
              </div>
              {ledgerQuery.data.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无收入记录。</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>来源</TableHead>
                      <TableHead>陪玩</TableHead>
                      <TableHead>订单</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>批次</TableHead>
                      <TableHead className="text-right">金额</TableHead>
                      <TableHead>时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ledgerQuery.data.rows.slice(0, 100).map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          {r.source === "SLOT" ? "GD 档位" : "CLASSIC"}
                        </TableCell>
                        <TableCell className="font-medium">
                          {r.playerName}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {r.orderNo}
                        </TableCell>
                        <TableCell>{r.status}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.batchNo ?? "-"}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatFenYuan(r.amountFen)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(r.createdAt).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>分账试算</CardTitle>
          <CardDescription>
            输入老板应付金额，查看三方分账结果。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (amount.trim()) preview.mutate();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="amount">
                老板应付金额（分，如 10000 = ¥100.00）
              </label>
              <Input
                id="amount"
                type="number"
                className="w-56"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="10000"
              />
            </div>
            <Button type="submit" disabled={preview.isPending || !amount}>
              试算
            </Button>
          </form>
          {split ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>分账项</TableHead>
                  <TableHead>金额</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>平台服务费</TableCell>
                  <TableCell>{formatFenYuan(split.platformFeeFen)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>门店抽成</TableCell>
                  <TableCell>{formatFenYuan(split.storeCutFen)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>陪玩到手（可提现口径）</TableCell>
                  <TableCell>{formatFenYuan(split.playerShareFen)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>合计</TableCell>
                  <TableCell>
                    {formatFenYuan(
                      sumFen([
                        split.platformFeeFen,
                        split.storeCutFen,
                        split.playerShareFen,
                      ]),
                    )}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

export default function FinancePage() {
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
      <h1 className="text-2xl font-semibold tracking-tight">
        财务 · 分成规则与收入账本
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        门店抽成费率、收入账本（CLASSIC + GD 应收）与分账试算。
      </p>
      <div className="mt-6">
        <QueryClientProvider client={queryClient}>
          <Inner />
        </QueryClientProvider>
      </div>
    </TenantShell>
  );
}

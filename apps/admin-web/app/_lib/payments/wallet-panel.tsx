"use client";

/**
 * S4-9a：门店「客户钱包」面板（余额列表 + 单客户充值/退款流水）。
 *
 * 商家端与门店后台渲染**同一份** panel（与支付三页同一范式），不重复实现。
 *
 * 口径：
 * - 只读：余额与流水都由后端算好（`GET /api/v1/tenant/payments/wallets`），前端不重算；
 * - 方向由后端给（`IN`/`OUT`/`null`）；**认不出的类型不带符号**，也不改中文标签；
 * - 后端错误（401 / 400 / 404）原样透出，不做二次包装。
 */

import { useQuery } from "@tanstack/react-query";
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
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError, apiFetch } from "../api";
import { formatFenYuan } from "../money";

interface WalletRow {
  walletId: string;
  bossNo: string;
  customerProfileId: string;
  customerName: string | null;
  balanceFen: string;
  entryCount: number;
  lastEntryAt: string | null;
}

interface WalletListView {
  rows: WalletRow[];
  limit: number;
  query: string | null;
}

interface WalletEntryView {
  id: string;
  txNo: string;
  type: string;
  typeLabel: string;
  direction: "IN" | "OUT" | null;
  amountFen: string;
  balanceAfterFen: string;
  reason: string | null;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: string;
}

interface WalletDetailView {
  walletId: string;
  bossNo: string;
  customerProfileId: string;
  customerName: string | null;
  balanceFen: string;
  entries: WalletEntryView[];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fmtTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "—";
}

/** 入账带 +、出账带 −；认不出的方向只显示金额（不猜正负）。 */
function signedAmount(entry: WalletEntryView): string {
  const amount = formatFenYuan(entry.amountFen);
  if (entry.direction === "IN") return `+${amount}`;
  if (entry.direction === "OUT") return `-${amount}`;
  return amount;
}

export function WalletPanel() {
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<WalletRow | null>(null);

  const walletsQuery = useQuery({
    queryKey: ["payments", "wallets", query],
    queryFn: () =>
      apiFetch<WalletListView>(
        `/api/v1/tenant/payments/wallets${query ? `?query=${encodeURIComponent(query)}` : ""}`,
      ),
  });

  const detailQuery = useQuery({
    queryKey: ["payments", "wallets", selected?.customerProfileId, "entries"],
    enabled: selected !== null,
    queryFn: () =>
      apiFetch<WalletDetailView>(
        `/api/v1/tenant/payments/wallets/${selected?.customerProfileId}/entries`,
      ),
  });

  const unauthorized =
    walletsQuery.error instanceof ApiError && walletsQuery.error.status === 401;
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

  const rows = walletsQuery.data?.rows ?? [];
  const detail = detailQuery.data;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>客户钱包</CardTitle>
              <CardDescription>
                客户余额与充值 / 退款流水。客户在 H5
                充值后余额进这里；退款登记会从这里扣减。 本页只读，不改余额。
              </CardDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Input
                aria-label="按客户名搜索"
                className="w-44"
                placeholder="按客户名搜索"
                value={queryInput}
                onChange={(event) => setQueryInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") setQuery(queryInput.trim());
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setQuery(queryInput.trim())}
              >
                查询
              </Button>
              {query ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setQueryInput("");
                    setQuery("");
                  }}
                >
                  清空
                </Button>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {walletsQuery.isPending ? (
            <p className="text-sm text-muted-foreground">加载中…</p>
          ) : null}
          {walletsQuery.isError ? (
            <p className="text-sm text-destructive">
              加载失败：{errorText(walletsQuery.error)}
            </p>
          ) : null}
          {!walletsQuery.isPending &&
          !walletsQuery.isError &&
          rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {query
                ? `没有匹配「${query}」的客户钱包。`
                : "还没有客户钱包。客户在 H5 完成一次充值后，这里会出现余额与流水。"}
            </p>
          ) : null}

          {rows.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>客户</TableHead>
                  <TableHead className="w-44">钱包号</TableHead>
                  <TableHead className="w-32 text-right">余额</TableHead>
                  <TableHead className="w-24 text-right">流水</TableHead>
                  <TableHead className="w-44">最近变动</TableHead>
                  <TableHead className="w-28">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.walletId}>
                    <TableCell className="text-sm">
                      {row.customerName ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.bossNo}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatFenYuan(row.balanceFen)}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {row.entryCount}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtTime(row.lastEntryAt)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelected(row)}
                      >
                        看流水
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>

      {selected ? (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>
                  {detail?.customerName ?? selected.customerName ?? "客户"}
                  <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                    {detail?.bossNo ?? selected.bossNo}
                  </span>
                </CardTitle>
                <CardDescription>
                  余额{" "}
                  {formatFenYuan(detail?.balanceFen ?? selected.balanceFen)}
                  ，最近 {detail?.entries.length ?? 0} 条流水（充值 / 退款 /
                  结算扣费）。
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelected(null)}
              >
                收起
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {detailQuery.isPending ? (
              <p className="text-sm text-muted-foreground">加载流水…</p>
            ) : null}
            {detailQuery.isError ? (
              <p className="text-sm text-destructive">
                流水加载失败：{errorText(detailQuery.error)}
              </p>
            ) : null}
            {!detailQuery.isPending &&
            !detailQuery.isError &&
            detail?.entries.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                这个钱包还没有流水。
              </p>
            ) : null}
            {detail && detail.entries.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-64">类型</TableHead>
                    <TableHead className="w-32 text-right">金额</TableHead>
                    <TableHead className="w-32 text-right">
                      变动后余额
                    </TableHead>
                    <TableHead>原因 / 关联</TableHead>
                    <TableHead className="w-44">时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-sm">
                        {entry.typeLabel}
                        {entry.direction === null ? (
                          <Badge variant="outline" className="ml-2">
                            方向未识别
                          </Badge>
                        ) : null}
                        <span className="block font-mono text-xs text-muted-foreground">
                          {entry.txNo}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {signedAmount(entry)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatFenYuan(entry.balanceAfterFen)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {entry.reason ?? "—"}
                        {entry.referenceType ? (
                          <span className="block font-mono text-xs text-muted-foreground">
                            {entry.referenceType}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtTime(entry.createdAt)}
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
  );
}

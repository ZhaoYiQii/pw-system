"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { formatFenYuan, yuanToFenString } from "../money";

/**
 * S4-7：门店「支付台账」。
 *
 * 门店以前只看得到"钱包余额涨了"，看不到支付单本身（单号、金额、已退多少、微信侧状态），
 * 于是**人工退款登记无从下手**——登记退款要填 `outNo`，而门店拿不到这个号。
 * 这一页把支付单摆出来，并把退款登记放在支付单行内，形成闭环。
 *
 * 口径说明：
 * - 可退/已退金额、能不能退，一律由后端算（`GET /api/v1/tenant/payments/orders`），前端不重复判断；
 * - 退款登记走 S4-4 的 `POST /api/v1/payments/refunds/manual`（扣钱包 + 流水 + 审计 + 幂等 + 余额护栏）；
 * - 后端返回的错误（400 入参 / 409 状态或余额 / 403 权限）**原样显示**，不做二次包装。
 */

interface LedgerRow {
  id: string;
  outNo: string;
  amountFen: string;
  refundedFen: string;
  refundableFen: string;
  canRefund: boolean;
  status: string;
  customerProfileId: string;
  customerName: string | null;
  createdAt: string;
  paidAt: string | null;
}

interface LedgerView {
  rows: LedgerRow[];
  limit: number;
  status: string | null;
}

interface RefundResult {
  refundId: string;
  outRefundNo: string;
  amountFen: string;
  refundedFen: string;
  walletBalanceFen: string;
  fullyRefunded: boolean;
  duplicate: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: "待支付",
  SUCCESS: "已支付",
  FAILED: "支付失败",
};

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  PENDING: "outline",
  SUCCESS: "default",
  FAILED: "destructive",
};

const FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "全部" },
  { value: "SUCCESS", label: "已支付" },
  { value: "PENDING", label: "待支付" },
  { value: "FAILED", label: "支付失败" },
];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fmtTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "—";
}

export function PaymentLedgerPanel() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** 正在登记退款的支付单（含幂等键：同一次填写重试不会重复扣钱）。 */
  const [refundTarget, setRefundTarget] = useState<{
    row: LedgerRow;
    idempotencyKey: string;
  } | null>(null);
  const [amountYuan, setAmountYuan] = useState("");
  const [reason, setReason] = useState("");

  const ordersQuery = useQuery({
    queryKey: ["payments", "orders", status],
    queryFn: () =>
      apiFetch<LedgerView>(
        `/api/v1/tenant/payments/orders${status ? `?status=${status}` : ""}`,
      ),
  });

  const refund = useMutation({
    mutationFn: (input: {
      outNo: string;
      amountFen: string;
      reason: string;
      idempotencyKey: string;
    }) =>
      apiFetch<RefundResult>("/api/v1/payments/refunds/manual", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (result, input) => {
      setMessage(null);
      setNotice(
        `已登记退款 ${formatFenYuan(result.amountFen)}（${input.outNo}）` +
          `；该单累计已退 ${formatFenYuan(result.refundedFen)}，客户钱包余额 ${formatFenYuan(result.walletBalanceFen)}` +
          `${result.fullyRefunded ? "；已全额退清" : ""}` +
          `${result.duplicate ? "；这是幂等命中，没有重复扣钱" : ""}`,
      );
      setRefundTarget(null);
      setAmountYuan("");
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["payments", "orders"] });
    },
    onError: (error) => {
      setNotice(null);
      setMessage(errorText(error));
    },
  });

  const unauthorized =
    ordersQuery.error instanceof ApiError && ordersQuery.error.status === 401;
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

  const openRefund = (row: LedgerRow) => {
    setMessage(null);
    setNotice(null);
    setAmountYuan("");
    setReason("");
    setRefundTarget({ row, idempotencyKey: crypto.randomUUID() });
  };

  const submitRefund = () => {
    if (!refundTarget) return;
    const amountFen = yuanToFenString(amountYuan);
    if (amountFen === null || amountFen === "0") {
      setNotice(null);
      setMessage("退款金额要填元（最多两位小数），且大于 0");
      return;
    }
    if (!reason.trim()) {
      setNotice(null);
      setMessage("必须填写退款原因");
      return;
    }
    refund.mutate({
      outNo: refundTarget.row.outNo,
      amountFen,
      reason: reason.trim(),
      idempotencyKey: refundTarget.idempotencyKey,
    });
  };

  const rows = ordersQuery.data?.rows ?? [];

  return (
    <div className="flex flex-col gap-6">
      {notice ? <p className="text-sm text-emerald-600">{notice}</p> : null}
      {message ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {message}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>支付台账</CardTitle>
              <CardDescription>
                客户在 H5 充值的支付单：金额、已退多少、还能退多少。
                退款由门店在自己的商户号退给客户，这里负责把这次退款记进系统（扣钱包
                + 审计）。
              </CardDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {FILTERS.map((filter) => (
                <Button
                  key={filter.value || "all"}
                  variant={status === filter.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setStatus(filter.value)}
                >
                  {filter.label}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {ordersQuery.isPending ? (
            <p className="text-sm text-muted-foreground">加载中…</p>
          ) : null}
          {ordersQuery.isError ? (
            <p className="text-sm text-destructive">
              加载失败：{errorText(ordersQuery.error)}
            </p>
          ) : null}
          {!ordersQuery.isPending &&
          !ordersQuery.isError &&
          rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              没有符合条件的支付单。客户在 H5 充值后会在这里出现。
            </p>
          ) : null}

          {rows.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>支付单号</TableHead>
                  <TableHead>客户</TableHead>
                  <TableHead className="w-24">状态</TableHead>
                  <TableHead className="w-28 text-right">支付金额</TableHead>
                  <TableHead className="w-28 text-right">已退</TableHead>
                  <TableHead className="w-28 text-right">可退</TableHead>
                  <TableHead className="w-40">创建时间</TableHead>
                  <TableHead className="w-28">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">
                      {row.outNo}
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.customerName ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[row.status] ?? "outline"}>
                        {STATUS_LABEL[row.status] ?? row.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatFenYuan(row.amountFen)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatFenYuan(row.refundedFen)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatFenYuan(row.refundableFen)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtTime(row.createdAt)}
                      {row.paidAt ? (
                        <span className="block">
                          支付 {fmtTime(row.paidAt)}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {row.canRefund ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={refund.isPending}
                          onClick={() => openRefund(row)}
                        >
                          登记退款
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}

          {refundTarget ? (
            <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4">
              <p className="text-sm">
                <span className="text-muted-foreground">登记退款：</span>
                <span className="font-mono text-xs">
                  {refundTarget.row.outNo}
                </span>
                <span className="text-muted-foreground">
                  （{refundTarget.row.customerName ?? "客户"}，支付{" "}
                  {formatFenYuan(refundTarget.row.amountFen)}，可退{" "}
                  {formatFenYuan(refundTarget.row.refundableFen)}）
                </span>
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">
                    退款金额（元）
                  </span>
                  <Input
                    aria-label="退款金额（元）"
                    className="w-40 font-mono"
                    placeholder="例如 12.80"
                    value={amountYuan}
                    onChange={(event) => setAmountYuan(event.target.value)}
                  />
                </div>
                <div className="flex min-w-72 flex-1 flex-col gap-1">
                  <span className="text-xs text-muted-foreground">
                    退款原因（必填，写进审计）
                  </span>
                  <Input
                    aria-label="退款原因"
                    placeholder="例如 客户未到场，全额退"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    disabled={refund.isPending}
                    onClick={() => submitRefund()}
                  >
                    {refund.isPending ? "登记中…" : "确认登记退款"}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={refund.isPending}
                    onClick={() => setRefundTarget(null)}
                  >
                    取消
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                钱由门店在自己的商户号退给客户；这里只登记并扣客户钱包余额。
                同一份填写重复提交不会重复扣钱（幂等键），余额不足会被后端挡住并原样报错。
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

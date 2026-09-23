"use client";

/**
 * S5-1：门店「支付台账」= 通用数据表格壳（`<DataManager>`）+ 人工退款登记。
 *
 * 表格部分交给壳（服务端排序/筛选/分页、区域选择、复制粘贴到 Excel、CSV 导出、当前页合计）；
 * 这里只声明列定义，并保留 S4-7a 就有的**人工退款登记**：从表格里复制支付单号 → 粘进下面的登记表单
 * （这就是"Excel 手感"的实际用法）。退款本身仍走后端受控接口（扣钱包 + 流水 + 审计 + 幂等 + 余额护栏）。
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { apiFetch } from "../api";
import { formatFenYuan, yuanToFenString } from "../money";
import { DataManager } from "../data-grid/data-manager";
import type { DataGridColumn } from "../data-grid/types";

interface PaymentLedgerRow {
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

interface RefundResult {
  refundId: string;
  outRefundNo: string;
  amountFen: string;
  refundedFen: string;
  walletBalanceFen: string;
  fullyRefunded: boolean;
  duplicate: boolean;
}

/** 列定义必须是模块级常量（引用稳定，否则表格会被反复重建）。 */
const COLUMNS: readonly DataGridColumn<PaymentLedgerRow>[] = [
  { key: "outNo", title: "支付单号", width: 230, frozen: true, minWidth: 180 },
  {
    key: "customerName",
    title: "客户",
    width: 120,
    text: (value) => (value ? String(value) : "—"),
  },
  {
    key: "status",
    title: "状态",
    width: 110,
    badge: (value) => {
      const status = String(value ?? "");
      if (status === "SUCCESS") return { label: "已支付", tone: "ok" };
      if (status === "PENDING") return { label: "待支付", tone: "wait" };
      if (status === "FAILED") return { label: "支付失败", tone: "bad" };
      return { label: status || "—", tone: "muted" };
    },
  },
  { key: "amountFen", title: "支付金额", money: true, width: 120 },
  { key: "refundedFen", title: "已退", money: true, width: 110 },
  { key: "refundableFen", title: "可退", money: true, width: 110 },
  {
    key: "createdAt",
    title: "创建时间",
    width: 190,
    text: (value) => (value ? new Date(String(value)).toLocaleString() : "—"),
  },
  {
    key: "paidAt",
    title: "支付时间",
    width: 190,
    text: (value) => (value ? new Date(String(value)).toLocaleString() : "—"),
  },
];

const STATUS_OPTIONS = [
  { value: "", label: "全部" },
  { value: "SUCCESS", label: "已支付" },
  { value: "PENDING", label: "待支付" },
  { value: "FAILED", label: "支付失败" },
] as const;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function PaymentLedgerPanel() {
  const queryClient = useQueryClient();
  const [outNo, setOutNo] = useState("");
  const [amountYuan, setAmountYuan] = useState("");
  const [reason, setReason] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
      setOutNo("");
      setAmountYuan("");
      setReason("");
      setIdempotencyKey(crypto.randomUUID());
      void queryClient.invalidateQueries({ queryKey: ["data-grid"] });
    },
    onError: (error) => {
      setNotice(null);
      setMessage(errorText(error));
    },
  });

  const submit = () => {
    if (!outNo.trim()) {
      setNotice(null);
      setMessage("请填写支付单号（可从上面表格里复制）");
      return;
    }
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
      outNo: outNo.trim(),
      amountFen,
      reason: reason.trim(),
      idempotencyKey,
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {notice ? <p className="text-sm text-emerald-600">{notice}</p> : null}
      {message ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {message}
        </div>
      ) : null}

      <DataManager<PaymentLedgerRow>
        resource="/api/v1/tenant/payments/orders"
        columns={COLUMNS}
        statusOptions={STATUS_OPTIONS}
        searchPlaceholder="支付单号 / 客户名（回车）"
        exportPath="/api/v1/tenant/payments/orders/export.csv"
        exportFileName="payment-orders.csv"
        emptyHint="没有符合条件的支付单。客户在 H5 充值后会在这里出现。"
      />

      <Card>
        <CardHeader>
          <CardTitle>登记退款</CardTitle>
          <CardDescription>
            钱由门店在自己的商户号退给客户，这里只登记并扣客户钱包余额。支付单号从上面表格复制即可。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">支付单号</span>
              <Input
                aria-label="支付单号"
                className="w-72 font-mono"
                placeholder="从表格里复制粘贴"
                value={outNo}
                onChange={(event) => setOutNo(event.target.value)}
              />
            </div>
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
            <Button disabled={refund.isPending} onClick={() => submit()}>
              {refund.isPending ? "登记中…" : "确认登记退款"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            同一份填写重复提交不会重复扣钱（幂等键）；余额不足会被后端挡住并原样报错。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

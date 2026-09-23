"use client";

/**
 * S5-1 / S5-2：门店「支付台账」= 通用数据表格壳（`<DataManager>`）+ 人工退款登记。
 *
 * 表格部分交给壳（服务端排序/筛选/分页、区域选择、复制粘贴到 Excel、CSV 导出、当前页合计）；
 * 这里只声明列定义，并保留 S4-7a 就有的**人工退款登记**：表格最右侧「操作」列的「登记退款」
 * 把该行的支付单号填进下面的登记表单（S5-2 只是把这条已有链路搬到行内入口，没加新功能）；
 * 退款本身仍走后端受控接口（扣钱包 + 流水 + 审计 + 幂等 + 余额护栏）。
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
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
import type { DataGridColumn, DataGridRowAction } from "../data-grid/types";

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

/** 稿子的时间样式：2026/9/23 11:38（本地时区，小时补零）。 */
function formatDateTime(value: unknown): string {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/**
 * 列定义必须是模块级常量（引用稳定，否则表格会被反复重建）。
 * `sortable: false` 的列 = 后端排序白名单里没有它，点表头不该发请求（会 400）。
 */
const COLUMNS: readonly DataGridColumn<PaymentLedgerRow>[] = [
  {
    key: "outNo",
    title: "支付单号",
    width: 190,
    minWidth: 170,
    frozen: true,
    mono: true,
  },
  {
    key: "customerName",
    title: "客户",
    width: 110,
    sortable: false,
    text: (value) => (value ? String(value) : "—"),
  },
  {
    key: "status",
    title: "状态",
    width: 96,
    filterHint: true,
    badge: (value) => {
      const status = String(value ?? "");
      if (status === "SUCCESS") return { label: "已支付", tone: "ok" };
      if (status === "PENDING") return { label: "待支付", tone: "wait" };
      if (status === "FAILED") return { label: "支付失败", tone: "bad" };
      return { label: status || "—", tone: "muted" };
    },
  },
  { key: "amountFen", title: "支付金额", money: true, width: 110 },
  {
    key: "refundedFen",
    title: "已退",
    money: true,
    width: 96,
    sortable: false,
  },
  {
    key: "refundableFen",
    title: "可退",
    money: true,
    width: 96,
    sortable: false,
  },
  {
    // 稿子：创建时间合成**一列两行**（第一行创建时间、第二行"支付 …"），不再是两列
    key: "createdAt",
    title: "创建时间",
    width: 150,
    text: (value) => formatDateTime(value),
    subtext: (value, row) =>
      row.paidAt ? `支付 ${formatDateTime(row.paidAt)}` : "支付 —",
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
  const refundCardRef = useRef<HTMLDivElement | null>(null);
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

  /** 行内「登记退款」：把这一行的支付单号填进下面的表单（动作本身 S4-7a 就有了）。 */
  const pickOutNo = useCallback((row: PaymentLedgerRow) => {
    setOutNo(row.outNo);
    refundCardRef.current?.scrollIntoView({ block: "nearest" });
  }, []);

  const actions = useMemo<readonly DataGridRowAction<PaymentLedgerRow>[]>(
    () => [
      {
        key: "refund",
        label: "登记退款",
        // 只有"已支付且还有没退完的钱"的单子能退；口径与后端一致（canRefund）
        when: (row) => row.canRefund,
        onClick: pickOutNo,
      },
    ],
    [pickOutNo],
  );

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
        actions={actions}
        statusOptions={STATUS_OPTIONS}
        exportPath="/api/v1/tenant/payments/orders/export.csv"
        exportFileName="payment-orders.csv"
        emptyHint="没有符合条件的支付单。客户在 H5 充值后会在这里出现。"
      />

      <Card ref={refundCardRef}>
        <CardHeader>
          <CardTitle>登记退款</CardTitle>
          <CardDescription>
            钱由门店在自己的商户号退给客户，这里只登记并扣客户钱包余额。表格里点「登记退款」即可带入支付单号。
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

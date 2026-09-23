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
import { Input } from "@/components/ui/input";
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

/**
 * S4-5c：门店「支付设置」最小页。
 *
 * 只做平台真正必需的三件事（见 docs/superpowers/plans/2026-09-23-wechatpay-partner-design.md 第 13 节，
 * 方案 A）：① 现在能不能收款 + 下一步谁做什么；② 登记子商户号；③ 点刷新问微信要最新状态。
 * **不做**进件表单与证件材料上传界面——那些是门店与微信之间的合规事项，平台不经手资金也不替门店报送。
 */

/** 与后端 `PaymentSetupView` 一一对应（apps/api/.../payments/application/payment-setup.service.ts）。 */
interface RejectDetailItem {
  field: string | null;
  fieldName: string | null;
  rejectReason: string | null;
}

interface PaymentSetupView {
  configured: boolean;
  status: "APPLYING" | "PENDING_CONFIRM" | "ACTIVE" | "SUSPENDED";
  nextAction: string;
  nextActionText: string;
  guidance: string;
  canAcceptPayment: boolean;
  subMchid: string | null;
  subAppid: string | null;
  applyNo: string | null;
  businessCode: string | null;
  providerState: string | null;
  providerStateMsg: string | null;
  authorizeState: string | null;
  rejectDetail: RejectDetailItem[];
  signUrl: string | null;
  source: "WECHAT_APPLYMENT" | "MANUAL_BIND" | null;
  submittedAt: string | null;
  lastSyncedAt: string | null;
}

const STATUS_LABEL: Record<PaymentSetupView["status"], string> = {
  APPLYING: "进件中",
  PENDING_CONFIRM: "待扫码签约",
  ACTIVE: "已可收款",
  SUSPENDED: "已停用 / 需人工核查",
};

const BADGE_VARIANT: Record<
  PaymentSetupView["status"],
  "default" | "secondary" | "outline" | "destructive"
> = {
  APPLYING: "outline",
  PENDING_CONFIRM: "secondary",
  ACTIVE: "default",
  SUSPENDED: "destructive",
};

const SOURCE_LABEL: Record<"WECHAT_APPLYMENT" | "MANUAL_BIND", string> = {
  WECHAT_APPLYMENT: "微信进件申请单",
  MANUAL_BIND: "人工登记子商户号",
};

const AUTHORIZE_LABEL: Record<string, string> = {
  AUTHORIZE_STATE_AUTHORIZED: "已授权（开户意愿确认完成）",
  AUTHORIZE_STATE_UNAUTHORIZED: "未授权（实名认证未完成）",
};

function statusLabel(view: PaymentSetupView): string {
  // 库里没有账户记录时，APPLYING 对外就是「未配置」，不显示会让人误以为已经提交过进件。
  return view.configured ? STATUS_LABEL[view.status] : "未配置";
}

function fmtTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "—";
}

/** 后端返回什么就显示什么；ApiError.message 就是后端文案，不做二次包装。 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function Inner() {
  const queryClient = useQueryClient();
  const [subMchidInput, setSubMchidInput] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const accountQuery = useQuery({
    queryKey: ["payments", "account"],
    queryFn: () =>
      apiFetch<PaymentSetupView>("/api/v1/tenant/payments/account"),
  });

  const refresh = useMutation({
    mutationFn: () =>
      apiFetch<PaymentSetupView>("/api/v1/tenant/payments/account/refresh", {
        method: "POST",
      }),
    onSuccess: (view) => {
      setMessage(null);
      setNotice(`已按微信返回刷新：${statusLabel(view)}`);
      queryClient.setQueryData(["payments", "account"], view);
    },
    onError: (error) => {
      setNotice(null);
      setMessage(errorText(error));
    },
  });

  const bind = useMutation({
    mutationFn: (subMchid: string) =>
      apiFetch<PaymentSetupView>("/api/v1/tenant/payments/account/bind", {
        method: "POST",
        body: JSON.stringify({ subMchid }),
      }),
    onSuccess: (view) => {
      setMessage(null);
      setNotice(`子商户号已登记：${view.subMchid ?? ""}`);
      setSubMchidInput("");
      queryClient.setQueryData(["payments", "account"], view);
    },
    onError: (error) => {
      setNotice(null);
      setMessage(errorText(error));
    },
  });

  const unauthorized =
    accountQuery.error instanceof ApiError && accountQuery.error.status === 401;
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

  const view = accountQuery.data;
  const detailRows: Array<[string, string]> = view
    ? (
        [
          ["子商户号", view.subMchid ?? "—"],
          ["子 AppID", view.subAppid ?? "—"],
          ["微信申请单号", view.applyNo ?? "—"],
          ["业务申请编号", view.businessCode ?? "—"],
          [
            "微信申请单状态",
            view.providerState
              ? `${view.providerState}${view.providerStateMsg ? `（${view.providerStateMsg}）` : ""}`
              : "—",
          ],
          [
            "开户意愿确认",
            view.authorizeState
              ? (AUTHORIZE_LABEL[view.authorizeState] ??
                `未识别状态：${view.authorizeState}`)
              : "—",
          ],
          ["资料提交方式", view.source ? SOURCE_LABEL[view.source] : "—"],
          ["资料提交时间", fmtTime(view.submittedAt)],
          ["最近同步时间", fmtTime(view.lastSyncedAt)],
        ] as Array<[string, string]>
      ).filter((row) => row[1] !== "—")
    : [];

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
              <CardTitle>收款状态</CardTitle>
              <CardDescription>
                现在能不能收款、下一步谁做什么。钱直接进门店自己的商户号，平台不经手资金。
              </CardDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {view ? (
                <Badge
                  variant={
                    view.configured ? BADGE_VARIANT[view.status] : "outline"
                  }
                  data-testid="payment-status-badge"
                >
                  {statusLabel(view)}
                </Badge>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                disabled={refresh.isPending}
                onClick={() => refresh.mutate()}
              >
                {refresh.isPending ? "刷新中…" : "刷新状态"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {accountQuery.isPending ? (
            <p className="text-sm text-muted-foreground">加载中…</p>
          ) : null}
          {accountQuery.isError ? (
            <p className="text-sm text-destructive">
              加载失败：{errorText(accountQuery.error)}
            </p>
          ) : null}
          {view ? (
            <>
              <div className="flex flex-col gap-2">
                <p className="text-sm">
                  <span className="text-muted-foreground">
                    现在能不能收款：
                  </span>
                  <span
                    className={
                      view.canAcceptPayment
                        ? "font-semibold text-emerald-600"
                        : "font-semibold"
                    }
                  >
                    {view.canAcceptPayment ? "能收款" : "还不能收款"}
                  </span>
                </p>
                <p className="text-sm">
                  <span className="text-muted-foreground">下一步：</span>
                  {view.nextActionText}
                </p>
                <p className="text-xs text-muted-foreground">
                  系统判定依据：{view.guidance}（下一步代码 {view.nextAction}）
                </p>
              </div>

              {detailRows.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-48">项目</TableHead>
                      <TableHead>内容</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detailRows.map(([label, value]) => (
                      <TableRow key={label}>
                        <TableCell className="text-muted-foreground">
                          {label}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {value}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">
                  还没有登记任何支付资料：按下面对话框登记子商户号，或先点「刷新状态」去微信查。
                </p>
              )}

              {view.rejectDetail.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">微信驳回原因</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-40">字段</TableHead>
                        <TableHead>驳回原因</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {view.rejectDetail.map((item, index) => (
                        <TableRow key={`${item.field ?? "row"}-${index}`}>
                          <TableCell className="text-xs">
                            {item.fieldName ?? item.field ?? "—"}
                          </TableCell>
                          <TableCell className="text-xs">
                            {item.rejectReason ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>登记子商户号</CardTitle>
          <CardDescription>
            门店在微信服务商后台开好户后，把子商户号填到这里（6-32
            位数字）。试运营按一对一开户，进件资料与证件由门店在微信侧提交，平台不在本页收。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">子商户号</span>
              <Input
                aria-label="子商户号"
                name="subMchid"
                inputMode="numeric"
                className="w-64 font-mono"
                placeholder={view?.subMchid ?? "6-32 位数字"}
                value={subMchidInput}
                onChange={(event) => setSubMchidInput(event.target.value)}
              />
            </div>
            <Button
              disabled={bind.isPending || subMchidInput.trim().length === 0}
              onClick={() => bind.mutate(subMchidInput.trim())}
            >
              {bind.isPending ? "登记中…" : "登记子商户号"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            登记与刷新都要门店老板账号（权限
            tenant.manage）；财务可看状态但不能改。登记完点上面「刷新状态」，查签约与实名进度。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function PaymentsSettingsPage() {
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
      <h1 className="text-2xl font-semibold tracking-tight">支付设置</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        门店收款状态、子商户号登记与状态刷新。
      </p>
      <div className="mt-6">
        <QueryClientProvider client={queryClient}>
          <Inner />
        </QueryClientProvider>
      </div>
    </TenantShell>
  );
}

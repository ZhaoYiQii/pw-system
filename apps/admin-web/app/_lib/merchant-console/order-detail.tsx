"use client";

/**
 * 订单详情（S4：整页迁移到新栈 + 挂载 v2 文案面板）。
 *
 * 迁移边界（仓库 AGENTS「改到即迁」）：
 * - 不再使用 mc-* 旧类，也不再用 demo-ui 的旧弹窗/提示；改用 components/ui + Tailwind；
 * - 数据流保持 TanStack Query，不改变接口、状态机、金额与权限判断；
 * - 文案只展示服务端返回的 document（v2）或历史 copyText（旧订单），前端不做拼装。
 */
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Clipboard,
  Copy,
  RefreshCw,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetch } from "../api";
import { formatFenYuan } from "../money";
import {
  type ApplicationView,
  type DispatchDetail,
  type OrderView,
  type SessionOfOrder,
  dateTime,
  statusLabel,
  toneFor,
} from "./merchant-api";
import { McDialog } from "./new-order-dialog";
import { OrderDocumentPanel } from "./order-document-panel";
import { useMerchantRole } from "./role-context";

/** 新栈提示：右下角浮层 + aria-live，替代 demo-ui 的 mc-toast。 */
function useToast(): {
  toast: ReactNode;
  showToast: (message: string) => void;
} {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 1800);
    return () => window.clearTimeout(timer);
  }, [message]);

  return {
    toast: message ? (
      <div
        role="status"
        aria-live="polite"
        className="fixed bottom-6 right-6 z-50 rounded-lg bg-foreground px-4 py-2 text-sm text-background shadow-lg"
      >
        {message}
      </div>
    ) : null,
    showToast: (text: string) => setMessage(text),
  };
}

function statusVariant(tone: string) {
  if (tone === "pending") return "outline" as const;
  if (tone === "dispatch") return "default" as const;
  if (tone === "assigned") return "secondary" as const;
  if (tone === "running") return "default" as const;
  if (tone === "done") return "secondary" as const;
  if (tone === "danger") return "destructive" as const;
  return "outline" as const;
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={statusVariant(toneFor(status))}>
      {statusLabel(status)}
    </Badge>
  );
}

/** 键值事实表。 */
function Facts({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex items-baseline justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
        >
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="truncate font-mono text-xs">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SectionHeading({
  title,
  hint,
  extra,
}: {
  title: string;
  hint?: string;
  extra?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {extra}
    </header>
  );
}

function ErrorNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
    >
      {message}
    </p>
  );
}

/** 新栈确认弹窗：复用 McDialog 壳（Esc/遮罩/焦点恢复），按钮由调用方给出。 */
function ConfirmDialog({
  open,
  title,
  confirmLabel,
  busy = false,
  onCancel,
  onConfirm,
  children,
}: {
  open: boolean;
  title: string;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children: ReactNode;
}) {
  return (
    <McDialog open={open} title={title} onClose={onCancel}>
      <div className="space-y-4">
        <div className="text-sm text-muted-foreground">{children}</div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button type="button" disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </McDialog>
  );
}

export function OrderDetailView({
  orderId,
  kind,
}: {
  orderId: string;
  kind: "CLASSIC" | "GD" | null;
}) {
  const { role } = useMerchantRole();
  if (kind === "CLASSIC") {
    return <ClassicOrderDetail orderId={orderId} role={role} />;
  }
  return <GdOrderDetail orderId={orderId} role={role} />;
}

// ---------------------------------------------------------------- GD
function GdOrderDetail({ orderId, role }: { orderId: string; role: string }) {
  const queryClient = useQueryClient();
  const { toast, showToast } = useToast();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [confirmAction, setConfirmAction] = useState<
    "publish" | "settle" | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["merchant", "dispatch", "gd", orderId],
    queryFn: () =>
      apiFetch<DispatchDetail>(
        `/api/v1/tenant/game-dispatch/orders/${orderId}`,
      ),
    retry: false,
  });
  const data = query.data;
  const canOperate = role === "OWNER" || role === "ADMIN" || role === "CS";

  const invalidate = () =>
    void queryClient.invalidateQueries({
      queryKey: ["merchant", "dispatch", "gd", orderId],
    });

  const publish = useMutation({
    mutationFn: () =>
      apiFetch<DispatchDetail>(
        `/api/v1/tenant/game-dispatch/orders/${orderId}/publish`,
        { method: "POST" },
      ),
    onSuccess: () => {
      setConfirmAction(null);
      showToast("派单已发布，报名通道开放。");
      invalidate();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const assign = useMutation({
    mutationFn: () =>
      apiFetch<DispatchDetail>(
        `/api/v1/tenant/game-dispatch/orders/${orderId}/assignment`,
        {
          method: "POST",
          body: JSON.stringify({ applicationIds: Array.from(checked) }),
        },
      ),
    onSuccess: () => {
      setChecked(new Set());
      showToast("已确认选中，可复制选定文案。");
      invalidate();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const removeApp = useMutation({
    mutationFn: (id: string) =>
      apiFetch<unknown>(`/api/v1/tenant/game-dispatch/applications/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      showToast("已移除报名。");
      invalidate();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const settle = useMutation({
    mutationFn: () =>
      apiFetch<{ totalFen: string; balanceAfterFen: string }>(
        `/api/v1/tenant/game-dispatch/orders/${orderId}/confirm-settlement`,
        { method: "POST" },
      ),
    onSuccess: (result) => {
      setConfirmAction(null);
      showToast(
        `结算完成：扣 ${formatFenYuan(result.totalFen)}，老板余额 ${formatFenYuan(result.balanceAfterFen)}。`,
      );
      invalidate();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${label}已复制。`);
    } catch {
      setError("浏览器未允许剪贴板，请手动复制。");
    }
  };

  if (query.isPending) {
    return <p className="p-6 text-sm text-muted-foreground">加载派单详情…</p>;
  }
  if (query.isError || !data) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <h1 className="text-base font-semibold">没有找到这张派单</h1>
          <p className="text-sm text-muted-foreground">
            {query.error instanceof Error ? query.error.message : "数据不存在"}
          </p>
          <Button asChild variant="outline">
            <Link href="/merchant-console/dispatch">返回订单台账</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const selectedText = data.lines
    .flatMap((line) =>
      line.applications
        .filter((a) => a.status === "SELECTED")
        .map((a) => `${a.playerName}（${line.positionLabel}）`),
    )
    .join("、");
  const selectedCount = data.lines.reduce(
    (sum, line) =>
      sum + line.applications.filter((a) => a.status === "SELECTED").length,
    0,
  );

  return (
    <div className="space-y-4">
      <Link
        href="/merchant-console/dispatch"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={15} aria-hidden="true" /> 返回订单与派单
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-muted-foreground">
            GAME_DISPATCH / DETAIL
          </p>
          <div className="flex items-center gap-2">
            <h1 className="font-mono text-lg font-semibold">
              {data.dispatchNo}
            </h1>
            <StatusBadge status={data.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            派单详情 · 复制文案后发送到陪玩群
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void copyText(data.copyText, "群文案")}
          >
            <Clipboard size={15} aria-hidden="true" /> 复制群文案
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              void copyText(
                selectedText
                  ? `已确认接单：${selectedText}；派单号：${data.dispatchNo}`
                  : "",
                "已选定文案",
              )
            }
          >
            <Copy size={15} aria-hidden="true" /> 复制已选定
          </Button>
        </div>
      </header>

      <ErrorNotice message={error} />

      <OrderDocumentPanel
        document={data.document ?? null}
        fallbackText={data.copyText}
      />

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <SectionHeading
                title="派单信息"
                hint="发布后生成报名与选人链接"
              />
              <Facts
                items={[
                  { label: "报名链接", value: data.applyUrl || "发布后生成" },
                  {
                    label: "老板选人链接",
                    value: data.bossUrl || "发布后生成",
                  },
                  {
                    label: "报名轮次",
                    value: data.round
                      ? `第 ${data.round.roundNo} 轮`
                      : "未开始",
                  },
                  {
                    label: "截止时间",
                    value: data.round ? dateTime(data.round.closesAt) : "-",
                  },
                ]}
              />
            </CardContent>
          </Card>

          {data.lines.length ? (
            <Card>
              <CardContent className="space-y-3 p-4">
                <SectionHeading
                  title="报名席位"
                  hint="勾选报名中的陪玩后可批量确认"
                  extra={
                    <span className="text-xs text-muted-foreground">
                      {data.lines.length} 个岗位
                    </span>
                  }
                />
                {data.lines.map((line) => {
                  const selected = line.applications.filter(
                    (a) => a.status === "SELECTED",
                  ).length;
                  const canPick = data.status === "DISPATCHING";
                  return (
                    <div
                      key={line.id}
                      className="space-y-2 rounded-lg border p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="font-medium">
                          {line.positionLabel} · 需要 {line.requiredCount} 人
                        </span>
                        <span className="text-muted-foreground">
                          {selected} / {line.requiredCount} 已确认
                        </span>
                      </div>
                      {line.applications.length === 0 ? (
                        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                          暂无报名，等待陪玩报名。
                        </p>
                      ) : null}
                      <ul className="space-y-1">
                        {line.applications.map((app) => {
                          const chosen = checked.has(app.id);
                          return (
                            <li
                              key={app.id}
                              className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm ${
                                chosen ? "border-primary bg-accent/40" : ""
                              }`}
                            >
                              <input
                                type="checkbox"
                                id={`pick-${app.id}`}
                                disabled={!canOperate || !canPick}
                                checked={app.status === "SELECTED" || chosen}
                                onChange={() =>
                                  setChecked((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(app.id)) next.delete(app.id);
                                    else next.add(app.id);
                                    return next;
                                  })
                                }
                              />
                              <label
                                htmlFor={`pick-${app.id}`}
                                className="flex flex-1 items-center gap-2"
                              >
                                <span
                                  aria-hidden="true"
                                  className="flex size-7 items-center justify-center rounded-full bg-muted text-xs"
                                >
                                  {app.playerName.slice(0, 1)}
                                </span>
                                <span>
                                  <b className="font-medium">
                                    {app.playerName}
                                  </b>
                                  <small className="block text-xs text-muted-foreground">
                                    {app.status === "APPLIED"
                                      ? "已报名"
                                      : app.status === "SELECTED"
                                        ? "已确认"
                                        : app.status}
                                    {" · "}
                                    {dateTime(app.createdAt)}
                                  </small>
                                </span>
                              </label>
                              {canOperate &&
                              canPick &&
                              app.status === "APPLIED" ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeApp.mutate(app.id)}
                                >
                                  移除
                                </Button>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <Card className="h-fit">
          <CardContent className="space-y-3 p-4">
            <SectionHeading
              title="派单动作"
              hint={canOperate ? "按状态开放" : "只读"}
            />
            <div className="space-y-1 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">当前状态</span>
                <b>{statusLabel(data.status)}</b>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">已选人数</span>
                <b>{selectedCount}</b>
              </div>
            </div>
            {canOperate && ["DRAFT", "CONFIRMED"].includes(data.status) ? (
              <Button
                type="button"
                className="w-full"
                onClick={() => setConfirmAction("publish")}
              >
                发布派单
              </Button>
            ) : null}
            {canOperate && data.status === "DISPATCHING" ? (
              <Button
                type="button"
                className="w-full"
                disabled={checked.size === 0 || assign.isPending}
                onClick={() => assign.mutate()}
              >
                确认选中 · {checked.size} 人
              </Button>
            ) : null}
            {canOperate && data.status === "PENDING_CONFIRMATION" ? (
              <Button
                type="button"
                className="w-full"
                onClick={() => setConfirmAction("settle")}
              >
                确认结算
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => invalidate()}
            >
              <RefreshCw size={14} aria-hidden="true" /> 刷新报名
            </Button>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmAction === "publish"}
        title="发布派单"
        confirmLabel="发布派单"
        busy={publish.isPending}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => publish.mutate()}
      >
        <p>{data.dispatchNo} 发布后将开放报名通道。</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmAction === "settle"}
        title="确认结算"
        confirmLabel="确认结算"
        busy={settle.isPending}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => settle.mutate()}
      >
        <p>确认按实际时长向老板扣费并结算陪玩收入？</p>
      </ConfirmDialog>
      {toast}
    </div>
  );
}

// ------------------------------------------------------------- CLASSIC
function ClassicOrderDetail({
  orderId,
  role,
}: {
  orderId: string;
  role: string;
}) {
  const queryClient = useQueryClient();
  const { toast, showToast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const canOperate = role === "OWNER" || role === "ADMIN" || role === "CS";

  const detailQuery = useQuery({
    queryKey: ["merchant", "dispatch", "classic", orderId],
    queryFn: () => apiFetch<OrderView>(`/api/v1/tenant/orders/${orderId}`),
    retry: false,
  });
  const detail = detailQuery.data;
  const applicationsQuery = useQuery({
    queryKey: ["merchant", "dispatch", "classic-apps", orderId],
    queryFn: () =>
      apiFetch<ApplicationView[]>(
        `/api/v1/tenant/orders/${orderId}/applications`,
      ),
    enabled:
      detail !== undefined &&
      [
        "DISPATCHING",
        "ASSIGNED",
        "READY",
        "IN_PROGRESS",
        "PENDING_CONFIRMATION",
      ].includes(detail.status),
    retry: false,
  });
  const sessionQuery = useQuery({
    queryKey: ["merchant", "dispatch", "classic-session", orderId],
    queryFn: () =>
      apiFetch<SessionOfOrder>(`/api/v1/tenant/orders/${orderId}/session`),
    enabled:
      detail !== undefined &&
      ["READY", "IN_PROGRESS", "PENDING_CONFIRMATION", "COMPLETED"].includes(
        detail.status,
      ),
    retry: false,
  });
  const applications = applicationsQuery.data ?? [];
  const sessionInfo = sessionQuery.data ?? null;

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: ["merchant", "dispatch", "classic", orderId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["merchant", "dispatch", "classic-apps", orderId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["merchant", "dispatch", "classic-session", orderId],
    });
  };

  const mutate = useMutation({
    mutationFn: (payload: { action: string; body?: unknown }) =>
      apiFetch<unknown>(`/api/v1/tenant/orders/${orderId}/${payload.action}`, {
        method: "POST",
        ...(payload.body !== undefined
          ? { body: JSON.stringify(payload.body) }
          : {}),
      }),
    onSuccess: () => {
      showToast("订单状态已更新。");
      invalidate();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const shortlist = useMutation({
    mutationFn: (applicationId: string) =>
      apiFetch<unknown>(
        `/api/v1/tenant/orders/${orderId}/applications/${applicationId}/shortlist`,
        {
          method: "POST",
          body: JSON.stringify({ shortlisted: true }),
        },
      ),
    onSuccess: () => {
      showToast("已加入候选。");
      invalidate();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  const assign = useMutation({
    mutationFn: (applicationId: string) =>
      apiFetch<unknown>(`/api/v1/tenant/orders/${orderId}/assignment`, {
        method: "POST",
        body: JSON.stringify({ applicationId }),
      }),
    onSuccess: () => {
      showToast("已指派陪玩。");
      invalidate();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  if (detailQuery.isPending) {
    return <p className="p-6 text-sm text-muted-foreground">加载订单…</p>;
  }
  if (detailQuery.isError || !detail) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <h1 className="text-base font-semibold">没有找到这张订单</h1>
          <p className="text-sm text-muted-foreground">
            {detailQuery.error instanceof Error
              ? detailQuery.error.message
              : "订单不存在"}
          </p>
          <Button asChild variant="outline">
            <Link href="/merchant-console/dispatch">返回订单台账</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const facts = detail.requirement
    ? [
        { label: "客户", value: detail.customerName },
        { label: "需求描述", value: detail.requirement.description || "-" },
        { label: "服务产品", value: detail.requirement.productName ?? "-" },
        {
          label: "计划时长",
          value: detail.requirement.durationSeconds
            ? `${Math.floor(detail.requirement.durationSeconds / 60)} 分钟`
            : "-",
        },
        {
          label: "期望开始",
          value: dateTime(detail.requirement.desiredStartAt),
        },
      ]
    : [{ label: "客户", value: detail.customerName }];

  return (
    <div className="space-y-4">
      <Link
        href="/merchant-console/dispatch"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={15} aria-hidden="true" /> 返回订单与派单
      </Link>

      <header className="space-y-1">
        <p className="font-mono text-xs text-muted-foreground">
          CLASSIC / DETAIL
        </p>
        <div className="flex items-center gap-2">
          <h1 className="font-mono text-lg font-semibold">{detail.orderNo}</h1>
          <StatusBadge status={detail.status} />
        </div>
        <p className="text-sm text-muted-foreground">{detail.customerName}</p>
      </header>

      <ErrorNotice message={error} />

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <SectionHeading title="订单信息" />
              <Facts items={facts} />
            </CardContent>
          </Card>

          {detail.snapshot && detail.snapshot.length > 0 ? (
            <Card>
              <CardContent className="space-y-3 p-4">
                <SectionHeading title="价格快照" hint="订单确认后冻结" />
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>产品</TableHead>
                      <TableHead>单价</TableHead>
                      <TableHead>小计</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.snapshot.map((snapshot, index) => (
                      <TableRow key={`${snapshot.productName}-${index}`}>
                        <TableCell>{snapshot.productName}</TableCell>
                        <TableCell>
                          {formatFenYuan(snapshot.unitPriceFen)}
                        </TableCell>
                        <TableCell>
                          {formatFenYuan(snapshot.lineTotalFen)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}

          {applications.length > 0 &&
          ["DISPATCHING", "ASSIGNED"].includes(detail.status) ? (
            <Card>
              <CardContent className="space-y-3 p-4">
                <SectionHeading
                  title={`报名（${applications.length}）`}
                  hint="报名后先入候选，再指派对应陪玩"
                />
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>陪玩</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>备注</TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {applications.map((app) => (
                      <TableRow key={app.id}>
                        <TableCell>{app.playerName}</TableCell>
                        <TableCell>
                          <StatusBadge status={app.status} />
                        </TableCell>
                        <TableCell>{app.playerNote ?? "-"}</TableCell>
                        <TableCell>
                          {detail.status === "DISPATCHING" ? (
                            <div className="flex gap-2">
                              {app.status === "APPLIED" ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => shortlist.mutate(app.id)}
                                >
                                  入候选
                                </Button>
                              ) : null}
                              {app.status === "SHORTLISTED" ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={assign.isPending}
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        `确认指派 ${app.playerName}？`,
                                      )
                                    ) {
                                      assign.mutate(app.id);
                                    }
                                  }}
                                >
                                  指派
                                </Button>
                              ) : null}
                            </div>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardContent className="space-y-3 p-4">
              <SectionHeading title="状态时间线" hint="服务端状态变更留痕" />
              {detail.timeline.length ? (
                <ol className="space-y-2 text-sm">
                  {detail.timeline.map((event, index) => (
                    <li
                      key={`${event.eventType}-${index}`}
                      className="rounded-lg border px-3 py-2"
                    >
                      <time className="font-mono text-xs text-muted-foreground">
                        {dateTime(event.occurredAt)}
                      </time>
                      <b className="ml-2">{event.eventType}</b>
                      <p className="text-xs text-muted-foreground">
                        {event.fromStatus ?? "—"} → {event.toStatus ?? "—"}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">
                  暂无状态变更记录。
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardContent className="space-y-3 p-4">
            <SectionHeading
              title="订单动作"
              hint={canOperate ? "按状态开放" : "只读"}
            />
            <div className="space-y-1 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">当前状态</span>
                <b>{statusLabel(detail.status)}</b>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">数据来源</span>
                <b>订单接口</b>
              </div>
            </div>
            <div className="space-y-2">
              {detail.status === "DRAFT" && canOperate ? (
                <>
                  <Button
                    type="button"
                    className="w-full"
                    onClick={() => mutate.mutate({ action: "confirm" })}
                  >
                    确认订单
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() =>
                      mutate.mutate({
                        action: "cancel",
                        body: { reason: "手动取消" },
                      })
                    }
                  >
                    取消
                  </Button>
                </>
              ) : null}
              {detail.status === "CONFIRMED" && canOperate ? (
                <>
                  <Button
                    type="button"
                    className="w-full"
                    onClick={() => mutate.mutate({ action: "publish" })}
                  >
                    发布派单
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() =>
                      mutate.mutate({
                        action: "cancel",
                        body: { reason: "手动取消" },
                      })
                    }
                  >
                    取消
                  </Button>
                </>
              ) : null}
              {["ASSIGNED", "READY"].includes(detail.status) && canOperate ? (
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => mutate.mutate({ action: "session/start" })}
                >
                  开始场次
                </Button>
              ) : null}
              {detail.status === "IN_PROGRESS" && canOperate ? (
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => mutate.mutate({ action: "session/end" })}
                >
                  结束场次
                </Button>
              ) : null}
              {detail.status === "PENDING_CONFIRMATION" && canOperate ? (
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => mutate.mutate({ action: "staff-confirm" })}
                >
                  客服确认完成
                </Button>
              ) : null}
            </div>
            {sessionInfo ? (
              <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                场次：{sessionInfo.status} · 开始{" "}
                {dateTime(sessionInfo.startedAt)} · 结束{" "}
                {dateTime(sessionInfo.endedAt)}
              </p>
            ) : null}
            <Button asChild variant="outline" className="w-full">
              <Link href="/merchant-console/sessions">
                查看场次与证据
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
      {toast}
    </div>
  );
}

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
import { ApiError, apiFetch } from "../../_lib/api";
import { TenantShell } from "../../_lib/tenant-shell";
import { formatFenYuan as yuan } from "../../_lib/money";

interface Customer {
  id: string;
  name: string;
  mobile: string | null;
}
interface GameProduct {
  id: string;
  name: string;
  enabled: boolean;
  gameName: string;
  regionName: string | null;
}
interface Pricing {
  id: string;
  durationSeconds: number;
  priceFen: string;
  playerCostFen: string;
  enabled: boolean;
}
interface OrderRow {
  id: string;
  orderNo: string;
  status: string;
  customerName: string;
  createdAt: string;
}
interface OrderView extends OrderRow {
  requirement: {
    description: string;
    gameName: string | null;
    productName: string | null;
    desiredStartAt: string | null;
    durationSeconds: number | null;
    note: string | null;
  } | null;
  snapshot: Array<{
    productName: string;
    unitPriceFen: string;
    lineTotalFen: string;
    durationSeconds: number;
  }> | null;
  timeline: Array<{
    eventType: string;
    fromStatus: string | null;
    toStatus: string | null;
    occurredAt: string;
  }>;
}
interface ApplicationView {
  id: string;
  orderId: string;
  playerId: string;
  playerName: string;
  status: string;
  playerNote: string | null;
  createdAt: string;
}
interface SessionView {
  id: string;
  orderId: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  adjustments: Array<{
    id: string;
    originalDurationSeconds: number;
    requestedDurationSeconds: number;
    status: string;
    reason: string;
  }>;
}

const STATUS: Record<
  string,
  { text: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  DRAFT: { text: "草稿", variant: "outline" },
  CONFIRMED: { text: "已确认", variant: "default" },
  DISPATCHING: { text: "派单中", variant: "secondary" },
  ASSIGNED: { text: "已指派", variant: "secondary" },
  READY: { text: "待开始", variant: "secondary" },
  IN_PROGRESS: { text: "服务中", variant: "default" },
  PENDING_CONFIRMATION: { text: "待确认", variant: "default" },
  COMPLETED: { text: "已完成", variant: "default" },
  CANCELLED: { text: "已取消", variant: "destructive" },
};

function Inner() {
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState("");
  const [productId, setProductId] = useState("");
  const [durationSeconds, setDurationSeconds] = useState("");
  const [description, setDescription] = useState("");
  const [desiredStart, setDesiredStart] = useState("");
  const [note, setNote] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const ordersQuery = useQuery({
    queryKey: ["orders"],
    queryFn: () => apiFetch<OrderRow[]>("/api/v1/tenant/orders"),
  });
  const customersQuery = useQuery({
    queryKey: ["customers"],
    queryFn: () => apiFetch<Customer[]>("/api/v1/tenant/customers"),
  });
  const productsQuery = useQuery({
    queryKey: ["catalog", "products"],
    queryFn: () => apiFetch<GameProduct[]>("/api/v1/tenant/catalog/products"),
  });
  const durationsQuery = useQuery({
    queryKey: ["catalog", "pricing", productId],
    queryFn: () =>
      apiFetch<Pricing[]>(
        `/api/v1/tenant/catalog/products/${productId}/pricing`,
      ),
    enabled: productId !== "",
  });
  const detailQuery = useQuery({
    queryKey: ["orders", "detail", detailId],
    queryFn: () => apiFetch<OrderView>(`/api/v1/tenant/orders/${detailId}`),
    enabled: detailId !== null,
  });
  const applicationsQuery = useQuery({
    queryKey: ["orders", "applications", detailId],
    queryFn: () =>
      apiFetch<ApplicationView[]>(
        `/api/v1/tenant/orders/${detailId}/applications`,
      ),
    enabled:
      detailId !== null &&
      detailQuery.data !== undefined &&
      [
        "DISPATCHING",
        "ASSIGNED",
        "READY",
        "IN_PROGRESS",
        "PENDING_CONFIRMATION",
      ].includes(detailQuery.data.status),
  });
  const sessionQuery = useQuery({
    queryKey: ["orders", "session", detailId],
    queryFn: () =>
      apiFetch<SessionView>(`/api/v1/tenant/orders/${detailId}/session`),
    enabled:
      detailId !== null &&
      detailQuery.data !== undefined &&
      ["READY", "IN_PROGRESS", "PENDING_CONFIRMATION", "COMPLETED"].includes(
        detailQuery.data.status,
      ),
  });

  const orders = ordersQuery.data ?? [];
  const customers = customersQuery.data ?? [];
  const products = (productsQuery.data ?? []).filter((p) => p.enabled);
  const durations = (durationsQuery.data ?? []).filter((d) => d.enabled);
  const detail = detailQuery.data ?? null;
  const applications = applicationsQuery.data ?? [];
  const sessionInfo = sessionQuery.data ?? null;

  const invalidateOrders = () =>
    void queryClient.invalidateQueries({ queryKey: ["orders"] });
  const invalidateDetail = () =>
    void queryClient.invalidateQueries({
      queryKey: ["orders", "detail", detailId],
    });

  const create = useMutation({
    mutationFn: (): Promise<OrderRow> =>
      apiFetch<OrderRow>("/api/v1/tenant/orders", {
        method: "POST",
        body: JSON.stringify({
          customerProfileId: customerId,
          requirement: {
            description,
            serviceProductId: productId,
            durationSeconds: Number(durationSeconds),
            ...(desiredStart
              ? { desiredStartAt: new Date(desiredStart).toISOString() }
              : {}),
            ...(note ? { note } : {}),
          },
        }),
      }),
    onSuccess: (order) => {
      setDescription("");
      setNote("");
      setDesiredStart("");
      setDurationSeconds("");
      setNotice(`已创建草稿 ${order.orderNo}。`);
      setDetailId(order.id);
      invalidateOrders();
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });

  const transition = useMutation({
    mutationFn: ({
      id,
      action,
    }: {
      id: string;
      action:
        "confirm" | "cancel" | "publish" | "session-start" | "session-end";
    }) => {
      if (action === "session-start" || action === "session-end") {
        return apiFetch<unknown>(
          `/api/v1/tenant/orders/${id}/session/${action === "session-start" ? "start" : "end"}`,
          { method: "POST" },
        );
      }
      const init: RequestInit = { method: "POST" };
      if (action === "cancel")
        init.body = JSON.stringify({ reason: "手动取消" });
      return apiFetch<unknown>(`/api/v1/tenant/orders/${id}/${action}`, init);
    },
    onSuccess: (_d, vars) => {
      setNotice(
        vars.action === "confirm"
          ? "订单已确认（价格快照已冻结）。"
          : vars.action === "publish"
            ? "已发布派单，等待陪玩报名。"
            : vars.action === "cancel"
              ? "订单已取消。"
              : vars.action === "session-start"
                ? "场次已开始。"
                : "场次已结束。",
      );
      invalidateOrders();
      invalidateDetail();
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });

  const staffConfirm = useMutation({
    mutationFn: (id: string) =>
      apiFetch<unknown>(`/api/v1/tenant/orders/${id}/staff-confirm`, {
        method: "POST",
      }),
    onSuccess: () => {
      setNotice("已完成客服确认与核算。");
      invalidateOrders();
      invalidateDetail();
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });

  const shortlist = useMutation({
    mutationFn: ({
      orderId,
      applicationId,
      shortlisted,
    }: {
      orderId: string;
      applicationId: string;
      shortlisted: boolean;
    }) =>
      apiFetch<unknown>(
        `/api/v1/tenant/orders/${orderId}/applications/${applicationId}/shortlist`,
        { method: "POST", body: JSON.stringify({ shortlisted }) },
      ),
    onSuccess: (_d, vars) => {
      setNotice(vars.shortlisted ? "已加入候选。" : "已移出候选。");
      invalidateDetail();
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });

  const assign = useMutation({
    mutationFn: ({
      orderId,
      applicationId,
    }: {
      orderId: string;
      applicationId: string;
    }) =>
      apiFetch<unknown>(`/api/v1/tenant/orders/${orderId}/assignment`, {
        method: "POST",
        body: JSON.stringify({ applicationId }),
      }),
    onSuccess: () => {
      setNotice("已指派陪玩。");
      invalidateOrders();
      invalidateDetail();
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });

  const busy =
    create.isPending ||
    transition.isPending ||
    staffConfirm.isPending ||
    shortlist.isPending ||
    assign.isPending;

  if (
    ordersQuery.error instanceof ApiError &&
    ordersQuery.error.status === 401
  ) {
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

  const statusMeta = detail
    ? (STATUS[detail.status] ?? {
        text: detail.status,
        variant: "outline" as const,
      })
    : null;

  return (
    <div className="flex flex-col gap-6">
      {notice ? <p className="text-sm text-emerald-600">{notice}</p> : null}
      {message ? <p className="text-sm text-destructive">{message}</p> : null}
      {ordersQuery.isError ? (
        <p className="text-sm text-destructive">
          加载失败：
          {ordersQuery.error instanceof Error
            ? ordersQuery.error.message
            : String(ordersQuery.error)}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>新建订单（草稿）</CardTitle>
          <CardDescription>
            从客户需求创建草稿，确认后冻结价格快照。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (customerId && productId && durationSeconds) create.mutate();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="customer">
                客户
              </label>
              <select
                id="customer"
                className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">选择客户…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}（{c.mobile ?? "无手机"}）
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="product">
                服务产品
              </label>
              <select
                id="product"
                className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={productId}
                onChange={(e) => {
                  setProductId(e.target.value);
                  setDurationSeconds("");
                }}
              >
                <option value="">选择产品…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.gameName} · {p.name}
                    {p.regionName ? `（${p.regionName}）` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="duration">
                时长
              </label>
              <select
                id="duration"
                className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={durationSeconds}
                onChange={(e) => setDurationSeconds(e.target.value)}
              >
                <option value="">
                  {productId && durationsQuery.isPending
                    ? "加载中…"
                    : "选择时长…"}
                </option>
                {durations.map((d) => (
                  <option key={d.id} value={d.durationSeconds}>
                    {Math.floor(d.durationSeconds / 60)} 分钟（
                    {yuan(d.priceFen)}）
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="desired-start">
                期望开始（可选）
              </label>
              <Input
                id="desired-start"
                type="datetime-local"
                value={desiredStart}
                onChange={(e) => setDesiredStart(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label className="text-sm font-medium" htmlFor="description">
                需求描述
              </label>
              <Input
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="例如：找陪玩带排位，要求段位钻石以上"
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label className="text-sm font-medium" htmlFor="note">
                备注（可选）
              </label>
              <Input
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <Button
                type="submit"
                disabled={busy || !customerId || !productId || !durationSeconds}
              >
                创建草稿
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>订单列表（{orders.length}）</CardTitle>
          <CardDescription>
            点击详情可管理派单、报名、场次与时间线。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {ordersQuery.isPending ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              加载中…
            </p>
          ) : null}
          {!ordersQuery.isPending && orders.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              暂无订单。
            </p>
          ) : null}
          {orders.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>单号</TableHead>
                  <TableHead>客户</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => {
                  const st = STATUS[o.status] ?? {
                    text: o.status,
                    variant: "outline" as const,
                  };
                  return (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium">{o.orderNo}</TableCell>
                      <TableCell>{o.customerName}</TableCell>
                      <TableCell>
                        <Badge variant={st.variant}>{st.text}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(o.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDetailId(o.id)}
                          >
                            详情
                          </Button>
                          {o.status === "DRAFT" ? (
                            <>
                              <Button
                                size="sm"
                                disabled={busy}
                                onClick={() =>
                                  transition.mutate({
                                    id: o.id,
                                    action: "confirm",
                                  })
                                }
                              >
                                确认
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() =>
                                  transition.mutate({
                                    id: o.id,
                                    action: "cancel",
                                  })
                                }
                              >
                                取消
                              </Button>
                            </>
                          ) : null}
                          {o.status === "CONFIRMED" ? (
                            <>
                              <Button
                                size="sm"
                                disabled={busy}
                                onClick={() =>
                                  transition.mutate({
                                    id: o.id,
                                    action: "publish",
                                  })
                                }
                              >
                                发布派单
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() =>
                                  transition.mutate({
                                    id: o.id,
                                    action: "cancel",
                                  })
                                }
                              >
                                取消
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>

      {detail ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>{detail.orderNo} · 详情</CardTitle>
                {statusMeta ? (
                  <Badge variant={statusMeta.variant} className="mt-1">
                    {statusMeta.text}
                  </Badge>
                ) : null}
              </div>
              <Button variant="outline" onClick={() => setDetailId(null)}>
                收起
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-1 text-sm">
              <p className="text-muted-foreground">
                客户：{detail.customerName}
              </p>
              {detail.requirement ? (
                <>
                  <p className="text-muted-foreground">
                    需求：{detail.requirement.description}
                  </p>
                  <p className="text-muted-foreground">
                    产品：{detail.requirement.productName ?? "未指定"} · 时长{" "}
                    {detail.requirement.durationSeconds
                      ? `${Math.floor(detail.requirement.durationSeconds / 60)} 分钟`
                      : "-"}
                  </p>
                </>
              ) : null}
            </div>
            {detail.snapshot && detail.snapshot.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>产品</TableHead>
                    <TableHead>单价</TableHead>
                    <TableHead>小计</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.snapshot.map((s, i) => (
                    <TableRow key={i}>
                      <TableCell>{s.productName}</TableCell>
                      <TableCell>{yuan(s.unitPriceFen)}</TableCell>
                      <TableCell>{yuan(s.lineTotalFen)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">
                尚未生成价格快照（确认后冻结）。
              </p>
            )}
            {["DISPATCHING", "ASSIGNED"].includes(detail.status) &&
            applications.length > 0 ? (
              <div className="rounded-lg border p-4">
                <h2 className="text-base font-semibold">
                  报名（{applications.length}）
                </h2>
                <Table className="mt-3">
                  <TableHeader>
                    <TableRow>
                      <TableHead>陪玩</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>备注</TableHead>
                      {detail.status === "DISPATCHING" ? (
                        <TableHead className="text-right">操作</TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {applications.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">
                          {a.playerName}
                        </TableCell>
                        <TableCell>{a.status}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {a.playerNote ?? "-"}
                        </TableCell>
                        {detail.status === "DISPATCHING" ? (
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              {a.status === "APPLIED" ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={shortlist.isPending}
                                  onClick={() =>
                                    shortlist.mutate({
                                      orderId: detail.id,
                                      applicationId: a.id,
                                      shortlisted: true,
                                    })
                                  }
                                >
                                  入候选
                                </Button>
                              ) : null}
                              {a.status === "SHORTLISTED" ? (
                                <>
                                  <Button
                                    size="sm"
                                    disabled={assign.isPending}
                                    onClick={() => {
                                      if (
                                        window.confirm(
                                          "确认指派该陪玩？其余有效报名将自动过期。",
                                        )
                                      ) {
                                        assign.mutate({
                                          orderId: detail.id,
                                          applicationId: a.id,
                                        });
                                      }
                                    }}
                                  >
                                    指派
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={shortlist.isPending}
                                    onClick={() =>
                                      shortlist.mutate({
                                        orderId: detail.id,
                                        applicationId: a.id,
                                        shortlisted: false,
                                      })
                                    }
                                  >
                                    移出候选
                                  </Button>
                                </>
                              ) : null}
                            </div>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
            {detail.status === "DISPATCHING" && applications.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                已发布，等待陪玩报名。
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {["ASSIGNED", "READY"].includes(detail.status) ? (
                <Button
                  disabled={transition.isPending}
                  onClick={() =>
                    transition.mutate({
                      id: detail.id,
                      action: "session-start",
                    })
                  }
                >
                  开始场次
                </Button>
              ) : null}
              {detail.status === "IN_PROGRESS" ? (
                <Button
                  disabled={transition.isPending}
                  onClick={() =>
                    transition.mutate({ id: detail.id, action: "session-end" })
                  }
                >
                  结束场次
                </Button>
              ) : null}
              {detail.status === "PENDING_CONFIRMATION" ? (
                <Button
                  disabled={staffConfirm.isPending}
                  onClick={() => staffConfirm.mutate(detail.id)}
                >
                  客服确认完成
                </Button>
              ) : null}
            </div>
            {sessionInfo ? (
              <p className="text-sm text-muted-foreground">
                场次：{sessionInfo.status} · 开始{" "}
                {sessionInfo.startedAt
                  ? new Date(sessionInfo.startedAt).toLocaleString()
                  : "-"}{" "}
                · 结束{" "}
                {sessionInfo.endedAt
                  ? new Date(sessionInfo.endedAt).toLocaleString()
                  : "-"}
              </p>
            ) : null}
            <div className="rounded-lg border p-4">
              <h2 className="text-base font-semibold">时间线</h2>
              <Table className="mt-3">
                <TableBody>
                  {detail.timeline.map((e, idx) => (
                    <TableRow key={idx}>
                      <TableCell>{e.eventType}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {e.fromStatus ?? "-"} → {e.toStatus ?? "-"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(e.occurredAt).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export default function OrdersPage() {
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
      <h1 className="text-2xl font-semibold tracking-tight">订单</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        创建草稿 → 确认冻结价格 → 发布/指派/场次 → 客服确认完成。
      </p>
      <div className="mt-6">
        <QueryClientProvider client={queryClient}>
          <Inner />
        </QueryClientProvider>
      </div>
    </TenantShell>
  );
}

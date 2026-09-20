"use client";

import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ApiError, apiFetch } from "../../../_lib/api";
import { formatFenYuan } from "../../../_lib/money";
import { TenantNav } from "../../../_lib/tenant-nav";

interface AppView {
  id: string;
  playerId: string;
  playerName: string;
  status: string;
  createdAt: string;
  /** 选中后落下的档位 id；未选中或被释放为 null（Task 5a：释放名额与记违约的入口）。 */
  slotId: string | null;
  /** 该陪玩在本单的单价（分/小时，不乘时长）；未设置底价为 null。 */
  unitPriceFen: string | null;
}
interface LineView {
  id: string;
  positionLabel: string;
  requiredCount: number;
  applications: AppView[];
}
interface DispatchDetail {
  dispatchNo: string;
  status: string;
  copyText: string;
  applyUrl: string;
  bossUrl: string;
  lines: LineView[];
  round: { roundNo: number; closesAt: string; status: string } | null;
  /** 费用口径（Task 5b-2/A）：只含链路里真实存在的数字。 */
  settlement: {
    orderAmountFen: string;
    playerShareFen: string;
    storeProfitFen: string;
    storeCutFen: string | null;
    platformFeeFen: string | null;
    splitApplied: boolean;
    approvedSlotCount: number;
    activeSlotCount: number;
  };
}
interface BreachView {
  id: string;
  playerId: string;
  playerName: string;
  orderId: string;
  orderSlotId: string | null;
  reason: string;
  createdAt: string;
}

function Inner({ orderId }: { orderId: string }) {
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ["game-dispatch-detail", orderId],
    queryFn: () =>
      apiFetch<DispatchDetail>(
        `/api/v1/tenant/game-dispatch/orders/${orderId}`,
      ),
  });

  // 违约记录台账（Task 5a）：按订单读取，记录违约后刷新。
  const breaches = useQuery({
    queryKey: ["game-dispatch-breaches", orderId],
    queryFn: () =>
      apiFetch<BreachView[]>(
        `/api/v1/tenant/game-dispatch/player-breaches?orderId=${orderId}`,
      ),
  });

  const refreshAll = () => {
    void queryClient.invalidateQueries({
      queryKey: ["game-dispatch-detail", orderId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["game-dispatch-breaches", orderId],
    });
  };

  // 释放名额（Task 4 API）：选中锁定后的唯一改派入口，订单会回到报名阶段并重开一轮。
  const releaseSlot = useMutation({
    mutationFn: ({ slotId, reason }: { slotId: string; reason?: string }) =>
      apiFetch<unknown>(
        `/api/v1/tenant/game-dispatch/slots/${slotId}/release`,
        {
          method: "POST",
          body: JSON.stringify(reason ? { reason } : {}),
        },
      ),
    onSuccess: () => {
      setMessage("已释放名额：订单回到报名阶段并重开一轮，可重新选人。");
      setChecked(new Set());
      refreshAll();
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });

  // 记录违约：人工认定放鸽子/未到场，写库 + 审计并通知老板。
  const recordBreach = useMutation({
    mutationFn: ({
      playerId,
      orderSlotId,
      reason,
    }: {
      playerId: string;
      orderSlotId?: string;
      reason: string;
    }) =>
      apiFetch<BreachView>(
        `/api/v1/tenant/game-dispatch/orders/${orderId}/player-breaches`,
        {
          method: "POST",
          body: JSON.stringify({
            playerId,
            ...(orderSlotId ? { orderSlotId } : {}),
            reason,
          }),
        },
      ),
    onSuccess: () => {
      setMessage("已记录违约，老板会收到站内通知。");
      refreshAll();
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });

  const removeApp = useMutation({
    mutationFn: (id: string) =>
      apiFetch<unknown>(`/api/v1/tenant/game-dispatch/applications/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      setMessage("已移除该报名。");
      void queryClient.invalidateQueries({
        queryKey: ["game-dispatch-detail", orderId],
      });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
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
      setMessage("已确认选中，可复制选定文案并 @ 对应陪玩。");
      setChecked(new Set());
      void queryClient.invalidateQueries({
        queryKey: ["game-dispatch-detail", orderId],
      });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });

  const publish = useMutation({
    mutationFn: () =>
      apiFetch<DispatchDetail>(
        `/api/v1/tenant/game-dispatch/orders/${orderId}/publish`,
        { method: "POST" },
      ),
    onSuccess: () => {
      setMessage("派单已发布，报名通道开放 10 分钟。");
      void queryClient.invalidateQueries({
        queryKey: ["game-dispatch-detail", orderId],
      });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });

  const settle = useMutation({
    mutationFn: () =>
      apiFetch<{ totalFen: string; balanceAfterFen: string }>(
        `/api/v1/tenant/game-dispatch/orders/${orderId}/confirm-settlement`,
        { method: "POST" },
      ),
    onSuccess: (result) => {
      setMessage(
        `结算完成，扣除 ${result.totalFen} 分，老板余额 ${result.balanceAfterFen} 分。`,
      );
      void queryClient.invalidateQueries({
        queryKey: ["game-dispatch-detail", orderId],
      });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });

  const copySelected = async () => {
    if (!data) return;
    const selected = data.lines
      .flatMap((l) =>
        l.applications
          .filter((a) => a.status === "SELECTED")
          .map((a) => `${a.playerName}（${l.positionLabel}）`),
      )
      .join("、");
    const text = selected
      ? `已确认接单：${selected}；派单号：${data.dispatchNo}`
      : "";
    try {
      await navigator.clipboard.writeText(text);
      setMessage(
        selected ? "已复制选定接单文案，可 @ 对应陪玩。" : "暂无已确认陪玩",
      );
    } catch {
      setMessage("复制失败，请手动复制。");
    }
  };

  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.copyText);
      setMessage("群文案已复制，可直接粘贴到陪玩群。");
    } catch {
      setMessage("复制失败，请手动选择文本复制。");
    }
  };

  if (isError) {
    return error instanceof ApiError && error.status === 401 ? (
      <Button asChild variant="outline">
        <Link href="/store/login">去登录</Link>
      </Button>
    ) : (
      <p className="text-sm text-destructive">
        加载失败：{error instanceof Error ? error.message : String(error)}
      </p>
    );
  }
  if (isPending || !data) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">加载中…</p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {message ? <p className="text-sm text-emerald-600">{message}</p> : null}
      <Card>
        <CardHeader>
          <CardTitle>{data.dispatchNo}</CardTitle>
          <CardDescription>
            复制后发到陪玩群；老板选人链接可转发给老板。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <pre className="whitespace-pre-wrap rounded-md bg-muted p-4 text-sm">
            {data.copyText}
          </pre>
          {data.applyUrl ? (
            <p className="break-all text-xs text-muted-foreground">
              报名链接：{data.applyUrl}
            </p>
          ) : null}
          {data.bossUrl ? (
            <p className="break-all text-xs text-muted-foreground">
              老板选人链接：{data.bossUrl}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void copy()}>复制群文案</Button>
            <Button variant="outline" onClick={() => void copySelected()}>
              复制已选定文案
            </Button>
            {["DRAFT", "CONFIRMED"].includes(data.status) ? (
              <Button
                onClick={() => publish.mutate()}
                disabled={publish.isPending}
              >
                发布派单
              </Button>
            ) : null}
            {/* 走查修复 F2：未备齐（生效档位为 0 或仍有档位未核定）时不给可点的结算入口。 */}
            {data.status === "PENDING_CONFIRMATION" &&
            data.settlement.activeSlotCount > 0 &&
            data.settlement.approvedSlotCount ===
              data.settlement.activeSlotCount ? (
              <Button
                disabled={settle.isPending}
                onClick={() => {
                  if (
                    window.confirm("确认按实际时长向老板扣费并结算陪玩收入？")
                  )
                    settle.mutate();
                }}
              >
                确认结算
              </Button>
            ) : null}
            {data.status === "PENDING_CONFIRMATION" &&
            (data.settlement.activeSlotCount === 0 ||
              data.settlement.approvedSlotCount <
                data.settlement.activeSlotCount) ? (
              <span className="self-center text-xs text-muted-foreground">
                {data.settlement.activeSlotCount === 0
                  ? "没有生效档位，无法结算：请先重新选人或取消订单。"
                  : `还有 ${data.settlement.activeSlotCount - data.settlement.approvedSlotCount} 个档位未完成报单审批，暂不能结算。`}
              </span>
            ) : null}
            <Button
              variant="outline"
              onClick={() =>
                void queryClient.invalidateQueries({
                  queryKey: ["game-dispatch-detail", orderId],
                })
              }
            >
              刷新报名
            </Button>
            <Button asChild variant="ghost">
              <Link href="/game-dispatch">返回列表</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {data.lines.map((line) => {
        // 走查修复 F3：「还差 N 人」按已选中人数算（原实现用勾选数，已选定后仍显示还差 1 人）。
        const selectedCount = line.applications.filter(
          (app) => app.status === "SELECTED",
        ).length;
        const remaining = Math.max(0, line.requiredCount - selectedCount);
        return (
          <Card key={line.id}>
            <CardHeader>
              <CardTitle>
                {line.positionLabel}（需 {line.requiredCount} 人）
              </CardTitle>
              <CardDescription>
                {remaining > 0 ? `还差 ${remaining} 人` : "人数已足够"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {line.applications.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">暂无报名。</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {line.applications.map((app) => (
                    <div
                      key={app.id}
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                    >
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          disabled={
                            app.status !== "APPLIED" ||
                            data.status !== "DISPATCHING"
                          }
                          checked={checked.has(app.id)}
                          onChange={(e) => {
                            const next = new Set(checked);
                            if (e.target.checked) next.add(app.id);
                            else next.delete(app.id);
                            setChecked(next);
                          }}
                        />
                        <span className="font-medium">{app.playerName}</span>
                        <span className="text-xs text-muted-foreground">
                          {app.status === "APPLIED" ? "已报名" : app.status}
                        </span>
                        {/* 走查修复 F5：商家端也展示单价（与老板端/陪玩端同一数字，不乘时长）。 */}
                        <span className="text-xs text-muted-foreground">
                          {app.unitPriceFen
                            ? `${formatFenYuan(app.unitPriceFen)} / 小时`
                            : "未设置底价"}
                        </span>
                      </label>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={
                            app.status !== "APPLIED" || removeApp.isPending
                          }
                          onClick={() => removeApp.mutate(app.id)}
                        >
                          移除报名
                        </Button>
                        {/* Task 5a：已选中的档位可释放名额（回到报名阶段），并可人工记违约。 */}
                        {app.slotId ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={releaseSlot.isPending}
                            onClick={() => {
                              const reason = window.prompt(
                                `释放 ${app.playerName} 的名额？填写原因（可留空）：`,
                                "",
                              );
                              if (reason === null) return;
                              if (
                                window.confirm(
                                  "释放后该档位作废、订单回到报名阶段并重开一轮报名。确认释放？",
                                )
                              )
                                releaseSlot.mutate({
                                  slotId: app.slotId as string,
                                  ...(reason.trim()
                                    ? { reason: reason.trim() }
                                    : {}),
                                });
                            }}
                          >
                            释放名额
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={recordBreach.isPending}
                          onClick={() => {
                            const reason = window.prompt(
                              `记录 ${app.playerName} 的违约（如未到场/放鸽子）：`,
                              "",
                            );
                            if (reason === null || reason.trim() === "") return;
                            recordBreach.mutate({
                              playerId: app.playerId,
                              ...(app.slotId
                                ? { orderSlotId: app.slotId }
                                : {}),
                              reason: reason.trim(),
                            });
                          }}
                        >
                          记违约
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
      <div>
        <Button
          disabled={
            checked.size === 0 ||
            data.status !== "DISPATCHING" ||
            assign.isPending
          }
          onClick={() => assign.mutate()}
        >
          确认选中的陪玩
        </Button>
      </div>

      {/* 违约记录台账（Task 5a）：按订单读取，随记违约即时刷新。 */}
      <Card>
        <CardHeader>
          <CardTitle>违约记录</CardTitle>
          <CardDescription>
            人工认定放鸽子/未到场后记录；记录会通知老板，并作为后续选人参考。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {breaches.isPending ? (
            <p className="text-sm text-muted-foreground">加载中…</p>
          ) : (breaches.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">本单暂无违约记录。</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {(breaches.data ?? []).map((breach) => (
                <li
                  key={breach.id}
                  className="rounded-md border px-3 py-2 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{breach.playerName}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(breach.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-muted-foreground">{breach.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* 费用口径（Task 5b-2/A）：只展示链路里真实存在的数字；抽成未落地就写明未落地。 */}
      <Card>
        <CardHeader>
          <CardTitle>费用口径</CardTitle>
          <CardDescription>
            金额按已核定的报单时长计算；确认结算会按“老板支出”扣老板钱包。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">老板支出</span>
            <span className="font-medium">
              {formatFenYuan(data.settlement.orderAmountFen)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">陪玩实收</span>
            <span className="font-medium">
              {formatFenYuan(data.settlement.playerShareFen)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">门店抽成</span>
            <span className="font-medium text-muted-foreground">
              {data.settlement.storeCutFen === null
                ? "未分账"
                : formatFenYuan(data.settlement.storeCutFen)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">门店毛利</span>
            <span className="font-medium">
              {formatFenYuan(data.settlement.storeProfitFen)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            已核定档位 {data.settlement.approvedSlotCount} / 生效档位{" "}
            {data.settlement.activeSlotCount}。
            {data.settlement.approvedSlotCount < data.settlement.activeSlotCount
              ? "还有档位未完成报单审批，确认结算前请先审批。"
              : ""}
          </p>
          {!data.settlement.splitApplied ? (
            <p className="text-xs text-amber-600">
              门店抽成与平台费尚未在本链路分账：陪玩按档位金额整额发放，抽成/平台费暂不参与计算（规格
              §3.2 待落地）。
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

export default function GameDispatchDetailPage() {
  const params = useParams<{ orderId: string }>();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <main className="min-h-screen bg-[#f4f5f7]">
      <TenantNav />
      <div className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">派单详情</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          复制群文案、刷新报名并确认陪玩。
        </p>
        <div className="mt-6">
          <QueryClientProvider client={queryClient}>
            <Inner orderId={params.orderId} />
          </QueryClientProvider>
        </div>
      </div>
    </main>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Clipboard, Copy, RefreshCw } from "lucide-react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "../api";
import { formatFenYuan } from "../money";
import { DemoDialog, DemoEmptyState, useDemoToast } from "./demo-ui";
import {
  type ApplicationView,
  type DispatchDetail,
  type OrderView,
  type SessionOfOrder,
  dateTime,
  statusLabel,
  toneFor,
} from "./merchant-api";
import { useMerchantRole } from "./role-context";

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
function GdOrderDetail({
  orderId,
  role,
}: {
  orderId: string;
  role: string;
}) {
  const queryClient = useQueryClient();
  const { toast, showToast } = useDemoToast();
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
    return <div className="mc-empty">加载派单详情…</div>;
  }
  if (query.isError || !data) {
    return (
      <section className="mc-panel">
        <DemoEmptyState
          title="没有找到这张派单"
          description={
            query.error instanceof Error ? query.error.message : "数据不存在"
          }
        >
          <Link href="/merchant-console/dispatch" className="mc-btn">
            返回订单台账
          </Link>
        </DemoEmptyState>
      </section>
    );
  }

  const selectedText = data.lines
    .flatMap((line) =>
      line.applications
        .filter((a) => a.status === "SELECTED")
        .map((a) => `${a.playerName}（${line.positionLabel}）`),
    )
    .join("、");

  return (
    <div>
      <Link href="/merchant-console/dispatch" className="mc-back">
        <ArrowLeft size={15} /> 返回订单与派单
      </Link>
      <div className="mc-pagehead mc-detail-head">
        <div>
          <div className="mc-kicker">GAME_DISPATCH / DETAIL</div>
          <div className="mc-detail-title">
            <h1 className="mc-mono">{data.dispatchNo}</h1>
            <span className={`mc-status st-${toneFor(data.status)}`}>
              {statusLabel(data.status)}
            </span>
          </div>
          <p>派单详情 · 复制文案后发送到陪玩群</p>
        </div>
        <div className="mc-button-row">
          <button
            type="button"
            className="mc-btn"
            onClick={() => void copyText(data.copyText, "群文案")}
          >
            <Clipboard size={15} /> 复制群文案
          </button>
          <button
            type="button"
            className="mc-btn"
            onClick={() =>
              void copyText(
                selectedText
                  ? `已确认接单：${selectedText}；派单号：${data.dispatchNo}`
                  : "",
                "已选定文案",
              )
            }
          >
            <Copy size={15} /> 复制已选定
          </button>
        </div>
      </div>

      {error ? <div className="mc-notice">{error}</div> : null}

      <div className="mc-detailgrid">
        <div>
          <section className="mc-panel mc-facts">
            <dl className="mc-fact">
              <dt>报名链接</dt>
              <dd className="mc-mono">{data.applyUrl || "发布后生成"}</dd>
            </dl>
            <dl className="mc-fact">
              <dt>老板选人链接</dt>
              <dd className="mc-mono">{data.bossUrl || "发布后生成"}</dd>
            </dl>
            <dl className="mc-fact">
              <dt>报名轮次</dt>
              <dd className="mc-mono">
                {data.round ? `第 ${data.round.roundNo} 轮` : "未开始"}
              </dd>
            </dl>
            {data.round ? (
              <dl className="mc-fact">
                <dt>截止时间</dt>
                <dd className="mc-mono">{dateTime(data.round.closesAt)}</dd>
              </dl>
            ) : null}
          </section>

          {data.lines.length ? (
            <section className="mc-panel mc-applicants">
              <div className="mc-section-head">
                <div>
                  <h2>报名席位</h2>
                  <p>勾选报名中的陪玩后可批量确认</p>
                </div>
                <span className="mc-sub">{data.lines.length} 个岗位</span>
              </div>
              {data.lines.map((line) => {
                const selected = line.applications.filter(
                  (a) => a.status === "SELECTED",
                ).length;
                const canPick = data.status === "DISPATCHING";
                return (
                  <div key={line.id} className="mc-role-label">
                    <span>
                      {line.positionLabel} · 需要 {line.requiredCount} 人
                    </span>
                    <span>
                      {selected} / {line.requiredCount} 已确认
                    </span>
                    <div className="mc-seats mc-seats-inline">
                      {line.applications.map((app) => {
                        const chosen = checked.has(app.id);
                        return (
                          <div
                            className={`mc-candidate${chosen ? " chosen" : ""}`}
                            key={app.id}
                          >
                            <input
                              type="checkbox"
                              id={`pick-${app.id}`}
                              disabled={!canOperate || !canPick}
                              checked={
                                app.status === "SELECTED" || chosen
                              }
                              onChange={() =>
                                setChecked((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(app.id)) next.delete(app.id);
                                  else next.add(app.id);
                                  return next;
                                })
                              }
                            />
                            <label htmlFor={`pick-${app.id}`}>
                              <span className="mc-avatar mc-avatar-sm" aria-hidden="true">
                                {app.playerName.slice(0, 1)}
                              </span>
                              <span>
                                <b>{app.playerName}</b>
                                <small>
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
                            {canOperate && canPick && app.status === "APPLIED" ? (
                              <button
                                type="button"
                                className="mc-remove"
                                onClick={() => removeApp.mutate(app.id)}
                              >
                                移除
                              </button>
                            ) : null}
                          </div>
                        );
                      })}
                      {line.applications.length === 0 ? (
                        <div className="mc-empty mc-empty-compact">
                          暂无报名，等待陪玩报名。
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </section>
          ) : null}
        </div>

        <aside className="mc-panel mc-review">
          <div className="mc-review-top">
            <h2>派单动作</h2>
            <span>{canOperate ? "按状态开放" : "只读"}</span>
          </div>
          <div className="mc-review-group">
            <div className="mc-summary-line">
              <span>当前状态</span>
              <b>{statusLabel(data.status)}</b>
            </div>
            <div className="mc-summary-line">
              <span>已选人数</span>
              <b>
                {data.lines.reduce(
                  (sum, line) =>
                    sum +
                    line.applications.filter(
                      (a) => a.status === "SELECTED",
                    ).length,
                  0,
                )}
              </b>
            </div>
          </div>
          {canOperate && ["DRAFT", "CONFIRMED"].includes(data.status) ? (
            <button
              type="button"
              className="mc-btn mc-btn-primary mc-review-confirm"
              onClick={() => setConfirmAction("publish")}
            >
              发布派单
            </button>
          ) : null}
          {canOperate && data.status === "DISPATCHING" ? (
            <button
              type="button"
              className="mc-btn mc-btn-primary mc-review-confirm"
              disabled={checked.size === 0 || assign.isPending}
              onClick={() => assign.mutate()}
            >
              确认选中 · {checked.size} 人
            </button>
          ) : null}
          {canOperate && data.status === "PENDING_CONFIRMATION" ? (
            <button
              type="button"
              className="mc-btn mc-btn-primary mc-review-confirm"
              onClick={() => setConfirmAction("settle")}
            >
              确认结算
            </button>
          ) : null}
          <button
            type="button"
            className="mc-btn mc-btn-ghost"
            onClick={() => invalidate()}
          >
            <RefreshCw size={14} /> 刷新报名
          </button>
        </aside>
      </div>

      <DemoDialog
        open={confirmAction === "publish"}
        title="发布派单"
        confirmLabel="发布派单"
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => publish.mutate()}
      >
        <p>{data.dispatchNo} 发布后将开放报名通道。</p>
      </DemoDialog>
      <DemoDialog
        open={confirmAction === "settle"}
        title="确认结算"
        confirmLabel="确认结算"
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => settle.mutate()}
      >
        <p>确认按实际时长向老板扣费并结算陪玩收入？</p>
      </DemoDialog>
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
  const { toast, showToast } = useDemoToast();
  const [error, setError] = useState<string | null>(null);
  const canOperate = role === "OWNER" || role === "ADMIN" || role === "CS";

  const detailQuery = useQuery({
    queryKey: ["merchant", "dispatch", "classic", orderId],
    queryFn: () =>
      apiFetch<OrderView>(`/api/v1/tenant/orders/${orderId}`),
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
      ["DISPATCHING", "ASSIGNED", "READY", "IN_PROGRESS", "PENDING_CONFIRMATION"].includes(
        detail.status,
      ),
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
    mutationFn: (payload: {
      action: string;
      body?: unknown;
    }) =>
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

  if (detailQuery.isPending) return <div className="mc-empty">加载订单…</div>;
  if (detailQuery.isError || !detail) {
    return (
      <section className="mc-panel">
        <DemoEmptyState
          title="没有找到这张订单"
          description={
            detailQuery.error instanceof Error
              ? detailQuery.error.message
              : "订单不存在"
          }
        >
          <Link href="/merchant-console/dispatch" className="mc-btn">
            返回订单台账
          </Link>
        </DemoEmptyState>
      </section>
    );
  }

  const facts = detail.requirement
    ? [
        { label: "客户", value: detail.customerName },
        { label: "需求描述", value: detail.requirement.description || "-" },
        {
          label: "服务产品",
          value: detail.requirement.productName ?? "-",
        },
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
    <div>
      <Link href="/merchant-console/dispatch" className="mc-back">
        <ArrowLeft size={15} /> 返回订单与派单
      </Link>
      <div className="mc-pagehead mc-detail-head">
        <div>
          <div className="mc-kicker">CLASSIC / DETAIL</div>
          <div className="mc-detail-title">
            <h1 className="mc-mono">{detail.orderNo}</h1>
            <span className={`mc-status st-${toneFor(detail.status)}`}>
              {statusLabel(detail.status)}
            </span>
          </div>
          <p>{detail.customerName}</p>
        </div>
      </div>
      {error ? <div className="mc-notice">{error}</div> : null}

      <div className="mc-detailgrid">
        <div>
          <section className="mc-panel mc-facts">
            {facts.map((fact) => (
              <dl className="mc-fact" key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </dl>
            ))}
          </section>

          {detail.snapshot && detail.snapshot.length > 0 ? (
            <section className="mc-panel">
              <div className="mc-section-head">
                <div>
                  <h2>价格快照</h2>
                  <p>订单确认后冻结</p>
                </div>
              </div>
              <div className="mc-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>产品</th>
                      <th>单价</th>
                      <th>小计</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.snapshot.map((s, i) => (
                      <tr key={i}>
                        <td>{s.productName}</td>
                        <td>{formatFenYuan(s.unitPriceFen)}</td>
                        <td>{formatFenYuan(s.lineTotalFen)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {applications.length > 0 &&
          ["DISPATCHING", "ASSIGNED"].includes(detail.status) ? (
            <section className="mc-panel">
              <div className="mc-section-head">
                <div>
                  <h2>报名（{applications.length}）</h2>
                  <p>报名后先入候选，再指派对应陪玩</p>
                </div>
              </div>
              <div className="mc-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>陪玩</th>
                      <th>状态</th>
                      <th>备注</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {applications.map((app) => (
                      <tr key={app.id}>
                        <td>{app.playerName}</td>
                        <td>
                          <span className={`mc-status st-${toneFor(app.status)}`}>
                            {app.status}
                          </span>
                        </td>
                        <td>{app.playerNote ?? "-"}</td>
                        <td>
                          {detail.status === "DISPATCHING" ? (
                            <div className="mc-button-row">
                              {app.status === "APPLIED" ? (
                                <button
                                  type="button"
                                  className="mc-btn mc-btn-ghost mc-btn-small"
                                  onClick={() => shortlist.mutate(app.id)}
                                >
                                  入候选
                                </button>
                              ) : null}
                              {app.status === "SHORTLISTED" ? (
                                <button
                                  type="button"
                                  className="mc-btn mc-btn-primary mc-btn-small"
                                  disabled={assign.isPending}
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        `确认指派 ${app.playerName}？`,
                                      )
                                    )
                                      assign.mutate(app.id);
                                  }}
                                >
                                  指派
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section className="mc-panel">
            <div className="mc-section-head">
              <div>
                <h2>状态时间线</h2>
                <p>服务端状态变更留痕</p>
              </div>
            </div>
            {detail.timeline.length ? (
              <ol className="mc-timeline">
                {detail.timeline.map((e, idx) => (
                  <li key={idx}>
                    <time>{dateTime(e.occurredAt)}</time>
                    <b>{e.eventType}</b>
                    <p>
                      {e.fromStatus ?? "—"} → {e.toStatus ?? "—"}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mc-muted-text">暂无状态变更记录。</p>
            )}
          </section>
        </div>

        <aside className="mc-panel mc-review">
          <div className="mc-review-top">
            <h2>订单动作</h2>
            <span>{canOperate ? "按状态开放" : "只读"}</span>
          </div>
          <div className="mc-review-group">
            <div className="mc-summary-line">
              <span>当前状态</span>
              <b>{statusLabel(detail.status)}</b>
            </div>
            <div className="mc-summary-line">
              <span>数据来源</span>
              <b>订单接口</b>
            </div>
          </div>
          <div className="mc-button-row">
            {detail.status === "DRAFT" && canOperate ? (
              <>
                <button
                  type="button"
                  className="mc-btn mc-btn-primary"
                  onClick={() => mutate.mutate({ action: "confirm" })}
                >
                  确认订单
                </button>
                <button
                  type="button"
                  className="mc-btn"
                  onClick={() =>
                    mutate.mutate({
                      action: "cancel",
                      body: { reason: "手动取消" },
                    })
                  }
                >
                  取消
                </button>
              </>
            ) : null}
            {detail.status === "CONFIRMED" && canOperate ? (
              <>
                <button
                  type="button"
                  className="mc-btn mc-btn-primary"
                  onClick={() => mutate.mutate({ action: "publish" })}
                >
                  发布派单
                </button>
                <button
                  type="button"
                  className="mc-btn"
                  onClick={() =>
                    mutate.mutate({
                      action: "cancel",
                      body: { reason: "手动取消" },
                    })
                  }
                >
                  取消
                </button>
              </>
            ) : null}
            {["ASSIGNED", "READY"].includes(detail.status) && canOperate ? (
              <button
                type="button"
                className="mc-btn mc-btn-primary"
                onClick={() =>
                  mutate.mutate({ action: "session/start" })
                }
              >
                开始场次
              </button>
            ) : null}
            {detail.status === "IN_PROGRESS" && canOperate ? (
              <button
                type="button"
                className="mc-btn mc-btn-primary"
                onClick={() => mutate.mutate({ action: "session/end" })}
              >
                结束场次
              </button>
            ) : null}
            {detail.status === "PENDING_CONFIRMATION" && canOperate ? (
              <button
                type="button"
                className="mc-btn mc-btn-primary"
                onClick={() => mutate.mutate({ action: "staff-confirm" })}
              >
                客服确认完成
              </button>
            ) : null}
          </div>
          {sessionInfo ? (
            <div className="mc-notice">
              场次：{sessionInfo.status} · 开始{" "}
              {dateTime(sessionInfo.startedAt)} · 结束{" "}
              {dateTime(sessionInfo.endedAt)}
            </div>
          ) : null}
          <Link
            href="/merchant-console/sessions"
            className="mc-btn mc-btn-ghost"
          >
            查看场次与证据
            <ArrowRight size={14} />
          </Link>
        </aside>
      </div>
      {toast}
    </div>
  );
}

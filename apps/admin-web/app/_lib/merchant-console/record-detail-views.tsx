"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Image, RefreshCw } from "lucide-react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch, getAccessToken } from "../api";
import { formatFenYuan } from "../money";
import { useDemoToast } from "./demo-ui";
import type {
  CustomerAccount,
  CustomerOrderHistory,
  CustomerRow,
  DisputeDetail,
  PlayerAccount,
  PlayerDetail,
  SessionDetail,
} from "./record-api";

const API_ORIGIN =
  process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://127.0.0.1:3000";

export function CustomerDetailView({ id }: { id: string }) {
  const customerQuery = useQuery({
    queryKey: ["mc-customer-detail", id],
    queryFn: () => apiFetch<CustomerRow>(`/api/v1/tenant/customers/${id}`),
  });
  const accountQuery = useQuery({
    queryKey: ["mc-customer-account", id],
    queryFn: () =>
      apiFetch<CustomerAccount>(`/api/v1/tenant/customers/${id}/account`),
  });
  const ordersQuery = useQuery({
    queryKey: ["mc-customer-orders", id],
    queryFn: () =>
      apiFetch<CustomerOrderHistory[]>(
        `/api/v1/tenant/customers/${id}/orders`,
      ),
  });

  const customer = customerQuery.data;
  const wallet = accountQuery.data?.wallet ?? null;
  const orders = ordersQuery.data ?? [];

  return (
    <div>
      <BackLink href="/merchant-console/customers" label="返回客户档案" />
      {customerQuery.isPending ? (
        <p className="mc-loading-text">加载中…</p>
      ) : null}
      {!customer ? null : (
        <>
          <div className="mc-pagehead">
            <div>
              <div className="mc-kicker">CUSTOMER DETAIL</div>
              <h1>{customer.name}</h1>
              <p>
                {customer.mobile ?? "无手机"} ·{" "}
                {customer.status === "ACTIVE" ? "正常" : "已停用"}
              </p>
            </div>
          </div>
          <div className="mc-record-grid">
            <div>
              <section className="mc-panel">
                <div className="mc-section-head">
                  <div>
                    <h2>账户与余额</h2>
                    <p>老板钱包余额与账变流水</p>
                  </div>
                </div>
                {wallet === null ? (
                  <p className="mc-empty-compact">
                    该客户尚未开通老板钱包，暂无余额流水。
                  </p>
                ) : (
                  <>
                    <div className="mc-summary-line">
                      <span>老板编号</span>
                      <b className="mc-mono">{wallet.bossNo}</b>
                    </div>
                    <div className="mc-summary-line">
                      <span>账户余额</span>
                      <b>{formatFenYuan(wallet.balanceFen)}</b>
                    </div>
                    {wallet.entries.length === 0 ? (
                      <p className="mc-empty-compact">暂无流水。</p>
                    ) : (
                      <div className="mc-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>时间</th>
                              <th>类型</th>
                              <th>原因</th>
                              <th>变动</th>
                              <th>余额</th>
                            </tr>
                          </thead>
                          <tbody>
                            {wallet.entries.map((entry) => (
                              <tr key={entry.id}>
                                <td>{new Date(entry.createdAt).toLocaleString()}</td>
                                <td>{walletTypeLabel(entry.type)}</td>
                                <td>{entry.reason ?? "-"}</td>
                                <td
                                  className={
                                    entry.type === "RECHARGE"
                                      ? "mc-mono"
                                      : "mc-mono mc-form-error"
                                  }
                                >
                                  {entry.type === "RECHARGE" ? "+" : "-"}
                                  {formatFenYuan(entry.amountFen)}
                                </td>
                                <td className="mc-mono">
                                  {formatFenYuan(entry.balanceAfterFen)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </section>
              <section className="mc-panel">
                <div className="mc-section-head">
                  <div>
                    <h2>历史订单（{orders.length}）</h2>
                    <p>CLASSIC 与 GAME_DISPATCH 双流程</p>
                  </div>
                </div>
                {orders.length === 0 ? (
                  <p className="mc-empty-compact">暂无订单。</p>
                ) : (
                  <div className="mc-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>订单号</th>
                          <th>流程</th>
                          <th>状态</th>
                          <th>创建时间</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders.map((order) => (
                          <tr key={order.orderId}>
                            <td className="mc-mono">{order.orderNo}</td>
                            <td>
                              {order.processType === "GAME_DISPATCH"
                                ? "GD"
                                : "CLASSIC"}
                            </td>
                            <td>{order.status}</td>
                            <td>{new Date(order.createdAt).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function PlayerDetailView({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const { showToast } = useDemoToast();
  const [skillGameId, setSkillGameId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");

  const playerQuery = useQuery({
    queryKey: ["mc-player-detail", id],
    queryFn: () => apiFetch<PlayerDetail>(`/api/v1/tenant/players/${id}`),
  });
  const accountQuery = useQuery({
    queryKey: ["mc-player-account", id],
    queryFn: () => apiFetch<PlayerAccount>(`/api/v1/tenant/players/${id}/account`),
  });
  const gamesQuery = useQuery({
    queryKey: ["mc-catalog-games"],
    queryFn: () =>
      apiFetch<Array<{ id: string; name: string; enabled: boolean }>>(
        "/api/v1/tenant/catalog/games",
      ),
  });

  const player = playerQuery.data;
  const account = accountQuery.data;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["mc-player-detail", id] });
    void queryClient.invalidateQueries({ queryKey: ["mc-player-account", id] });
  };
  const addSkill = useMutation({
    mutationFn: () =>
      apiFetch<unknown>(`/api/v1/tenant/players/${id}/skills`, {
        method: "POST",
        body: JSON.stringify({ gameId: skillGameId }),
      }),
    onSuccess: () => {
      setSkillGameId("");
      refresh();
    },
    onError: (error) =>
      showToast(error instanceof Error ? error.message : String(error)),
  });
  const removeSkill = useMutation({
    mutationFn: (skillId: string) =>
      apiFetch<unknown>(
        `/api/v1/tenant/players/${id}/skills/${skillId}`,
        { method: "DELETE" },
      ),
    onSuccess: refresh,
  });
  const addAvailability = useMutation({
    mutationFn: () => {
      if (!from || !to) throw new Error("请填写起止时间");
      return apiFetch<unknown>(
        `/api/v1/tenant/players/${id}/availability`,
        {
          method: "POST",
          body: JSON.stringify({
            startsAt: new Date(from).toISOString(),
            endsAt: new Date(to).toISOString(),
            ...(reason ? { reason } : {}),
          }),
        },
      );
    },
    onSuccess: () => {
      setFrom("");
      setTo("");
      setReason("");
      refresh();
    },
    onError: (error) =>
      showToast(error instanceof Error ? error.message : String(error)),
  });
  const removeAvailability = useMutation({
    mutationFn: (availabilityId: string) =>
      apiFetch<unknown>(
        `/api/v1/tenant/players/${id}/availability/${availabilityId}`,
        { method: "DELETE" },
      ),
    onSuccess: refresh,
  });

  if (playerQuery.isPending) return <p className="mc-loading-text">加载中…</p>;
  if (!player) return <p className="mc-form-error">加载失败。</p>;

  return (
    <div>
      <BackLink href="/merchant-console/players" label="返回陪玩档案" />
      <div className="mc-pagehead">
        <div>
          <div className="mc-kicker">PLAYER DETAIL</div>
          <h1>{player.name}</h1>
          <p>
            {player.mobile ?? "无手机"} ·{" "}
            {formatFenYuan(player.basePricePerHourFen)}/小时
          </p>
        </div>
      </div>

      <div className="mc-record-grid">
        <div>
          <section className="mc-panel">
            <div className="mc-section-head">
              <div>
                <h2>技能</h2>
                <p>按游戏维度维护</p>
              </div>
            </div>
            {player.skills.length === 0 ? (
              <p className="mc-empty-compact">暂无技能。</p>
            ) : (
              <div className="mc-table-wrap">
                <table>
                  <tbody>
                    {player.skills.map((skill) => (
                      <tr key={skill.id}>
                        <td>{skill.gameName}</td>
                        <td>
                          <button
                            type="button"
                            className="mc-btn mc-btn-small"
                            onClick={() => removeSkill.mutate(skill.id)}
                          >
                            移除
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mc-filter-row">
              <select
                className="mc-input-inline"
                value={skillGameId}
                onChange={(event) => setSkillGameId(event.target.value)}
              >
                <option value="">选择游戏…</option>
                {(gamesQuery.data ?? [])
                  .filter((game) => game.enabled)
                  .map((game) => (
                    <option key={game.id} value={game.id}>
                      {game.name}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                className="mc-btn mc-btn-small"
                disabled={!skillGameId}
                onClick={() => addSkill.mutate()}
              >
                添加技能
              </button>
            </div>
          </section>

          <section className="mc-panel">
            <div className="mc-section-head">
              <div>
                <h2>不可接单时间</h2>
                <p>停用档期会阻止该时段派单</p>
              </div>
            </div>
            {player.availability.length === 0 ? (
              <p className="mc-empty-compact">暂无设置。</p>
            ) : (
              <div className="mc-table-wrap">
                <table>
                  <tbody>
                    {player.availability.map((slot) => (
                      <tr key={slot.id}>
                        <td>
                          {new Date(slot.startsAt).toLocaleString()} →{" "}
                          {new Date(slot.endsAt).toLocaleString()}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="mc-btn mc-btn-small"
                            onClick={() => removeAvailability.mutate(slot.id)}
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mc-filter-row">
              <input
                className="mc-input-inline"
                type="datetime-local"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                aria-label="开始时间"
              />
              <input
                className="mc-input-inline"
                type="datetime-local"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                aria-label="结束时间"
              />
              <input
                className="mc-input-inline"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="原因（可选）"
              />
              <button
                type="button"
                className="mc-btn mc-btn-small"
                disabled={!from || !to}
                onClick={() => addAvailability.mutate()}
              >
                添加
              </button>
            </div>
          </section>
        </div>

        <aside className="mc-panel mc-review">
          <div className="mc-review-top">
            <h2>收入与结算</h2>
            <span>真实账本</span>
          </div>
          {account ? (
            <>
              <div className="mc-summary-line">
                <span>已付</span>
                <b>{formatFenYuan(account.finance.paidFen)}</b>
              </div>
              <div className="mc-summary-line">
                <span>待付 / 未入账</span>
                <b>{formatFenYuan(account.finance.unpaidFen)}</b>
              </div>
              {account.finance.records.length === 0 ? (
                <p className="mc-empty-compact">暂无收入记录。</p>
              ) : (
                <div className="mc-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>来源</th>
                        <th>订单</th>
                        <th>金额</th>
                      </tr>
                    </thead>
                    <tbody>
                      {account.finance.records.map((record) => (
                        <tr key={record.id}>
                          <td>{record.source === "SLOT" ? "GD" : "CLASSIC"}</td>
                          <td className="mc-mono">{record.orderNo}</td>
                          <td className="mc-mono">
                            {formatFenYuan(record.amountFen)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : accountQuery.isPending ? (
            <p className="mc-loading-text">加载中…</p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

export function SessionDetailView({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const { showToast } = useDemoToast();
  const [message, setMessage] = useState<string | null>(null);

  const sessionQuery = useQuery({
    queryKey: ["mc-session-detail", id],
    queryFn: () => apiFetch<SessionDetail>(`/api/v1/tenant/sessions/${id}`),
  });
  const session = sessionQuery.data;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["mc-session-detail", id] });
  };
  const transition = useMutation({
    mutationFn: (action: "start" | "end") =>
      apiFetch<SessionDetail>(
        `/api/v1/tenant/orders/${session?.orderId as string}/session/${action}`,
        { method: "POST" },
      ),
    onSuccess: () => {
      showToast("场次状态已更新。");
      refresh();
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : String(error));
    },
  });
  const reviewAdjustment = useMutation({
    mutationFn: ({
      adjustmentId,
      approve,
    }: {
      adjustmentId: string;
      approve: boolean;
    }) =>
      apiFetch<SessionDetail>(
        `/api/v1/tenant/sessions/${id}/adjustments/${adjustmentId}/review`,
        {
          method: "POST",
          body: JSON.stringify({ approve }),
        },
      ),
    onSuccess: () => {
      showToast("调整已复核。");
      refresh();
    },
    onError: (error) =>
      showToast(error instanceof Error ? error.message : String(error)),
  });

  const openEvidence = async (evidenceId: string) => {
    if (!session) return;
    try {
      const headers = new Headers();
      const token = getAccessToken();
      if (token) headers.set("authorization", `Bearer ${token}`);
      const path =
        session.flow === "GAME_DISPATCH"
          ? `/api/v1/tenant/slot-evidence/${evidenceId}`
          : `/api/v1/tenant/evidence/${evidenceId}`;
      const response = await fetch(`${API_ORIGIN}${path}`, { headers });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  if (sessionQuery.isPending) return <p className="mc-loading-text">加载中…</p>;
  if (!session)
    return (
      <p className="mc-form-error">
        {sessionQuery.error instanceof Error
          ? sessionQuery.error.message
          : "加载失败"}
      </p>
    );

  return (
    <div>
      <BackLink href="/merchant-console/sessions" label="返回场次与证据" />
      {message ? <p className="mc-form-error">{message}</p> : null}
      <div className="mc-pagehead">
        <div>
          <div className="mc-kicker">SESSION DETAIL</div>
          <h1>场次详情</h1>
          <p>
            订单 {session.orderId} · {session.flow === "GAME_DISPATCH" ? "GD 档位" : "CLASSIC"} ·{" "}
            <SessionStatusText status={session.status} />
          </p>
        </div>
      </div>

      <div className="mc-record-grid">
        <div>
          <section className="mc-panel mc-facts">
            <dl className="mc-fact">
              <dt>开始时间</dt>
              <dd>
                {session.startedAt
                  ? new Date(session.startedAt).toLocaleString()
                  : "-"}
              </dd>
            </dl>
            <dl className="mc-fact">
              <dt>结束时间</dt>
              <dd>
                {session.endedAt
                  ? new Date(session.endedAt).toLocaleString()
                  : "-"}
              </dd>
            </dl>
            <dl className="mc-fact">
              <dt>服务时长</dt>
              <dd>{durationLabel(session.durationSeconds)}</dd>
            </dl>
          </section>

          <section className="mc-panel">
            <div className="mc-section-head">
              <div>
                <h2>事件时间线</h2>
                <p>服务端记录，不可篡改</p>
              </div>
            </div>
            {session.events.length === 0 ? (
              <p className="mc-empty-compact">暂无事件。</p>
            ) : (
              <ol className="mc-timeline">
                {session.events.map((event) => (
                  <li key={event.id} className="done">
                    <time>{new Date(event.occurredAt).toLocaleString()}</time>
                    <b>{eventTypeLabel(event.eventType)}</b>
                    <p>
                      {event.fromStatus ?? "—"} → {event.toStatus ?? "—"}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="mc-panel">
            <div className="mc-section-head">
              <div>
                <h2>证据（{session.evidence.length}）</h2>
                <p>点击从后端鉴权读取原始文件</p>
              </div>
            </div>
            {session.evidence.length === 0 ? (
              <p className="mc-empty-compact">暂无证据。</p>
            ) : (
              <div className="mc-ev-grid">
                {session.evidence.map((evidence) => (
                  <button
                    type="button"
                    className="mc-ev-card"
                    key={evidence.id}
                    onClick={() => void openEvidence(evidence.id)}
                  >
                    <span className="mc-ev-thumb">
                      <Image size={18} aria-hidden="true" />
                      {evidence.mimeType}
                    </span>
                    <span className="mc-ev-meta">
                      <b>{evidence.originalName}</b>
                      <span>
                        {(evidence.sizeBytes / 1024).toFixed(0)} KB ·{" "}
                        {new Date(evidence.createdAt).toLocaleString()}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="mc-panel mc-review">
          <div className="mc-review-top">
            <h2>操作</h2>
            <span>真实后端动作</span>
          </div>
          {session.status === "SCHEDULED" && session.flow === "CLASSIC" ? (
            <button
              type="button"
              className="mc-btn mc-btn-primary"
              disabled={transition.isPending}
              onClick={() => transition.mutate("start")}
            >
              开始场次
            </button>
          ) : null}
          {session.status === "STARTED" && session.flow === "CLASSIC" ? (
            <button
              type="button"
              className="mc-btn mc-btn-primary"
              disabled={transition.isPending}
              onClick={() => transition.mutate("end")}
            >
              结束场次
            </button>
          ) : null}
          {session.flow === "GAME_DISPATCH" ? (
            <Link
              href={`/merchant-console/dispatch/${session.orderId}?flow=GD`}
              className="mc-btn"
            >
              打开派单订单详情
            </Link>
          ) : null}
          <button type="button" className="mc-btn" onClick={refresh}>
            <RefreshCw size={14} />
            刷新
          </button>

          {session.adjustments.length > 0 ? (
            <div className="mc-review-group">
              <div className="mc-review-label">时长调整</div>
              {session.adjustments.map((adjustment) => (
                <div className="mc-summary-line" key={adjustment.id}>
                  <span>
                    {durationLabel(adjustment.originalDurationSeconds)} →{" "}
                    {durationLabel(adjustment.requestedDurationSeconds)}
                  </span>
                  <b>{adjustmentStatusLabel(adjustment.status)}</b>
                  {adjustment.status === "PENDING" ? (
                    <span className="mc-button-row">
                      <button
                        type="button"
                        className="mc-btn mc-btn-small"
                        onClick={() =>
                          reviewAdjustment.mutate({
                            adjustmentId: adjustment.id,
                            approve: true,
                          })
                        }
                      >
                        通过
                      </button>
                      <button
                        type="button"
                        className="mc-btn mc-btn-small"
                        onClick={() =>
                          reviewAdjustment.mutate({
                            adjustmentId: adjustment.id,
                            approve: false,
                          })
                        }
                      >
                        驳回
                      </button>
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

export function DisputeDetailView({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const { showToast } = useDemoToast();
  const [resolution, setResolution] = useState("");
  const [error, setError] = useState<string | null>(null);

  const disputeQuery = useQuery({
    queryKey: ["mc-dispute-detail", id],
    queryFn: () => apiFetch<DisputeDetail>(`/api/v1/tenant/disputes/${id}`),
  });
  const dispute = disputeQuery.data;

  const resolve = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string; status: string }>(
        `/api/v1/tenant/disputes/${id}/resolve`,
        {
          method: "POST",
          body: JSON.stringify({ resolution }),
        },
      ),
    onSuccess: () => {
      setResolution("");
      showToast("争议已处理完成。");
      void queryClient.invalidateQueries({ queryKey: ["mc-dispute-detail", id] });
    },
    onError: (mutationError) =>
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : String(mutationError),
      ),
  });

  if (disputeQuery.isPending) return <p className="mc-loading-text">加载中…</p>;
  if (!dispute)
    return (
      <p className="mc-form-error">
        {disputeQuery.error instanceof Error
          ? disputeQuery.error.message
          : "加载失败"}
      </p>
    );

  return (
    <div>
      <BackLink href="/merchant-console/disputes" label="返回客诉记录" />
      {error ? <p className="mc-form-error">{error}</p> : null}
      <div className="mc-pagehead">
        <div>
          <div className="mc-kicker">DISPUTE DETAIL</div>
          <h1>争议 {dispute.orderNo}</h1>
          <p>
            {dispute.customerName} × {dispute.playerName} ·{" "}
            {dispute.status === "OPEN" ? "待处理" : "已处理"}
          </p>
        </div>
      </div>

      <div className="mc-record-grid">
        <div>
          <section className="mc-panel">
            <p className="mc-sub">争议原因</p>
            <p>{dispute.reason}</p>
          </section>
          <section className="mc-panel">
            <div className="mc-section-head">
              <div>
                <h2>处理时间线</h2>
                <p>争议发起与处理记录</p>
              </div>
            </div>
            {dispute.events.length === 0 ? (
              <p className="mc-empty-compact">暂无事件。</p>
            ) : (
              <ol className="mc-timeline">
                {dispute.events.map((event) => (
                  <li key={event.id} className="done">
                    <time>{new Date(event.occurredAt).toLocaleString()}</time>
                    <b>{event.eventType}</b>
                    <p>{event.payload ? JSON.stringify(event.payload) : "—"}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
        <aside className="mc-panel mc-review">
          <div className="mc-review-top">
            <h2>处理动作</h2>
            <span>真实后端动作</span>
          </div>
          {dispute.earning ? (
            <div className="mc-summary-line">
              <span>关联应收</span>
              <b>{formatFenYuan(dispute.earning.amountFen)}</b>
              <small>
                {dispute.earning.settlementBatchNo
                  ? `${dispute.earning.settlementBatchNo}（${dispute.earning.settlementBatchStatus}）`
                  : "未入批次"}
              </small>
            </div>
          ) : null}
          {dispute.status === "OPEN" ? (
            <>
              <textarea
                className="mc-textarea"
                value={resolution}
                onChange={(event) => setResolution(event.target.value)}
                placeholder="处理结论（会写入时间线）"
              />
              <button
                type="button"
                className="mc-btn mc-btn-primary"
                disabled={!resolution.trim() || resolve.isPending}
                onClick={() => resolve.mutate()}
              >
                处理并关闭争议
              </button>
            </>
          ) : (
            <p className="mc-sub">
              处理结果：{dispute.resolution ?? "—"}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="mc-back">
      <ArrowLeft size={15} />
      {label}
    </Link>
  );
}

function walletTypeLabel(type: string): string {
  return type === "RECHARGE" ? "充值" : type === "DEDUCT" ? "消费扣款" : type;
}

function durationLabel(seconds: number | null): string {
  if (seconds === null) return "-";
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`
    : `${minutes} 分 ${seconds % 60} 秒`;
}

function eventTypeLabel(type: string): string {
  const map: Record<string, string> = {
    SESSION_STARTED: "场次开始",
    SESSION_ENDED: "场次结束",
    SESSION_CONFIRMED: "场次确认",
    SESSION_ADJUSTMENT_REJECTED: "调整被驳回",
    SLOT_SESSION_STARTED: "档位场次开始",
    SLOT_SESSION_ENDED: "档位场次结束",
  };
  return map[type] ?? type;
}

function SessionStatusText({ status }: { status: string }) {
  const map: Record<string, string> = {
    SCHEDULED: "待开始",
    NOT_STARTED: "待开始",
    STARTED: "进行中",
    ENDED: "已结束",
    ADJUSTMENT_PENDING: "调整待复核",
    CONFIRMED: "已确认",
  };
  return <>{map[status] ?? status}</>;
}

function adjustmentStatusLabel(status: string): string {
  if (status === "PENDING") return "待复核";
  if (status === "APPROVED") return "已通过";
  if (status === "REJECTED") return "已驳回";
  return status;
}

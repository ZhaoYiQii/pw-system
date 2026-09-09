"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft,
  Check,
  Image,
  Plus,
  X,
} from "lucide-react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch, getAccessToken } from "../api";
import { formatFenYuan } from "../money";
import { DemoDialog, DemoEmptyState, useDemoToast } from "./demo-ui";
import {
  type CatalogGame,
  type CustomerAccount,
  type CustomerOrderHistory,
  type CustomerRow,
  type DisputeDetail,
  type PlayerAccount,
  type PlayerDetail,
  type PlayerRow,
  type SessionDetail,
  type SettlementBatchDetail,
  dateTime,
  formatDuration,
  statusLabel,
} from "./merchant-api";

const API_ORIGIN =
  process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://127.0.0.1:3000";

function Badge({ status }: { status: string }) {
  const tone =
    status === "OPEN" || status === "PENDING"
      ? "pending"
      : status === "STARTED" || status === "IN_PROGRESS"
        ? "running"
        : status === "PAID" || status === "ACTIVE" || status === "CONFIRMED"
          ? "done"
          : status === "CANCELLED" || status === "VOID" || status === "INACTIVE"
            ? "cancelled"
            : status === "DISPATCHING"
              ? "dispatch"
              : status === "ASSIGNED" || status === "REVIEWED"
                ? "assigned"
                : "muted";
  return <span className={`mc-status st-${tone}`}>{statusLabel(status)}</span>;
}

export function RecordDetailView({
  moduleId,
  recordId,
}: {
  moduleId: string;
  recordId: string;
}) {
  if (moduleId === "customers") return <CustomerDetail id={recordId} />;
  if (moduleId === "players") return <PlayerDetailView id={recordId} />;
  if (moduleId === "sessions") return <SessionDetailView id={recordId} />;
  if (moduleId === "settlements") return <SettlementDetail id={recordId} />;
  if (moduleId === "disputes") return <DisputeDetailView id={recordId} />;
  return (
    <section className="mc-panel">
      <DemoEmptyState
        title="该模块没有独立详情页"
        description="请回到模块列表查看聚合数据。"
      >
        <Link href={`/merchant-console/${moduleId}`} className="mc-btn">
          返回列表
        </Link>
      </DemoEmptyState>
    </section>
  );
}

function Back({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="mc-back">
      <ArrowLeft size={15} /> 返回{label}
    </Link>
  );
}

// ------------------------------------------------------------ customers
function CustomerDetail({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const { toast, showToast } = useDemoToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [remark, setRemark] = useState("");
  const customerQuery = useQuery({
    queryKey: ["merchant", "customer-detail", id],
    queryFn: () => apiFetch<CustomerRow>(`/api/v1/tenant/customers/${id}`),
  });
  const accountQuery = useQuery({
    queryKey: ["merchant", "customer-account", id],
    queryFn: () =>
      apiFetch<CustomerAccount>(`/api/v1/tenant/customers/${id}/account`),
  });
  const ordersQuery = useQuery({
    queryKey: ["merchant", "customer-orders", id],
    queryFn: () =>
      apiFetch<CustomerOrderHistory[]>(
        `/api/v1/tenant/customers/${id}/orders`,
      ),
  });
  const update = useMutation({
    mutationFn: () =>
      apiFetch<CustomerRow>(`/api/v1/tenant/customers/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          ...(mobile.trim() ? { mobile } : {}),
          ...(remark.trim() ? { remark } : {}),
        }),
      }),
    onSuccess: () => {
      setEditing(false);
      showToast("客户资料已保存。");
      void queryClient.invalidateQueries({ queryKey: ["merchant", "customer-detail", id] });
    },
  });
  if (customerQuery.isPending) return <div className="mc-empty">加载客户…</div>;
  if (customerQuery.isError || !customerQuery.data) {
    return <div className="mc-empty">客户不存在或无权访问。</div>;
  }
  const customer = customerQuery.data;
  const wallet = accountQuery.data?.wallet ?? null;
  const orderHistory = ordersQuery.data ?? [];
  return (
    <div>
      <Back href="/merchant-console/customers" label="客户档案" />
      <div className="mc-pagehead mc-detail-head">
        <div>
          <div className="mc-kicker">RECORDS / CUSTOMERS / DETAIL</div>
          <div className="mc-detail-title">
            <h1>{customer.name}</h1>
            <Badge status={customer.status} />
          </div>
          <p>{customer.mobile ?? "未填写手机"}</p>
        </div>
        <button type="button" className="mc-btn" onClick={() => { setName(customer.name); setMobile(customer.mobile ?? ""); setRemark(customer.remark ?? ""); setEditing(true); }}>
          编辑资料
        </button>
      </div>
      <section className="mc-panel mc-facts">
        <dl className="mc-fact"><dt>客户 ID</dt><dd className="mc-mono">{customer.id}</dd></dl>
        <dl className="mc-fact"><dt>备注</dt><dd>{customer.remark ?? "-"}</dd></dl>
        <dl className="mc-fact"><dt>建档时间</dt><dd>{dateTime(customer.createdAt)}</dd></dl>
      </section>

      <section className="mc-panel">
        <div className="mc-section-head">
          <div><h2>账户余额与流水</h2><p>绑定老板钱包后显示余额与账变。</p></div>
          {wallet ? <b>{formatFenYuan(wallet.balanceFen)}</b> : null}
        </div>
        {wallet ? (
          <div className="mc-table-wrap">
            <table>
              <thead><tr><th>流水号</th><th>类型</th><th>变动</th><th>余额</th><th>原因</th><th>时间</th></tr></thead>
              <tbody>
                {wallet.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.txNo}</td><td>{entry.type}</td>
                    <td>{formatFenYuan(entry.amountFen)}</td><td>{formatFenYuan(entry.balanceAfterFen)}</td>
                    <td>{entry.reason ?? "-"}</td><td>{dateTime(entry.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="mc-empty mc-empty-compact">该客户尚未绑定老板钱包。</div>}
      </section>

      <section className="mc-panel">
        <div className="mc-section-head"><div><h2>历史订单</h2><p>CLASSIC 与 GD 订单。</p></div><span>{orderHistory.length} 单</span></div>
        {orderHistory.length ? (
          <div className="mc-table-wrap">
            <table>
              <thead><tr><th>订单</th><th>派单</th><th>流程</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead>
              <tbody>
                {orderHistory.map((order) => (
                  <tr key={order.orderId}>
                    <td>{order.orderNo}</td><td>{order.dispatchNo ?? "-"}</td><td>{order.processType}</td>
                    <td><Badge status={order.status} /></td><td>{dateTime(order.createdAt)}</td>
                    <td><Link href={`/merchant-console/dispatch/${order.orderId}?kind=${order.processType === "GAME_DISPATCH" ? "GD" : "CLASSIC"}`} className="mc-btn mc-btn-ghost mc-btn-small">查看</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <DemoEmptyState title="暂无历史订单" description="该客户还没有关联订单。" />}
      </section>

      <DemoDialog
        open={editing}
        title="编辑客户资料"
        confirmLabel="保存"
        onCancel={() => setEditing(false)}
        onConfirm={() => update.mutate()}
      >
        <div className="mc-form-grid">
          <label className="mc-field"><span>姓名 *</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="mc-field"><span>手机</span><input value={mobile} onChange={(e) => setMobile(e.target.value)} /></label>
          <label className="mc-field"><span>备注</span><input value={remark} onChange={(e) => setRemark(e.target.value)} /></label>
        </div>
      </DemoDialog>
      {toast}
    </div>
  );
}

// ------------------------------------------------------------ players
function PlayerDetailView({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const { toast, showToast } = useDemoToast();
  const [skillGameId, setSkillGameId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const detailQuery = useQuery({
    queryKey: ["merchant", "player-detail", id],
    queryFn: () => apiFetch<PlayerDetail>(`/api/v1/tenant/players/${id}`),
  });
  const accountQuery = useQuery({
    queryKey: ["merchant", "player-account", id],
    queryFn: () =>
      apiFetch<PlayerAccount>(`/api/v1/tenant/players/${id}/account`),
  });
  const gamesQuery = useQuery({
    queryKey: ["merchant", "player-games"],
    queryFn: () => apiFetch<CatalogGame[]>("/api/v1/tenant/catalog/games"),
  });
  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: ["merchant", "player"],
    });
  const toggleAccept = useMutation({
    mutationFn: () =>
      apiFetch<PlayerRow>(`/api/v1/tenant/players/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ acceptingOrders: !detailQuery.data?.acceptingOrders }),
      }),
    onSuccess: () => { refresh(); showToast("接单状态已更新。"); },
  });
  const addSkill = useMutation({
    mutationFn: () =>
      apiFetch<unknown>(`/api/v1/tenant/players/${id}/skills`, {
        method: "POST",
        body: JSON.stringify({ gameId: skillGameId }),
      }),
    onSuccess: () => { setSkillGameId(""); refresh(); showToast("已添加技能。"); },
  });
  const removeSkill = useMutation({
    mutationFn: (skillId: string) =>
      apiFetch<unknown>(`/api/v1/tenant/players/${id}/skills/${skillId}`, { method: "DELETE" }),
    onSuccess: () => { refresh(); showToast("已移除技能。"); },
  });
  const addAvailability = useMutation({
    mutationFn: () =>
      apiFetch<unknown>(`/api/v1/tenant/players/${id}/availability`, {
        method: "POST",
        body: JSON.stringify({
          startsAt: new Date(from).toISOString(),
          endsAt: new Date(to).toISOString(),
          ...(reason ? { reason } : {}),
        }),
      }),
    onSuccess: () => { setFrom(""); setTo(""); setReason(""); refresh(); showToast("已添加档期。"); },
  });
  const removeAvailability = useMutation({
    mutationFn: (availabilityId: string) =>
      apiFetch<unknown>(`/api/v1/tenant/players/${id}/availability/${availabilityId}`, { method: "DELETE" }),
    onSuccess: () => { refresh(); showToast("已移除档期。"); },
  });
  if (detailQuery.isPending) return <div className="mc-empty">加载陪玩…</div>;
  if (detailQuery.isError || !detailQuery.data) return <div className="mc-empty">陪玩不存在或无权访问。</div>;
  const player = detailQuery.data;
  const account = accountQuery.data;
  return (
    <div>
      <Back href="/merchant-console/players" label="陪玩档案" />
      <div className="mc-pagehead mc-detail-head">
        <div>
          <div className="mc-kicker">RECORDS / PLAYERS / DETAIL</div>
          <div className="mc-detail-title">
            <h1>{player.name}</h1>
            <Badge status={player.status} />
          </div>
          <p>{player.mobile ?? "未填写手机"} · 基础小时价 {formatFenYuan(player.basePricePerHourFen)}</p>
        </div>
        <div className="mc-button-row">
          <button type="button" className="mc-btn" onClick={() => toggleAccept.mutate()}>
            {player.acceptingOrders ? "暂停接单" : "恢复接单"}
          </button>
        </div>
      </div>

      <section className="mc-panel">
        <div className="mc-section-head">
          <div><h2>技能标签</h2><p>绑定门店已启用的游戏。</p></div>
          <div className="mc-button-row">
            <select className="mc-select" value={skillGameId} onChange={(e) => setSkillGameId(e.target.value)}>
              <option value="">选择游戏…</option>
              {(gamesQuery.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <button type="button" className="mc-btn mc-btn-small" disabled={!skillGameId} onClick={() => addSkill.mutate()}><Plus size={14} /> 添加</button>
          </div>
        </div>
        {player.skills.length ? (
          <div className="mc-table-wrap">
            <table>
              <thead><tr><th>游戏</th><th>称号</th><th>操作</th></tr></thead>
              <tbody>
                {player.skills.map((skill) => (
                  <tr key={skill.id}><td>{skill.gameName}</td><td>{skill.title ?? "-"}</td><td><button type="button" className="mc-btn mc-btn-ghost mc-btn-small" onClick={() => removeSkill.mutate(skill.id)}>移除</button></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="mc-empty mc-empty-compact">暂无技能标签。</div>}
      </section>

      <section className="mc-panel">
        <div className="mc-section-head">
          <div><h2>档期</h2><p>不可接单时间段。</p></div>
          <div className="mc-button-row">
            <input className="mc-input" style={{ maxWidth: 170 }} type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="开始" />
            <input className="mc-input" style={{ maxWidth: 170 }} type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} aria-label="结束" />
            <input className="mc-input" style={{ maxWidth: 130 }} placeholder="原因" value={reason} onChange={(e) => setReason(e.target.value)} />
            <button type="button" className="mc-btn mc-btn-small" disabled={!from || !to} onClick={() => addAvailability.mutate()}><Plus size={14} /> 添加</button>
          </div>
        </div>
        {player.availability.length ? (
          <div className="mc-table-wrap">
            <table>
              <thead><tr><th>开始</th><th>结束</th><th>原因</th><th>操作</th></tr></thead>
              <tbody>
                {player.availability.map((slot) => (
                  <tr key={slot.id}><td>{dateTime(slot.startsAt)}</td><td>{dateTime(slot.endsAt)}</td><td>{slot.reason ?? "-"}</td><td><button type="button" className="mc-btn mc-btn-ghost mc-btn-small" onClick={() => removeAvailability.mutate(slot.id)}>移除</button></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="mc-empty mc-empty-compact">暂无休息档期。</div>}
      </section>

      <section className="mc-panel">
        <div className="mc-section-head">
          <div><h2>收入概览</h2><p>已付 {account ? formatFenYuan(account.finance.paidFen) : "-"} · 未付 {account ? formatFenYuan(account.finance.unpaidFen) : "-"}</p></div>
        </div>
        {(account?.finance.records ?? []).length ? (
          <div className="mc-table-wrap">
            <table>
              <thead><tr><th>订单</th><th>来源</th><th>金额</th><th>状态</th><th>时间</th></tr></thead>
              <tbody>
                {account!.finance.records.map((record) => (
                  <tr key={record.id}><td>{record.orderNo}</td><td>{record.source}</td><td>{formatFenYuan(record.amountFen)}</td><td><Badge status={record.status} /></td><td>{dateTime(record.createdAt)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="mc-empty mc-empty-compact">暂无收入记录。</div>}
      </section>
      {toast}
    </div>
  );
}

// ------------------------------------------------------------ sessions
function SessionDetailView({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const { toast, showToast } = useDemoToast();
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["merchant", "session-detail", id],
    queryFn: () => apiFetch<SessionDetail>(`/api/v1/tenant/sessions/${id}`),
  });
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ["merchant", "session-detail", id] });
  const transition = useMutation({
    mutationFn: (action: "start" | "end") =>
      apiFetch<SessionDetail>(
        `/api/v1/tenant/orders/${query.data?.orderId as string}/session/${action}`,
        { method: "POST" },
      ),
    onSuccess: () => { refresh(); showToast("场次状态已更新。"); },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  const reviewAdjustment = useMutation({
    mutationFn: ({ adjustmentId, approve }: { adjustmentId: string; approve: boolean }) =>
      apiFetch<SessionDetail>(
        `/api/v1/tenant/sessions/${id}/adjustments/${adjustmentId}/review`,
        { method: "POST", body: JSON.stringify({ approve }) },
      ),
    onSuccess: () => { refresh(); showToast("调整已复核。"); },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  const openEvidence = async (evidence: SessionDetail["evidence"][number]) => {
    try {
      const token = getAccessToken();
      const path = query.data?.flow === "GAME_DISPATCH"
        ? `/api/v1/tenant/slot-evidence/${evidence.id}`
        : `/api/v1/tenant/evidence/${evidence.id}`;
      const headers = new Headers();
      if (token) headers.set("authorization", `Bearer ${token}`);
      const res = await fetch(`${API_ORIGIN}${path}`, {
        headers,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(`证据打开失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };
  if (query.isPending) return <div className="mc-empty">加载场次…</div>;
  if (query.isError || !query.data) return <div className="mc-empty">场次不存在或无权访问。</div>;
  const session = query.data;
  const canStart = ["ASSIGNED", "READY", "NOT_STARTED", "SCHEDULED"].includes(session.status);
  const canEnd = session.status === "STARTED";
  return (
    <div>
      <Back href="/merchant-console/sessions" label="场次与证据" />
      <div className="mc-pagehead mc-detail-head">
        <div>
          <div className="mc-kicker">RECORDS / SESSIONS / DETAIL</div>
          <div className="mc-detail-title"><h1 className="mc-mono">{session.id}</h1><Badge status={session.status} /></div>
          <p>{session.flow} · 订单 {session.orderId}</p>
        </div>
        <div className="mc-button-row">
          {canStart ? <button type="button" className="mc-btn mc-btn-primary" disabled={transition.isPending} onClick={() => transition.mutate("start")}>开始场次</button> : null}
          {canEnd ? <button type="button" className="mc-btn mc-btn-primary" disabled={transition.isPending} onClick={() => transition.mutate("end")}>结束场次</button> : null}
          <Link href={`/merchant-console/dispatch/${session.orderId}?kind=${session.flow === "GAME_DISPATCH" ? "GD" : "CLASSIC"}`} className="mc-btn">订单详情</Link>
        </div>
      </div>
      {error ? <div className="mc-notice">{error}</div> : null}
      <section className="mc-panel mc-facts">
        <dl className="mc-fact"><dt>开始时间</dt><dd>{dateTime(session.startedAt)}</dd></dl>
        <dl className="mc-fact"><dt>结束时间</dt><dd>{dateTime(session.endedAt)}</dd></dl>
        <dl className="mc-fact"><dt>时长</dt><dd>{formatDuration(session.durationSeconds)}</dd></dl>
      </section>

      <section className="mc-panel">
        <div className="mc-section-head"><div><h2>证据</h2><p>点击图片可打开原图。</p></div><span>{session.evidence.length} 份</span></div>
        {session.evidence.length ? (
          <div className="mc-ev-grid">
            {session.evidence.map((evidence) => (
              <button type="button" className="mc-ev-card" key={evidence.id} onClick={() => void openEvidence(evidence)}>
                <span className="mc-ev-thumb"><Image size={18} aria-hidden="true" />图片</span>
                <span className="mc-ev-meta"><b>{evidence.originalName}</b><span>{evidence.uploadedBy ?? "未知"} · {dateTime(evidence.createdAt)}</span></span>
              </button>
            ))}
          </div>
        ) : <DemoEmptyState title="暂无证据" description="陪玩端开始/结束时上传。" />}
      </section>

      {session.adjustments.length ? (
        <section className="mc-panel">
          <div className="mc-section-head"><div><h2>时长调整复核</h2><p>核对后批准或驳回。</p></div></div>
          <div className="mc-table-wrap">
            <table>
              <thead><tr><th>原时长</th><th>申请时长</th><th>原因</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                {session.adjustments.map((adj) => (
                  <tr key={adj.id}>
                    <td>{formatDuration(adj.originalDurationSeconds)}</td><td>{formatDuration(adj.requestedDurationSeconds)}</td>
                    <td>{adj.reason}</td><td><Badge status={adj.status} /></td>
                    <td>
                      {adj.status === "PENDING" ? (
                        <div className="mc-button-row">
                          <button type="button" className="mc-btn mc-btn-primary mc-btn-small" onClick={() => reviewAdjustment.mutate({ adjustmentId: adj.id, approve: true })}><Check size={13} /> 批准</button>
                          <button type="button" className="mc-btn mc-btn-small" onClick={() => reviewAdjustment.mutate({ adjustmentId: adj.id, approve: false })}><X size={13} /> 驳回</button>
                        </div>
                      ) : statusLabel(adj.status)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="mc-panel">
        <div className="mc-section-head"><div><h2>事件时间线</h2><p>服务端状态变更不可篡改。</p></div></div>
        {session.events.length ? (
          <ol className="mc-timeline">
            {session.events.map((event) => (
              <li key={event.id}>
                <time>{dateTime(event.occurredAt)}</time>
                <b>{event.eventType}</b>
                <p>{event.fromStatus ?? "—"} → {event.toStatus ?? "—"}</p>
              </li>
            ))}
          </ol>
        ) : <DemoEmptyState title="暂无事件" description="开始场次后会写入事件。" />}
      </section>
      {toast}
    </div>
  );
}

// ------------------------------------------------------------ settlements
function SettlementDetail({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const { toast, showToast } = useDemoToast();
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["merchant", "settlement-detail", id],
    queryFn: () => apiFetch<SettlementBatchDetail>(`/api/v1/tenant/settlements/${id}`),
  });
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ["merchant", "settlement-detail", id] });
  const run = useMutation({
    mutationFn: (action: string) =>
      apiFetch<unknown>(`/api/v1/tenant/settlements/${id}/${action}`, { method: "POST" }),
    onSuccess: () => { refresh(); showToast("批次状态已更新。"); },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  if (query.isPending) return <div className="mc-empty">加载批次…</div>;
  if (query.isError || !query.data) return <div className="mc-empty">批次不存在或无权访问。</div>;
  const batch = query.data;
  const actionFor: Record<string, string | null> = {
    DRAFT: "review",
    REVIEWED: "approve",
    APPROVED: "pay",
    PAID: null,
    VOID: null,
  };
  const nextAction = actionFor[batch.status];
  return (
    <div>
      <Back href="/merchant-console/settlements" label="结算批次" />
      <div className="mc-pagehead mc-detail-head">
        <div>
          <div className="mc-kicker">RECORDS / SETTLEMENTS / DETAIL</div>
          <div className="mc-detail-title"><h1 className="mc-mono">{batch.batchNo}</h1><Badge status={batch.status} /></div>
          <p>总额 {formatFenYuan(batch.totalAmountFen)} · {batch.itemCount} 笔</p>
        </div>
        <div className="mc-button-row">
          {nextAction && batch.status === "DRAFT" ? <button type="button" className="mc-btn mc-btn-primary" onClick={() => run.mutate(nextAction)}>复核</button> : null}
          {nextAction && batch.status === "REVIEWED" ? <button type="button" className="mc-btn mc-btn-primary" onClick={() => run.mutate(nextAction)}>批准</button> : null}
          {nextAction && batch.status === "APPROVED" ? <button type="button" className="mc-btn mc-btn-primary" onClick={() => run.mutate(nextAction)}>登记支付</button> : null}
          {["DRAFT", "REVIEWED", "APPROVED"].includes(batch.status) ? <button type="button" className="mc-btn" onClick={() => run.mutate("void")}>作废</button> : null}
        </div>
      </div>
      {error ? <div className="mc-notice">{error}</div> : null}
      <section className="mc-panel mc-facts">
        <dl className="mc-fact"><dt>创建人</dt><dd>{batch.createdByName ?? "-"}</dd></dl>
        <dl className="mc-fact"><dt>复核人</dt><dd>{batch.reviewedByName ?? "-"}</dd></dl>
        <dl className="mc-fact"><dt>批准人</dt><dd>{batch.approvedByName ?? "-"}</dd></dl>
        <dl className="mc-fact"><dt>支付人/时间</dt><dd>{batch.paidByName ?? "-"} {batch.paidAt ? `· ${dateTime(batch.paidAt)}` : ""}</dd></dl>
      </section>
      <section className="mc-panel">
        <div className="mc-section-head"><div><h2>批次明细</h2><p>逐笔应收。</p></div><span>{batch.items.length} 笔</span></div>
        {batch.items.length ? (
          <div className="mc-table-wrap">
            <table>
              <thead><tr><th>订单</th><th>陪玩</th><th>来源</th><th>金额</th><th>创建时间</th></tr></thead>
              <tbody>
                {batch.items.map((item) => (
                  <tr key={item.itemId}><td>{item.orderNo}</td><td>{item.playerName}</td><td>{item.source}</td><td>{formatFenYuan(item.amountFen)}</td><td>{dateTime(item.createdAt)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <DemoEmptyState title="批次为空" description="可回到列表把应收加入批次。" />}
      </section>
      {toast}
    </div>
  );
}

// ------------------------------------------------------------ disputes
function DisputeDetailView({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const { toast, showToast } = useDemoToast();
  const [resolution, setResolution] = useState("");
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["merchant", "dispute-detail", id],
    queryFn: () => apiFetch<DisputeDetail>(`/api/v1/tenant/disputes/${id}`),
  });
  const resolve = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string; status: string }>(`/api/v1/tenant/disputes/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ resolution }),
      }),
    onSuccess: () => {
      setResolution("");
      showToast("争议已处理完成。");
      void queryClient.invalidateQueries({ queryKey: ["merchant", "dispute-detail", id] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  if (query.isPending) return <div className="mc-empty">加载争议…</div>;
  if (query.isError || !query.data) return <div className="mc-empty">争议不存在或无权访问。</div>;
  const dispute = query.data;
  return (
    <div>
      <Back href="/merchant-console/disputes" label="客诉记录" />
      <div className="mc-pagehead mc-detail-head">
        <div>
          <div className="mc-kicker">RECORDS / DISPUTES / DETAIL</div>
          <div className="mc-detail-title"><h1 className="mc-mono">{dispute.orderNo}</h1><Badge status={dispute.status} /></div>
          <p>{dispute.customerName} × {dispute.playerName}</p>
        </div>
        {dispute.status === "OPEN" ? (
          <div className="mc-button-row">
            <textarea className="mc-input" style={{ minHeight: 64 }} placeholder="填写处理结论" value={resolution} onChange={(e) => setResolution(e.target.value)} />
            <button type="button" className="mc-btn mc-btn-primary" disabled={!resolution.trim() || resolve.isPending} onClick={() => resolve.mutate()}>提交处理</button>
          </div>
        ) : null}
      </div>
      {error ? <div className="mc-notice">{error}</div> : null}
      <section className="mc-panel mc-facts">
        <dl className="mc-fact"><dt>争议原因</dt><dd>{dispute.reason}</dd></dl>
        <dl className="mc-fact"><dt>发起人</dt><dd>{dispute.openedBy ?? "-"}</dd></dl>
        <dl className="mc-fact"><dt>处理人/结论</dt><dd>{dispute.resolvedBy ?? "-"} · {dispute.resolution ?? "未处理"}</dd></dl>
      </section>
      {dispute.earning ? (
        <section className="mc-panel mc-facts">
          <dl className="mc-fact"><dt>应收金额</dt><dd>{formatFenYuan(dispute.earning.amountFen)}</dd></dl>
          <dl className="mc-fact"><dt>应收状态</dt><dd><Badge status={dispute.earning.status} /></dd></dl>
          <dl className="mc-fact"><dt>结算批次</dt><dd>{dispute.earning.settlementBatchNo ?? "未入批次"} {dispute.earning.settlementBatchStatus ?? ""}</dd></dl>
        </section>
      ) : null}
      <section className="mc-panel">
        <div className="mc-section-head"><div><h2>处理时间线</h2><p>争议事件留痕。</p></div></div>
        {dispute.events.length ? (
          <ol className="mc-timeline">
            {dispute.events.map((event) => (
              <li key={event.id}>
                <time>{dateTime(event.occurredAt)}</time>
                <b>{event.eventType}</b>
                <p>{event.actorType ?? "-"} · {event.fromStatus ?? "—"} → {event.toStatus ?? "—"}</p>
              </li>
            ))}
          </ol>
        ) : <DemoEmptyState title="暂无事件" description="争议发起后会写入事件。" />}
      </section>
      {toast}
    </div>
  );
}

"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "../api";
import { formatFenYuan } from "../money";
import { DemoEmptyState } from "./demo-ui";
import {
  type DisputeRow,
  type NotificationRow,
  type SettlementBatchRow,
  type SessionRow,
  dateTime,
  formatDuration,
  statusLabel,
} from "./merchant-api";

function Badge({ status }: { status: string }) {
  const tone =
    status === "OPEN" || ["DRAFT", "REVIEWED"].includes(status)
      ? "pending"
      : status === "STARTED" || status === "IN_PROGRESS"
        ? "running"
        : status === "APPROVED" || status === "PAID"
          ? "done"
          : "muted";
  return <span className={`mc-status st-${tone}`}>{statusLabel(status)}</span>;
}

export function MonitorModuleView({ moduleId }: { moduleId: string }) {
  if (moduleId === "overview") return <OverviewView />;
  if (moduleId === "live") return <LiveView />;
  if (moduleId === "risk") return <RiskView />;
  if (moduleId === "finrisk") return <FinRiskView />;
  if (moduleId === "health") return <HealthView />;
  return null;
}

function OverviewView() {
  const orders = useQuery({
    queryKey: ["monitor", "overview-orders"],
    queryFn: () => apiFetch<Array<{ status: string }>>("/api/v1/tenant/orders"),
  });
  const gd = useQuery({
    queryKey: ["monitor", "overview-gd"],
    queryFn: () =>
      apiFetch<Array<{ status: string }>>("/api/v1/tenant/game-dispatch"),
  });
  const sessions = useQuery({
    queryKey: ["monitor", "overview-sessions"],
    queryFn: () => apiFetch<SessionRow[]>("/api/v1/tenant/sessions"),
  });
  const disputes = useQuery({
    queryKey: ["monitor", "overview-disputes"],
    queryFn: () => apiFetch<DisputeRow[]>("/api/v1/tenant/disputes"),
  });
  const settlements = useQuery({
    queryKey: ["monitor", "overview-settlements"],
    queryFn: () =>
      apiFetch<SettlementBatchRow[]>("/api/v1/tenant/settlements"),
  });
  const allOrders = [
    ...(orders.data ?? []),
    ...(gd.data ?? []),
  ];
  const liveCount = (sessions.data ?? []).filter((s) =>
    ["STARTED", "IN_PROGRESS"].includes(s.status),
  ).length;
  const riskCount = (disputes.data ?? []).filter((d) => d.status === "OPEN").length;
  const finriskCount = (settlements.data ?? []).filter((b) =>
    ["DRAFT", "REVIEWED", "APPROVED"].includes(b.status),
  ).length;
  const metrics = [
    {
      label: "待办订单",
      value: String(
        allOrders.filter((o) =>
          ["DRAFT", "CONFIRMED", "DISPATCHING", "PENDING_CONFIRMATION"].includes(o.status),
        ).length,
      ),
      hint: "去订单台账",
      href: "/merchant-console/dispatch",
    },
    { label: "进行中场次", value: String(liveCount), hint: "实时盯场", href: "/merchant-console/live" },
    { label: "异常事项", value: String(riskCount), hint: "争议 / 复核", href: "/merchant-console/risk" },
    { label: "财务风险", value: String(finriskCount), hint: "待复核 / 冻结", href: "/merchant-console/finrisk" },
  ];
  return (
    <div>
      <div className="mc-pagehead">
        <div>
          <div className="mc-kicker">MONITOR / OVERVIEW</div>
          <h1>门店概览</h1>
          <p>营业脉搏与需要人工处理的风险，全部来自真实接口。</p>
        </div>
      </div>
      <div className="mc-monitor-metrics">
        {metrics.map((metric) => (
          <Link key={metric.label} href={metric.href} className="mc-metric-tile">
            <span>{metric.label}</span>
            <b>{metric.value}</b>
            <em>{metric.hint}<ArrowRight size={12} /></em>
          </Link>
        ))}
      </div>
      <div className="mc-workgrid">
        <section className="mc-panel">
          <div className="mc-section-head">
            <div><h2>需要留意</h2><p>按影响排序</p></div>
          </div>
          <div className="mc-agenda">
            <Link className="mc-agenda-row" href="/merchant-console/live">
              <time className="mc-mono">{liveCount}</time>
              <span><b>{liveCount} 场进行中</b><p>进入场次查看服务端计时与结束证据。</p></span>
            </Link>
            <Link className="mc-agenda-row" href="/merchant-console/finrisk">
              <time className="mc-mono">{finriskCount}</time>
              <span><b>{finriskCount} 笔财务待办</b><p>复核 / 批准 / 支付批次。</p></span>
            </Link>
          </div>
        </section>
        <aside className="mc-quiet-note" style={{ marginTop: 0 }}>
          <b>监控台原则</b>
          先看影响，再给动作；金额与状态不臆造。
        </aside>
      </div>
    </div>
  );
}

function LiveView() {
  const query = useQuery({
    queryKey: ["monitor", "live"],
    queryFn: () =>
      apiFetch<SessionRow[]>("/api/v1/tenant/sessions?status=STARTED"),
  });
  const rows = query.data ?? [];
  return (
    <div>
      <MonitorHeader kicker="MONITOR / LIVE" title="进行中场次" description="服务端计时中的场次。">
        <Link href="/merchant-console/sessions" className="mc-btn">全部场次</Link>
      </MonitorHeader>
      <section className="mc-panel">
        {rows.length ? (
          <div className="mc-table-wrap">
            <table>
              <thead><tr><th>订单</th><th>流程</th><th>客户</th><th>陪玩</th><th>时长</th><th>证据</th><th>操作</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.orderNo}</td><td>{row.flow}</td><td>{row.customerName}</td><td>{row.playerName}</td>
                    <td>{formatDuration(row.durationSeconds)}</td><td>{row.evidenceCount}</td>
                    <td><Link href={`/merchant-console/sessions/${row.id}`} className="mc-btn mc-btn-ghost mc-btn-small">盯场 <ArrowRight size={13} /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : query.isPending ? <div className="mc-empty">加载中…</div> : <DemoEmptyState title="暂无进行中场次" description="场次开始后出现在这里。" />}
      </section>
    </div>
  );
}

function RiskView() {
  const disputes = useQuery({
    queryKey: ["monitor", "risk-disputes"],
    queryFn: () => apiFetch<DisputeRow[]>("/api/v1/tenant/disputes"),
  });
  const sessions = useQuery({
    queryKey: ["monitor", "risk-sessions"],
    queryFn: () => apiFetch<SessionRow[]>("/api/v1/tenant/sessions"),
  });
  const openDisputes = (disputes.data ?? []).filter((d) => d.status === "OPEN");
  const adjustments = (sessions.data ?? []).filter(
    (s) => s.adjustmentPendingCount > 0,
  );
  return (
    <div>
      <MonitorHeader kicker="MONITOR / RISK" title="异常与争议" description="待处理客诉与待复核调整。">
        <Link href="/merchant-console/disputes" className="mc-btn">客诉记录</Link>
      </MonitorHeader>
      <section className="mc-panel">
        <div className="mc-section-head"><div><h2>待处理争议</h2></div><span>{openDisputes.length}</span></div>
        {openDisputes.length ? (
          <div className="mc-table-wrap">
            <table>
              <thead><tr><th>订单</th><th>客户</th><th>陪玩</th><th>原因</th><th>发起时间</th><th>操作</th></tr></thead>
              <tbody>
                {openDisputes.map((d) => (
                  <tr key={d.id}><td>{d.orderNo}</td><td>{d.customerName}</td><td>{d.playerName}</td><td>{d.reason}</td><td>{dateTime(d.createdAt)}</td>
                    <td><Link href={`/merchant-console/disputes/${d.id}`} className="mc-btn mc-btn-ghost mc-btn-small">去处理 <ArrowRight size={13} /></Link></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="mc-empty mc-empty-compact">暂无待处理争议。</div>}
      </section>
      <section className="mc-panel">
        <div className="mc-section-head"><div><h2>时长调整待复核</h2></div><span>{adjustments.length}</span></div>
        {adjustments.length ? (
          <div className="mc-table-wrap">
            <table>
              <thead><tr><th>订单</th><th>陪玩</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                {adjustments.map((s) => (
                  <tr key={s.id}><td>{s.orderNo}</td><td>{s.playerName}</td><td><Badge status={s.status} /></td>
                    <td><Link href={`/merchant-console/sessions/${s.id}`} className="mc-btn mc-btn-ghost mc-btn-small">复核 <ArrowRight size={13} /></Link></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="mc-empty mc-empty-compact">暂无待复核调整。</div>}
      </section>
    </div>
  );
}

function FinRiskView() {
  const batches = useQuery({
    queryKey: ["monitor", "finrisk"],
    queryFn: () =>
      apiFetch<SettlementBatchRow[]>("/api/v1/tenant/settlements"),
  });
  const rows = (batches.data ?? []).filter((b) =>
    ["DRAFT", "REVIEWED", "APPROVED"].includes(b.status),
  );
  return (
    <div>
      <MonitorHeader kicker="MONITOR / FINANCE RISK" title="财务风险" description="待复核、批准与登记的结算批次。">
        <Link href="/merchant-console/settlements" className="mc-btn">结算批次</Link>
      </MonitorHeader>
      <section className="mc-panel">
        {rows.length ? (
          <div className="mc-table-wrap">
            <table>
              <thead><tr><th>批次</th><th>状态</th><th>总额</th><th>笔数</th><th>创建人</th><th>创建时间</th><th>操作</th></tr></thead>
              <tbody>
                {rows.map((batch) => (
                  <tr key={batch.id}>
                    <td>{batch.batchNo}</td><td><Badge status={batch.status} /></td>
                    <td>{formatFenYuan(batch.totalAmountFen)}</td><td>{batch.itemCount}</td><td>{batch.createdBy ?? "系统"}</td>
                    <td>{dateTime(batch.createdAt)}</td>
                    <td><Link href={`/merchant-console/settlements/${batch.id}`} className="mc-btn mc-btn-ghost mc-btn-small">去处理 <ArrowRight size={13} /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <DemoEmptyState title="暂无财务风险" description="没有待复核批次。" />}
      </section>
    </div>
  );
}

function HealthView() {
  const queryClient = useQueryClient();
  const notifications = useQuery({
    queryKey: ["monitor", "health-notifications"],
    queryFn: () => apiFetch<NotificationRow[]>("/api/v1/tenant/notifications"),
  });
  const unread = useQuery({
    queryKey: ["monitor", "health-unread"],
    queryFn: () =>
      apiFetch<{ count: number }>("/api/v1/tenant/notifications/unread-count"),
  });
  const markRead = useMutation({
    mutationFn: (id: string) =>
      apiFetch<unknown>(`/api/v1/tenant/notifications/${id}/read`, { method: "POST" }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["monitor", "health"] }),
  });
  const rows = notifications.data ?? [];
  return (
    <div>
      <MonitorHeader kicker="MONITOR / HEALTH" title="通知与任务健康" description="站内通知已读管理；短信/微信通道为外部挂起项。">
      </MonitorHeader>
      <section className="mc-panel mc-channel-panel">
        <div className="mc-section-head"><div><h2>触达通道</h2><p>只展示真实能力状态。</p></div></div>
        <div className="mc-channel-list">
          <div className="mc-channel-row"><span><b>站内通知</b><small>未读 {unread.data?.count ?? 0} 条</small></span><span className="mc-status st-done">正常</span></div>
          <div className="mc-channel-row"><span><b>短信 / 微信</b><small>当前仓库未接入外部通道</small></span><span className="mc-status st-muted">未配置</span></div>
        </div>
      </section>
      <section className="mc-panel">
        <div className="mc-section-head"><div><h2>通知列表</h2></div><span>{rows.length} 条</span></div>
        {rows.length ? (
          <div className="mc-table-wrap">
            <table>
              <thead><tr><th>标题</th><th>内容</th><th>状态</th><th>时间</th><th>操作</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.title ?? "-"}</td><td>{row.content}</td>
                    <td>{row.readAt ? "已读" : "未读"}</td><td>{dateTime(row.createdAt)}</td>
                    <td>{row.readAt ? null : <button type="button" className="mc-btn mc-btn-ghost mc-btn-small" onClick={() => markRead.mutate(row.id)}>标为已读</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <DemoEmptyState title="暂无通知" description="系统通知会显示在这里。" />}
      </section>
    </div>
  );
}

function MonitorHeader({
  kicker,
  title,
  description,
  children,
}: {
  kicker: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="mc-pagehead">
      <div><div className="mc-kicker">{kicker}</div><h1>{title}</h1><p>{description}</p></div>
      {children ? <div className="mc-button-row">{children}</div> : null}
    </div>
  );
}

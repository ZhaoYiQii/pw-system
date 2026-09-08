"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { DemoDialog, useDemoToast } from "./demo-ui";
import {
  MONITOR_MODULES,
  type MonitorModuleId,
  type MonitorRow,
} from "./monitor-data";
import { useDemoStore } from "./demo-store";
import { isTodo } from "./demo-data";

export function MonitorModuleView({ moduleId }: { moduleId: MonitorModuleId }) {
  if (moduleId === "overview") return <OverviewView />;
  return <MonitorTableView moduleId={moduleId} />;
}

function OverviewView() {
  const { orders } = useDemoStore();
  const todoCount = orders.filter(isTodo).length;
  const liveCount = MONITOR_MODULES.live.rows.length;
  const riskCount = MONITOR_MODULES.risk.rows.length;

  const metrics = [
    {
      label: "待办订单",
      value: String(todoCount),
      hint: "去订单台账",
      href: "/merchant-console/dispatch",
    },
    {
      label: "进行中场次",
      value: String(liveCount),
      hint: "实时盯场",
      href: "/merchant-console/live",
    },
    {
      label: "异常事项",
      value: String(riskCount),
      hint: "争议 / 复核",
      href: "/merchant-console/risk",
    },
    {
      label: "财务风险",
      value: String(MONITOR_MODULES.finrisk.rows.length),
      hint: "待复核 / 冻结",
      href: "/merchant-console/finrisk",
    },
  ];

  return (
    <div>
      <div className="mc-pagehead">
        <div>
          <div className="mc-kicker">MONITOR / OVERVIEW</div>
          <h1>门店概览</h1>
          <p>营业脉搏与需要人工处理的风险，先看影响再给动作。</p>
        </div>
        <span className="mc-chip">
          演示数据 <b>未接后端</b>
        </span>
      </div>

      <div className="mc-monitor-metrics">
        {metrics.map((metric) => (
          <Link
            key={metric.label}
            href={metric.href}
            className="mc-metric-tile"
          >
            <span>{metric.label}</span>
            <b>{metric.value}</b>
            <em>
              {metric.hint}
              <ArrowRight size={12} />
            </em>
          </Link>
        ))}
      </div>

      <div className="mc-workgrid">
        <section className="mc-panel">
          <div className="mc-section-head">
            <div>
              <h2>需要留意</h2>
              <p>按影响排序</p>
            </div>
          </div>
          <div className="mc-agenda">
            <Link className="mc-agenda-row" href="/merchant-console/live">
              <time className="mc-mono">19:30</time>
              <span>
                <b>2 单需收结束证据</b>
                <p>场次接近计划结束，检查截图是否齐全。</p>
              </span>
            </Link>
            <Link
              className="mc-agenda-row"
              href="/merchant-console/settlements/s-0908-01"
            >
              <time className="mc-mono">待复核</time>
              <span>
                <b>1 笔结算待批准 · ¥860.00</b>
                <p>财务角色处理，发起人不能自己批准。</p>
              </span>
            </Link>
            <Link className="mc-agenda-row" href="/merchant-console/health">
              <time className="mc-mono">降级</time>
              <span>
                <b>短信通知未配置</b>
                <p>站内通知正常，短信通道提示降级。</p>
              </span>
            </Link>
          </div>
        </section>

        <aside className="mc-quiet-note" style={{ marginTop: 0 }}>
          <b>监控台原则</b>
          先看影响，再给动作；实时计时以服务端为准；风险都带“去处理”跳转；金额与状态不臆造。
        </aside>
      </div>
    </div>
  );
}

function MonitorTableView({ moduleId }: { moduleId: MonitorModuleId }) {
  const config = MONITOR_MODULES[moduleId];
  const { toast, showToast } = useDemoToast();
  const [pendingRow, setPendingRow] = useState<MonitorRow | null>(null);

  return (
    <div>
      <div className="mc-pagehead">
        <div>
          <div className="mc-kicker">{config.kicker}</div>
          <h1>{config.title}</h1>
          <p>{config.description}</p>
        </div>
        <span className="mc-chip">
          演示数据 <b>未接后端</b>
        </span>
      </div>

      {moduleId === "health" ? <HealthChannels /> : null}

      <section className="mc-panel">
        <div className="mc-table-wrap">
          <table>
            <thead>
              <tr>
                <th>编号</th>
                <th>对象 / 标题</th>
                <th>关键信息</th>
                <th>金额 / 状态值</th>
                <th>状态</th>
                <th>动作</th>
              </tr>
            </thead>
            <tbody>
              {config.rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className="mc-mono">{row.no}</span>
                  </td>
                  <td>
                    <b className="mc-cell-title">{row.title}</b>
                  </td>
                  <td>{row.info}</td>
                  <td>
                    <span className="mc-mono">{row.amount}</span>
                  </td>
                  <td>
                    <span className={`mc-status st-${row.tone}`}>
                      {row.statusLabel}
                    </span>
                  </td>
                  <td>
                    {row.href ? (
                      <Link
                        href={row.href}
                        className="mc-btn mc-btn-ghost mc-btn-small"
                      >
                        {row.actionLabel}
                        <ArrowRight size={13} />
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className="mc-btn mc-btn-ghost mc-btn-small"
                        onClick={() => setPendingRow(row)}
                      >
                        {row.actionLabel}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mc-table-foot">
            <span>显示 {config.rows.length} 条风险 / 提醒</span>
            <span>统一监控模板 · 演示数据</span>
          </div>
        </div>
      </section>

      {pendingRow ? (
        <DemoDialog
          open
          title={`${pendingRow.no} · ${pendingRow.title}`}
          confirmLabel="确认动作"
          onCancel={() => setPendingRow(null)}
          onConfirm={() => {
            setPendingRow(null);
            showToast(`${pendingRow.actionLabel}已记录 · 仅原型演示`);
          }}
        >
          <p>
            “{pendingRow.actionLabel}”演示动作将按对应后端流程执行；
            当前只更新页面反馈，不产生业务变更。
          </p>
          <div className="mc-summary-line">
            <span>关联金额 / 状态</span>
            <b>{pendingRow.amount}</b>
          </div>
        </DemoDialog>
      ) : null}

      {toast}
    </div>
  );
}

function HealthChannels() {
  const channels = [
    {
      name: "站内通知",
      status: "正常",
      tone: "st-done",
      note: "未发现失败记录",
    },
    {
      name: "短信通道",
      status: "未配置 · 降级",
      tone: "st-pending",
      note: "站内通知正常，短信发送将跳过",
    },
    {
      name: "微信订阅消息",
      status: "未配置 · 降级",
      tone: "st-pending",
      note: "等 AppID 授权后启用",
    },
    {
      name: "Outbox 死信",
      status: "0 条待重放",
      tone: "st-muted",
      note: "worker 每 5 分钟巡检一次",
    },
  ];

  return (
    <section className="mc-panel mc-channel-panel">
      <div className="mc-section-head">
        <div>
          <h2>触达通道</h2>
          <p>通道状态影响业务提醒可靠性；降级必须可见，不伪装送达。</p>
        </div>
      </div>
      <div className="mc-channel-list">
        {channels.map((channel) => (
          <div className="mc-channel-row" key={channel.name}>
            <span>
              <b>{channel.name}</b>
              <small>{channel.note}</small>
            </span>
            <span className={`mc-status ${channel.tone}`}>
              {channel.status}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

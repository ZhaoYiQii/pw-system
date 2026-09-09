"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api";
import { formatFenYuan } from "../money";
import { DemoEmptyState } from "./demo-ui";
import type { MerchantRole } from "./modules";
import { useMerchantRole } from "./role-context";
import {
  actionLabel,
  attentionHref,
  canSeeFinance,
  dashboardTiles,
  financeCards,
  riskHref,
  type DashboardAttentionItem,
  type DashboardRiskItem,
  type DashboardSummaryData,
} from "./workbench-data";

function RoleNotice({ role }: { role: MerchantRole }) {
  const label =
    role === "OWNER"
      ? "店老板"
      : role === "ADMIN"
        ? "店长"
        : role === "FINANCE"
          ? "财务"
          : "客服";
  return (
    <p>
      当前角色：{label} · 只呈现能采取行动的真实状态。
    </p>
  );
}

function AttentionRow({
  item,
  index,
}: {
  item: DashboardAttentionItem;
  index: number;
}) {
  return (
    <article className="mc-task" key={item.id}>
      <span className="mc-task-index">
        {String(index + 1).padStart(2, "0")}
      </span>
      <div className="mc-task-main">
        <strong>{item.title}</strong>
        <p>{item.subtitle ?? item.refNo}</p>
        <p className="mc-task-hint">
          {item.priority === "HIGH" ? "高优先级 · " : "常规 · "}
          点击进入对应记录处理
        </p>
      </div>
      <div className="mc-task-time">
        <Link
          href={attentionHref(item)}
          className="mc-btn mc-btn-small"
        >
          {actionLabel(item.action)}
          <ArrowRight size={13} />
        </Link>
      </div>
    </article>
  );
}

function RiskRow({ item }: { item: DashboardRiskItem }) {
  return (
    <Link className="mc-agenda-row" href={riskHref(item)}>
      <time className="mc-mono">
        {item.kind === "SETTLEMENT_TODO"
          ? "结算"
          : item.kind === "DISPUTE_TODO"
            ? "争议"
            : "调整"}
      </time>
      <span>
        <b>{item.title}</b>
        <p>
          {item.amountFen === undefined
            ? "需要人工处理"
            : `${formatFenYuan(item.amountFen)} · 需要人工处理`}
        </p>
      </span>
    </Link>
  );
}

export function WorkView() {
  const { principal, role } = useMerchantRole();
  const summaryQuery = useQuery({
    queryKey: ["merchant", "dashboard-summary"],
    queryFn: () =>
      apiFetch<DashboardSummaryData>("/api/v1/tenant/dashboard/summary"),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  const summary = summaryQuery.data;
  const dateLabel = useMemo(() => {
    if (!summary) return "";
    return summary.day.date.replace(/-/g, "/");
  }, [summary]);

  if (summaryQuery.isPending) {
    return (
      <section className="mc-panel">
        <div className="mc-loading-text">经营工作台加载中…</div>
      </section>
    );
  }

  if (summaryQuery.isError || !summary) {
    return (
      <div className="mc-notice">
        经营工作台数据加载失败：
        {summaryQuery.error instanceof Error
          ? summaryQuery.error.message
          : "未知错误"}
      </div>
    );
  }

  const metrics = summary.metrics;
  const tiles = dashboardTiles(role, metrics);
  const cards = financeCards(role, metrics);

  return (
    <div>
      <div className="mc-pagehead">
        <div>
          <div className="mc-kicker">WORKBENCH · {dateLabel}</div>
          <h1>经营工作台</h1>
          <p>
            今日已服务 {metrics.todayServiceCount} 单 · 进行中{" "}
            {metrics.liveSessions} 场
          </p>
          <RoleNotice role={role} />
        </div>
        <div className="mc-button-row">
          <Link href="/merchant-console/ai" className="mc-btn">
            AI 录单
          </Link>
          <Link
            href="/merchant-console/dispatch/new"
            className="mc-btn mc-btn-primary"
          >
            <Plus size={15} />
            新建派单
          </Link>
        </div>
      </div>

      {cards.length > 0 ? (
        <div className="mc-monitor-metrics">
          {cards.map((card) =>
            card.href ? (
              <Link
                key={card.id}
                href={card.href}
                className="mc-metric-tile"
              >
                <span>{card.label}</span>
                <b>{card.value}</b>
                <em>
                  查看结算 <ArrowRight size={12} />
                </em>
              </Link>
            ) : (
              <div
                key={card.id}
                className="mc-metric-tile"
                style={{ opacity: 0.72 }}
                aria-disabled="true"
              >
                <span>{card.label}</span>
                <b>{card.value}</b>
                <em>门店收入账本后续切片接入</em>
              </div>
            ),
          )}
        </div>
      ) : null}

      <div className="mc-monitor-metrics">
        {tiles.map((tile) => (
          <Link key={tile.id} href={tile.href} className="mc-metric-tile">
            <span>{tile.label}</span>
            <b>{tile.value}</b>
            <em>
              去处理 <ArrowRight size={12} />
            </em>
          </Link>
        ))}
        <div className="mc-metric-tile">
          <span>风险提醒</span>
          <b>{metrics.riskAlerts}</b>
          <em>来自真实状态推导</em>
        </div>
      </div>

      <div className="mc-workgrid">
        <section className="mc-panel">
          <div className="mc-section-head">
            <div>
              <h2>需要处理</h2>
              <p>订单 / 场次 / 结算 / 争议按时间倒序</p>
            </div>
            <span>{summary.attention.length} 项</span>
          </div>
          {summary.attention.length > 0 ? (
            summary.attention.slice(0, 8).map((item, index) => (
              <AttentionRow key={item.id} item={item} index={index} />
            ))
          ) : (
            <DemoEmptyState
              title="当前没有待办"
              description="全部订单、场次与结算均已处理。"
            />
          )}
        </section>

        <aside>
          <section className="mc-panel">
            <div className="mc-section-head">
              <div>
                <h2>风险与提醒</h2>
                <p>调整待复核 / 结算 / 争议</p>
              </div>
              <span>{summary.riskFeed.length} 项</span>
            </div>
            {summary.riskFeed.length > 0 ? (
              <div className="mc-agenda">
                {summary.riskFeed.slice(0, 5).map((item) => (
                  <RiskRow key={item.id} item={item} />
                ))}
              </div>
            ) : (
              <DemoEmptyState
                title="暂无风险提醒"
                description="当前没有需要留意的经营异常。"
              />
            )}
          </section>

          <section className="mc-panel">
            <div className="mc-section-head">
              <div>
                <h2>快捷动作</h2>
                <p>高频经营入口</p>
              </div>
            </div>
            <div className="mc-button-row">
              <Link href="/merchant-console/ai" className="mc-btn">
                AI 录单
              </Link>
              {canSeeFinance(role) ? (
                <>
                  <Link href="/merchant-console/settlements" className="mc-btn">
                    结算批次
                  </Link>
                  <Link href="/merchant-console/finrisk" className="mc-btn">
                    财务风险
                  </Link>
                </>
              ) : null}
              <Link href="/merchant-console/disputes" className="mc-btn">
                争议处理
              </Link>
            </div>
          </section>

          <div className="mc-quiet-note">
            <b>经营工作台原则</b>
            所有数字都是记录台/监控台的真实状态投影；点击后到对应页面完成动作。
            {principal?.username ? ` 当前账号：${principal.username}` : ""}
          </div>
        </aside>
      </div>
    </div>
  );
}

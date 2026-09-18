"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight, CircleAlert, Radio, Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { apiFetch } from "../api";
import { formatFenYuan } from "../money";
import type { MerchantRole } from "./modules";
import { useMerchantRole } from "./role-context";
import { NewOrderButton } from "./new-order-dialog";
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
    <p className="mt-2 text-sm text-slate-500">
      当前角色：{label} · 只呈现能采取行动的真实状态。
    </p>
  );
}

function EmptyBlock({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-6 text-center">
      <Sparkles className="mb-3 size-5 text-teal-600" aria-hidden="true" />
      <strong className="text-sm text-slate-800">{title}</strong>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
    </div>
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
    <article
      className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-4 border-b border-slate-100 px-1 py-4 last:border-b-0"
      key={item.id}
    >
      <span className="font-mono text-xs font-semibold text-slate-400">
        {String(index + 1).padStart(2, "0")}
      </span>
      <div className="min-w-0">
        <strong className="block truncate text-sm text-slate-900">
          {item.title}
        </strong>
        <p className="mt-1 truncate text-xs text-slate-500">
          {item.subtitle ?? item.refNo}
        </p>
        <p className="mt-1 text-xs text-slate-400">
          {item.priority === "HIGH" ? "高优先级 · " : "常规 · "}
          点击进入对应记录处理
        </p>
      </div>
      <Button
        asChild
        variant="outline"
        size="sm"
        className="rounded-lg shadow-none"
      >
        <Link href={attentionHref(item)}>
          {actionLabel(item.action)} <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    </article>
  );
}

function RiskRow({ item }: { item: DashboardRiskItem }) {
  return (
    <Link
      className="grid grid-cols-[42px_minmax(0,1fr)_16px] items-center gap-3 rounded-xl border border-transparent px-3 py-3 transition-colors hover:border-amber-200 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
      href={riskHref(item)}
    >
      <time className="rounded-md bg-amber-100 px-1.5 py-1 text-center font-mono text-xs font-semibold text-amber-800">
        {item.kind === "SETTLEMENT_TODO"
          ? "结算"
          : item.kind === "DISPUTE_TODO"
            ? "争议"
            : "调整"}
      </time>
      <span className="min-w-0">
        <b className="block truncate text-sm text-slate-900">{item.title}</b>
        <p className="mt-1 text-xs text-slate-500">
          {item.amountFen === undefined
            ? "需要人工处理"
            : `${formatFenYuan(item.amountFen)} · 需要人工处理`}
        </p>
      </span>
      <ArrowRight className="size-4 text-slate-400" aria-hidden="true" />
    </Link>
  );
}

function SignalTile({
  label,
  value,
  helper,
  href,
}: {
  label: string;
  value: string | number;
  helper: string;
  href?: string | null;
}) {
  const content = (
    <>
      <span className="text-xs font-semibold tracking-wide text-slate-400">
        {label}
      </span>
      <b className="mt-5 block whitespace-nowrap font-mono text-[clamp(1.25rem,1.8vw,1.75rem)] font-semibold tracking-tight text-white">
        {value}
      </b>
      <span className="mt-4 flex items-center gap-1 text-xs text-slate-400">
        {helper}
        {href ? <ArrowRight className="size-3" aria-hidden="true" /> : null}
      </span>
    </>
  );

  return href ? (
    <Link
      href={href}
      className="group min-w-0 border-l border-white/10 px-5 py-1 first:border-l-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-400"
    >
      {content}
    </Link>
  ) : (
    <div
      className="min-w-0 border-l border-white/10 px-5 py-1 first:border-l-0"
      aria-disabled="true"
    >
      {content}
    </div>
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
      <section className="rounded-2xl border border-slate-200 bg-white p-8">
        <div className="animate-pulse text-sm text-slate-500">
          经营工作台加载中…
        </div>
      </section>
    );
  }

  if (summaryQuery.isError || !summary) {
    return (
      <div
        className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        role="alert"
      >
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
  const signals = [
    ...cards.map((card) => ({
      ...card,
      helper: card.href ? "查看结算" : "收入账本待接入",
    })),
    ...tiles.map((tile) => ({ ...tile, helper: "去处理" })),
    {
      id: "risk-alerts",
      label: "风险提醒",
      value: metrics.riskAlerts,
      helper: "来自真实状态",
      href: "/merchant-console/risk",
    },
  ];

  return (
    <div className="space-y-6 pb-8">
      <header className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <div className="flex items-center gap-2 font-mono text-xs font-semibold tracking-[0.18em] text-teal-700">
            <Radio className="size-3.5" aria-hidden="true" /> 今日作战台 ·{" "}
            {dateLabel}
          </div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">
            经营工作台
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            今日已服务 {metrics.todayServiceCount} 单 · 进行中{" "}
            {metrics.liveSessions} 场
          </p>
          <RoleNotice role={role} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            asChild
            variant="outline"
            className="h-10 rounded-lg bg-white shadow-none"
          >
            <Link href="/merchant-console/ai">AI 录单</Link>
          </Button>
          <NewOrderButton className="inline-flex h-10 items-center gap-2 rounded-lg bg-teal-600 px-4 text-sm font-semibold text-white shadow-none transition-colors hover:bg-teal-700" />
        </div>
      </header>

      <section className="relative overflow-hidden rounded-2xl bg-[#15202b] px-1 py-6 shadow-[0_18px_50px_rgba(21,32,43,0.16)]">
        <div className="pointer-events-none absolute right-0 top-0 h-32 w-32 rounded-full bg-teal-400/10 blur-3xl" />
        <div className="mb-5 flex items-center gap-2 px-5 text-xs font-semibold tracking-[0.18em] text-teal-300">
          <span className="size-2 rounded-full bg-teal-400 shadow-[0_0_0_4px_rgba(45,212,191,0.12)]" />
          MATCH STRIP · 实时经营信号
        </div>
        <div className="grid grid-cols-2 gap-y-6 md:grid-cols-3 xl:grid-cols-6">
          {signals.map((signal) => (
            <SignalTile key={signal.id} {...signal} />
          ))}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.75fr)]">
        <Card className="rounded-2xl border-slate-200 shadow-[0_8px_30px_rgba(21,32,43,0.05)]">
          <CardHeader className="flex-row items-start justify-between space-y-0 border-b border-slate-100 p-6">
            <div>
              <h2 className="text-lg font-bold tracking-tight text-slate-950">
                需要处理
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                订单 / 场次 / 结算 / 争议按时间倒序
              </p>
            </div>
            <span className="rounded-full bg-teal-50 px-2.5 py-1 font-mono text-xs font-semibold text-teal-700">
              {summary.attention.length} 项
            </span>
          </CardHeader>
          <CardContent className="p-6">
            {summary.attention.length > 0 ? (
              summary.attention
                .slice(0, 8)
                .map((item, index) => (
                  <AttentionRow key={item.id} item={item} index={index} />
                ))
            ) : (
              <EmptyBlock
                title="当前没有待办"
                description="全部订单、场次与结算均已处理。"
              />
            )}
          </CardContent>
        </Card>

        <aside className="space-y-6">
          <Card className="rounded-2xl border-slate-200 shadow-[0_8px_30px_rgba(21,32,43,0.05)]">
            <CardHeader className="flex-row items-start justify-between space-y-0 border-b border-slate-100 p-5">
              <div>
                <h2 className="flex items-center gap-2 text-base font-bold text-slate-950">
                  <CircleAlert
                    className="size-4 text-amber-600"
                    aria-hidden="true"
                  />
                  风险与提醒
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  调整待复核 / 结算 / 争议
                </p>
              </div>
              <span className="font-mono text-xs text-slate-500">
                {summary.riskFeed.length} 项
              </span>
            </CardHeader>
            <CardContent className="p-3">
              {summary.riskFeed.length > 0 ? (
                summary.riskFeed
                  .slice(0, 5)
                  .map((item) => <RiskRow key={item.id} item={item} />)
              ) : (
                <EmptyBlock
                  title="暂无风险提醒"
                  description="当前没有需要留意的经营异常。"
                />
              )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-slate-200 shadow-[0_8px_30px_rgba(21,32,43,0.05)]">
            <CardHeader className="space-y-1 p-5 pb-3">
              <h2 className="text-base font-bold text-slate-950">快捷动作</h2>
              <p className="text-xs text-slate-500">高频经营入口</p>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 p-5 pt-1">
              <Button
                asChild
                variant="outline"
                size="sm"
                className="rounded-lg shadow-none"
              >
                <Link href="/merchant-console/ai">AI 录单</Link>
              </Button>
              {canSeeFinance(role) ? (
                <>
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="rounded-lg shadow-none"
                  >
                    <Link href="/merchant-console/settlements">结算批次</Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="rounded-lg shadow-none"
                  >
                    <Link href="/merchant-console/finrisk">财务风险</Link>
                  </Button>
                </>
              ) : null}
              <Button
                asChild
                variant="outline"
                size="sm"
                className="rounded-lg shadow-none"
              >
                <Link href="/merchant-console/disputes">争议处理</Link>
              </Button>
            </CardContent>
          </Card>

          <div className="rounded-xl border border-slate-200 bg-slate-100/70 px-4 py-3 text-xs leading-6 text-slate-500">
            <b className="mr-2 text-slate-700">经营工作台原则</b>
            所有数字都是记录台/监控台的真实状态投影；点击后到对应页面完成动作。
            {principal?.username ? ` 当前账号：${principal.username}` : ""}
          </div>
        </aside>
      </div>
    </div>
  );
}

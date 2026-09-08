"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Plus, Search } from "lucide-react";
import {
  DEMO_ORDER_STATUSES,
  filledCount,
  neededCount,
  orderNo,
  taskActionLabel,
  taskHint,
  type DemoOrder,
  type DemoOrderStatus,
} from "./demo-data";
import { DemoEmptyState, DemoStatusBadge, useDemoToast } from "./demo-ui";
import { useDemoStore } from "./demo-store";
import { useMerchantRole } from "./role-context";

type FilterValue = "ALL" | DemoOrderStatus;

const FILTER_TABS: Array<{ id: FilterValue; label: string }> = [
  { id: "ALL", label: "全部" },
  { id: "DRAFT", label: "待发布" },
  { id: "DISPATCHING", label: "报名选人" },
  { id: "ASSIGNED", label: "已选定" },
  { id: "IN_PROGRESS", label: "服务中" },
  { id: "PENDING_CONFIRMATION", label: "待核算" },
  { id: "COMPLETED", label: "已完成" },
  { id: "CANCELLED", label: "已取消" },
];

export function DispatchListView() {
  const { orders } = useDemoStore();
  const { role } = useMerchantRole();
  const { toast } = useDemoToast();
  const [filter, setFilter] = useState<FilterValue>("ALL");
  const [query, setQuery] = useState("");

  const canOperate = role === "OWNER" || role === "ADMIN" || role === "CS";

  useEffect(() => {
    const statusParam = new URLSearchParams(window.location.search).get(
      "status",
    );
    if (
      statusParam &&
      (DEMO_ORDER_STATUSES as readonly string[]).includes(statusParam)
    ) {
      setFilter(statusParam as DemoOrderStatus);
    }
  }, []);

  const rows = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return orders.filter((order) => {
      const statusOk = filter === "ALL" || order.status === filter;
      if (!statusOk) return false;
      if (!keyword) return true;
      return [orderNo(order), order.customer, order.game, order.mode].some(
        (text) => text.toLowerCase().includes(keyword),
      );
    });
  }, [orders, filter, query]);

  const countFor = (value: FilterValue) =>
    value === "ALL"
      ? orders.length
      : orders.filter((order) => order.status === value).length;

  return (
    <div>
      <div className="mc-pagehead">
        <div>
          <div className="mc-kicker">ORDER OPERATIONS</div>
          <h1>订单与派单</h1>
          <p>按需求、人员进度和当前动作快速判断每一单。</p>
        </div>
        {canOperate ? (
          <Link
            href="/merchant-console/dispatch/new"
            className="mc-btn mc-btn-primary"
          >
            <Plus size={15} />
            新建派单
          </Link>
        ) : null}
      </div>

      <section className="mc-panel">
        <div className="mc-filterbar">
          <div className="mc-filter-row">
            <label className="mc-searchbox">
              <Search size={15} aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索编号、客户或游戏"
                aria-label="搜索订单"
              />
            </label>
            <span className="mc-muted-text">
              更新于原型演示 · 已加载 {orders.length} 单
            </span>
          </div>
          <div className="mc-tabs" role="tablist" aria-label="订单状态">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={filter === tab.id}
                className={filter === tab.id ? "active" : undefined}
                onClick={() => setFilter(tab.id)}
              >
                {tab.label}
                <span className="mc-tab-count">{countFor(tab.id)}</span>
              </button>
            ))}
          </div>
        </div>

        {rows.length ? (
          <div className="mc-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>派单 / 客户</th>
                  <th>游戏需求</th>
                  <th>人员进度</th>
                  <th>预约 / 时长</th>
                  <th>当前状态</th>
                  <th>下一步</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((order) => (
                  <OrderRow key={order.id} order={order} />
                ))}
              </tbody>
            </table>
            <div className="mc-table-foot">
              <span>
                显示 {rows.length} / {orders.length} 单
              </span>
              <span>原型演示数据 · 按编号倒序</span>
            </div>
          </div>
        ) : (
          <DemoEmptyState
            title="没有符合条件的派单"
            description="调整搜索文字或清空当前筛选。"
          >
            <button
              type="button"
              className="mc-btn"
              onClick={() => {
                setFilter("ALL");
                setQuery("");
              }}
            >
              清空筛选
            </button>
          </DemoEmptyState>
        )}
      </section>
      {toast}
    </div>
  );
}

function OrderRow({ order }: { order: DemoOrder }) {
  const applied = order.players.filter(
    (player) => player.status === "APPLIED",
  ).length;
  const total = neededCount(order);
  const done = filledCount(order);
  const percent = total ? Math.round((done / total) * 100) : 0;
  const hint =
    order.status === "DISPATCHING" ? `${applied} 人待选` : taskHint(order);

  return (
    <tr>
      <td>
        <Link
          href={`/merchant-console/dispatch/${order.id}`}
          className="mc-order-link"
        >
          {orderNo(order)}
        </Link>
        <span className="mc-sub">{order.customer}</span>
      </td>
      <td>
        <b className="mc-cell-title">{order.game}</b>
        <span className="mc-sub">
          {order.mode} ·{" "}
          {order.roles.map((role) => `${role.name} ${role.need}`).join(" / ")}
        </span>
      </td>
      <td>
        <span className="mc-mono">
          {done} / {total}
        </span>
        <span className="mc-sub">
          {order.status === "CANCELLED" || total === 0
            ? "无有效席位"
            : done >= total
              ? "人员已确认"
              : hint}
        </span>
        <div className="mc-progress" aria-label={`人员进度 ${percent}%`}>
          <i style={{ width: `${percent}%` }} />
        </div>
      </td>
      <td>
        <span className="mc-mono">{order.time}</span>
        <span className="mc-sub">{order.duration} 分钟</span>
      </td>
      <td>
        <DemoStatusBadge status={order.status} />
      </td>
      <td>
        <Link
          href={`/merchant-console/dispatch/${order.id}`}
          className="mc-btn mc-btn-ghost mc-btn-small"
        >
          {taskActionLabel(order)}
          <ArrowRight size={13} />
        </Link>
      </td>
    </tr>
  );
}

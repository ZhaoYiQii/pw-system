"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Plus, RefreshCw } from "lucide-react";
import {
  DEMO_STATUS_META,
  isTodo,
  orderNo,
  taskActionLabel,
  taskHint,
  type DemoOrder,
  type DemoOrderStatus,
} from "./demo-data";
import { DemoEmptyState, useDemoToast } from "./demo-ui";
import { useDemoStore } from "./demo-store";

type TaskFilter = "ALL" | DemoOrderStatus;

const TASK_TABS: Array<{ id: TaskFilter; label: string }> = [
  { id: "ALL", label: "全部" },
  { id: "DRAFT", label: "待发布" },
  { id: "DISPATCHING", label: "待选人" },
  { id: "PENDING_CONFIRMATION", label: "待核算" },
];

const PULSE_ITEMS: Array<{ status: DemoOrderStatus; label: string }> = [
  { status: "DRAFT", label: "待发布" },
  { status: "DISPATCHING", label: "报名选人" },
  { status: "PENDING_CONFIRMATION", label: "待核算" },
  { status: "IN_PROGRESS", label: "服务中" },
];

export function WorkView() {
  const { orders, resetData } = useDemoStore();
  const { toast, showToast } = useDemoToast();
  const [filter, setFilter] = useState<TaskFilter>("ALL");

  const todoOrders = orders.filter(isTodo);
  const tasks =
    filter === "ALL"
      ? todoOrders
      : todoOrders.filter((order) => order.status === filter);

  const agenda = orders
    .filter((order) =>
      ["DRAFT", "ASSIGNED", "IN_PROGRESS"].includes(order.status),
    )
    .slice(0, 3);

  return (
    <div>
      <div className="mc-pagehead">
        <div>
          <div className="mc-kicker">TODAY · 09/08</div>
          <h1>晚上好，宁宁</h1>
          <p>先处理阻塞营业的订单，再安排今晚服务。</p>
        </div>
        <div className="mc-button-row">
          <button
            type="button"
            className="mc-btn"
            onClick={() => {
              resetData();
              setFilter("ALL");
              showToast("演示数据已重置");
            }}
          >
            <RefreshCw size={15} />
            重置演示数据
          </button>
          <Link
            href="/merchant-console/dispatch/new"
            className="mc-btn mc-btn-primary"
          >
            <Plus size={15} />
            新建派单
          </Link>
        </div>
      </div>

      <div className="mc-pulse">
        <div className="mc-pulse-intro">
          <small>今日运营脉搏</small>
          <strong>{todoOrders.length} 件待办</strong>
        </div>
        {PULSE_ITEMS.map((item) => (
          <Link
            key={item.status}
            href={`/merchant-console/dispatch?status=${item.status}`}
            className="mc-pulse-item"
          >
            <span>{item.label}</span>
            <b>
              {orders.filter((order) => order.status === item.status).length}
            </b>
            <em>查看订单</em>
          </Link>
        ))}
      </div>

      <div className="mc-workgrid">
        <section className="mc-panel">
          <div className="mc-section-head">
            <div>
              <h2>需要处理</h2>
              <p>按阻塞程度与预约时间排列</p>
            </div>
            <span>{tasks.length} 单</span>
          </div>
          <div className="mc-task-tabs" role="tablist" aria-label="待办分组">
            {TASK_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={filter === tab.id}
                className={filter === tab.id ? "active" : undefined}
                onClick={() => setFilter(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {tasks.length ? (
            tasks.map((order, index) => (
              <TaskRow key={order.id} order={order} index={index} />
            ))
          ) : (
            <DemoEmptyState
              title="当前没有此类待办"
              description="切换分类查看其他需要处理的订单。"
            />
          )}
        </section>

        <aside>
          <section className="mc-panel">
            <div className="mc-section-head">
              <div>
                <h2>今晚服务</h2>
                <p>预约时间用于排班参考</p>
              </div>
              <span>{agenda.length} 场</span>
            </div>
            <div className="mc-agenda">
              {agenda.length ? (
                agenda.map((order) => (
                  <Link
                    key={order.id}
                    className="mc-agenda-row"
                    href={`/merchant-console/dispatch/${order.id}`}
                  >
                    <time>{order.time}</time>
                    <span>
                      <b>
                        {order.game} · {order.customer}
                      </b>
                      <p>
                        {DEMO_STATUS_META[order.status].label} ·{" "}
                        {order.duration} 分钟
                      </p>
                    </span>
                  </Link>
                ))
              ) : (
                <DemoEmptyState
                  title="今晚暂无排班"
                  description="创建草稿并发布派单后会出现在这里。"
                />
              )}
            </div>
          </section>
          <div className="mc-quiet-note">
            <b>工作台原则</b>
            只呈现能采取行动的真实状态。营收、在线人数与匹配评分需要真实聚合接口后再加入。
          </div>
        </aside>
      </div>
      {toast}
    </div>
  );
}

function TaskRow({ order, index }: { order: DemoOrder; index: number }) {
  const actionLabel = taskActionLabel(order);
  return (
    <article className="mc-task">
      <span className="mc-task-index">
        {String(index + 1).padStart(2, "0")}
      </span>
      <div className="mc-task-main">
        <strong>
          {order.game} · {order.customer}
        </strong>
        <p>
          {order.mode} · {orderNo(order)} · {order.duration} 分钟
        </p>
        <p className="mc-task-hint">{taskHint(order)}</p>
      </div>
      <div className="mc-task-time">
        <b>{order.time}</b>
        <Link
          href={`/merchant-console/dispatch/${order.id}`}
          className="mc-btn mc-btn-small"
        >
          {actionLabel}
          <ArrowRight size={13} />
        </Link>
      </div>
    </article>
  );
}

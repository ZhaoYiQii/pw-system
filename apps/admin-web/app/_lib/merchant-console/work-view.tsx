"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api";
import { DemoEmptyState } from "./demo-ui";
import {
  type DispatchRow,
  type OrderRow,
  statusLabel,
} from "./merchant-api";
import { useMerchantRole } from "./role-context";

interface UnifiedOrder {
  key: string;
  id: string;
  kind: "CLASSIC" | "GD";
  no: string;
  customerName: string;
  status: string;
  createdAt: string;
}

const TODO_STATUSES = ["DRAFT", "CONFIRMED", "DISPATCHING", "PENDING_CONFIRMATION"];

const FILTERS = [
  { id: "ALL", label: "全部" },
  { id: "DRAFT", label: "待发布" },
  { id: "DISPATCHING", label: "待选人" },
  { id: "PENDING_CONFIRMATION", label: "待核算" },
];

function isTodo(status: string): boolean {
  return TODO_STATUSES.includes(status);
}

export function WorkView() {
  const { principal } = useMerchantRole();
  const ordersQuery = useQuery({
    queryKey: ["merchant", "work", "orders"],
    queryFn: () => apiFetch<OrderRow[]>("/api/v1/tenant/orders"),
  });
  const gdQuery = useQuery({
    queryKey: ["merchant", "work", "gd"],
    queryFn: () => apiFetch<DispatchRow[]>("/api/v1/tenant/game-dispatch"),
  });

  const orders = useMemo<UnifiedOrder[]>(() => {
    const classic: UnifiedOrder[] = (ordersQuery.data ?? []).map((row) => ({
      key: `c-${row.id}`,
      id: row.id,
      kind: "CLASSIC",
      no: row.orderNo,
      customerName: row.customerName,
      status: row.status,
      createdAt: row.createdAt,
    }));
    const gd: UnifiedOrder[] = (gdQuery.data ?? []).map((row) => ({
      key: `g-${row.orderId}`,
      id: row.orderId,
      kind: "GD",
      no: row.dispatchNo,
      customerName: "老板订单",
      status: row.status,
      createdAt: row.createdAt,
    }));
    return [...classic, ...gd].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }, [ordersQuery.data, gdQuery.data]);

  const todoOrders = orders.filter((order) => isTodo(order.status));
  const pulse = ["DRAFT", "DISPATCHING", "PENDING_CONFIRMATION", "IN_PROGRESS"];
  const agenda = orders
    .filter((order) =>
      ["DRAFT", "ASSIGNED", "IN_PROGRESS"].includes(order.status),
    )
    .slice(0, 5);
  const now = new Date();
  const todayLabel = `${now.getMonth() + 1}/${String(now.getDate()).padStart(2, "0")}`;
  const greeting =
    now.getHours() < 6
      ? "凌晨好"
      : now.getHours() < 12
        ? "上午好"
        : now.getHours() < 18
          ? "下午好"
          : "晚上好";

  return (
    <div>
      <div className="mc-pagehead">
        <div>
          <div className="mc-kicker">TODAY · {todayLabel}</div>
          <h1>
            {greeting}，{principal?.username ?? "商家员工"}
          </h1>
          <p>来自真实订单/派单接口：先处理阻塞营业的订单，再安排服务。</p>
        </div>
        <Link
          href="/merchant-console/dispatch/new"
          className="mc-btn mc-btn-primary"
        >
          <Plus size={15} />
          新建派单
        </Link>
      </div>

      {ordersQuery.isError || gdQuery.isError ? (
        <div className="mc-notice">
          订单数据加载失败：
          {ordersQuery.error instanceof Error
            ? ordersQuery.error.message
            : gdQuery.error instanceof Error
              ? gdQuery.error.message
              : "未知错误"}
        </div>
      ) : null}

      <div className="mc-pulse">
        <div className="mc-pulse-intro">
          <small>今日运营脉搏</small>
          <strong>{todoOrders.length} 件待办</strong>
        </div>
        {pulse.map((item) => (
          <Link
            key={item}
            href={`/merchant-console/dispatch?status=${item}`}
            className="mc-pulse-item"
          >
            <span>{statusLabel(item)}</span>
            <b>{orders.filter((order) => order.status === item).length}</b>
            <em>查看订单</em>
          </Link>
        ))}
      </div>

      <div className="mc-workgrid">
        <section className="mc-panel">
          <div className="mc-section-head">
            <div>
              <h2>需要处理</h2>
              <p>按创建时间倒序 · 来自订单/派单台账</p>
            </div>
            <span>{todoOrders.length} 单</span>
          </div>
          <div className="mc-task-tabs" role="tablist" aria-label="待办分组">
            {FILTERS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={tab.id === "ALL"}
                className={tab.id === "ALL" ? "active" : undefined}
                onClick={() => {
                  const params = new URLSearchParams(window.location.search);
                  if (tab.id === "ALL") params.delete("status");
                  else params.set("status", tab.id);
                  window.location.href = `/merchant-console/dispatch?${params.toString()}`;
                }}
              >
                {tab.label}
                <span className="mc-tab-count">
                  {tab.id === "ALL"
                    ? todoOrders.length
                    : todoOrders.filter((o) => o.status === tab.id).length}
                </span>
              </button>
            ))}
          </div>
          {todoOrders.length ? (
            todoOrders.slice(0, 8).map((order, index) => (
              <article className="mc-task" key={order.key}>
                <span className="mc-task-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="mc-task-main">
                  <strong>
                    {order.kind} · {order.no}
                  </strong>
                  <p>
                    {order.customerName} · {statusLabel(order.status)}
                  </p>
                  <p className="mc-task-hint">
                    查看详情并执行下一步操作
                  </p>
                </div>
                <div className="mc-task-time">
                  <b>{new Date(order.createdAt).toLocaleDateString("zh-CN")}</b>
                  <Link
                    href={`/merchant-console/dispatch/${order.id}?kind=${order.kind}`}
                    className="mc-btn mc-btn-small"
                  >
                    {order.status === "DRAFT" || order.status === "CONFIRMED"
                      ? "去发布"
                      : order.status === "DISPATCHING"
                        ? "去选人"
                        : "去核算"}
                    <ArrowRight size={13} />
                  </Link>
                </div>
              </article>
            ))
          ) : (
            <DemoEmptyState
              title="当前没有此类待办"
              description="全部订单均已处理，或当前角色看不到待办状态。"
            />
          )}
        </section>

        <aside>
          <section className="mc-panel">
            <div className="mc-section-head">
              <div>
                <h2>待服务排班</h2>
                <p>草稿 / 已选定 / 服务中的订单</p>
              </div>
              <span>{agenda.length} 单</span>
            </div>
            <div className="mc-agenda">
              {agenda.length ? (
                agenda.map((order) => (
                  <Link
                    key={order.key}
                    className="mc-agenda-row"
                    href={`/merchant-console/dispatch/${order.id}?kind=${order.kind}`}
                  >
                    <time>{statusLabel(order.status)}</time>
                    <span>
                      <b>
                        {order.kind} · {order.no}
                      </b>
                      <p>{order.customerName}</p>
                    </span>
                  </Link>
                ))
              ) : (
                <DemoEmptyState
                  title="暂无待服务订单"
                  description="新建派单并发布后，订单会出现在这里。"
                />
              )}
            </div>
          </section>
          <div className="mc-quiet-note">
            <b>工作台原则</b>
            只呈现能采取行动的真实状态；营收与在线人数等指标由对应聚合接口提供。
          </div>
        </aside>
      </div>
    </div>
  );
}

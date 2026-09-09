"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Plus, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api";
import { DemoEmptyState } from "./demo-ui";
import {
  type DispatchRow,
  type OrderRow,
  statusLabel,
  toneFor,
} from "./merchant-api";
import { useMerchantRole } from "./role-context";

interface UnifiedOrder {
  key: string;
  id: string;
  kind: "CLASSIC" | "GD";
  no: string;
  customerName: string;
  status: string;
  durationText: string;
  createdAt: string;
}

type FilterValue = "ALL" | string;

const STATUS_ORDER = [
  "DRAFT",
  "CONFIRMED",
  "DISPATCHING",
  "ASSIGNED",
  "READY",
  "IN_PROGRESS",
  "PENDING_CONFIRMATION",
  "COMPLETED",
  "CANCELLED",
];

const FILTER_TABS: Array<{ id: FilterValue; label: string }> = [
  { id: "ALL", label: "全部" },
  ...STATUS_ORDER.map((status) => ({
    id: status as FilterValue,
    label: statusLabel(status),
  })),
];

export function DispatchListView() {
  const { role } = useMerchantRole();
  const [filter, setFilter] = useState<FilterValue>("ALL");
  const [query, setQuery] = useState("");

  const ordersQuery = useQuery({
    queryKey: ["merchant", "dispatch", "classic"],
    queryFn: () => apiFetch<OrderRow[]>("/api/v1/tenant/orders"),
  });
  const gdQuery = useQuery({
    queryKey: ["merchant", "dispatch", "gd"],
    queryFn: () => apiFetch<DispatchRow[]>("/api/v1/tenant/game-dispatch"),
  });

  useEffect(() => {
    const statusParam = new URLSearchParams(window.location.search).get(
      "status",
    );
    if (statusParam) setFilter(statusParam);
  }, []);

  const all = useMemo<UnifiedOrder[]>(() => {
    const classic: UnifiedOrder[] = (ordersQuery.data ?? []).map((row) => ({
      key: `c-${row.id}`,
      id: row.id,
      kind: "CLASSIC",
      no: row.orderNo,
      customerName: row.customerName,
      status: row.status,
      durationText: "—",
      createdAt: row.createdAt,
    }));
    const gd: UnifiedOrder[] = (gdQuery.data ?? []).map((row) => ({
      key: `g-${row.orderId}`,
      id: row.orderId,
      kind: "GD",
      no: row.dispatchNo,
      customerName: "老板订单",
      status: row.status,
      durationText: `${row.durationMinutes} 分钟`,
      createdAt: row.createdAt,
    }));
    return [...classic, ...gd].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }, [ordersQuery.data, gdQuery.data]);

  const rows = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return all.filter((order) => {
      const statusOk = filter === "ALL" || order.status === filter;
      if (!statusOk) return false;
      if (!keyword) return true;
      return [order.no, order.customerName, order.kind].some((text) =>
        text.toLowerCase().includes(keyword),
      );
    });
  }, [all, filter, query]);

  const countFor = (value: FilterValue) =>
    value === "ALL" ? all.length : all.filter((o) => o.status === value).length;
  const canOperate = role === "OWNER" || role === "ADMIN" || role === "CS";

  return (
    <div>
      <div className="mc-pagehead">
        <div>
          <div className="mc-kicker">RECORDS / ORDERS</div>
          <h1>订单与派单</h1>
          <p>真实订单台账：CLASSIC 订单与 GAME_DISPATCH 派单按状态汇总。</p>
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

      {ordersQuery.isError || gdQuery.isError ? (
        <div className="mc-notice">
          订单加载失败，请检查 API 服务或登录会话。
        </div>
      ) : null}

      <section className="mc-panel">
        <div className="mc-filterbar">
          <div className="mc-filter-row">
            <label className="mc-searchbox">
              <Search size={15} aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索编号、客户或类型"
                aria-label="搜索订单"
              />
            </label>
            <span className="mc-muted-text">
              已加载 {all.length} 单 · 来自真实接口
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
                  <th>单号</th>
                  <th>类型 / 客户</th>
                  <th>时长</th>
                  <th>创建时间</th>
                  <th>当前状态</th>
                  <th>下一步</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((order) => (
                  <tr key={order.key}>
                    <td>
                      <Link
                        href={`/merchant-console/dispatch/${order.id}?kind=${order.kind}`}
                        className="mc-order-link"
                      >
                        {order.no}
                      </Link>
                    </td>
                    <td>
                      <b className="mc-cell-title">
                        {order.kind === "GD" ? "GAME_DISPATCH" : "CLASSIC"}
                      </b>
                      <span className="mc-sub">{order.customerName}</span>
                    </td>
                    <td>
                      <span className="mc-sub">{order.durationText}</span>
                    </td>
                    <td>
                      <span className="mc-mono">
                        {new Date(order.createdAt).toLocaleString("zh-CN", {
                          hour12: false,
                        })}
                      </span>
                    </td>
                    <td>
                      <span className={`mc-status st-${toneFor(order.status)}`}>
                        {statusLabel(order.status)}
                      </span>
                    </td>
                    <td>
                      <Link
                        href={`/merchant-console/dispatch/${order.id}?kind=${order.kind}`}
                        className="mc-btn mc-btn-ghost mc-btn-small"
                      >
                        查看详情
                        <ArrowRight size={13} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mc-table-foot">
              <span>
                显示 {rows.length} / {all.length} 单
              </span>
              <span>订单接口：/tenant/orders · /tenant/game-dispatch</span>
            </div>
          </div>
        ) : (
          <DemoEmptyState
            title="没有符合条件的订单"
            description="调整筛选或搜索条件后重试。"
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
    </div>
  );
}

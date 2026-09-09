"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ArrowRight, Download, Plus, Search } from "lucide-react";
import { apiFetch } from "../api";
import { formatFenYuan, yuanToFenString } from "../money";
import type {
  AuditRow,
  CustomerRow,
  DisputeRow,
  PlayerRow,
  SessionRow,
} from "./record-api";

export function CustomersConsoleView() {
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [remark, setRemark] = useState("");

  const rowsQuery = useQuery({
    queryKey: ["mc-record-customers"],
    queryFn: () => apiFetch<CustomerRow[]>("/api/v1/tenant/customers"),
  });
  const create = useMutation({
    mutationFn: () =>
      apiFetch<CustomerRow>("/api/v1/tenant/customers", {
        method: "POST",
        body: JSON.stringify({
          name,
          ...(mobile ? { mobile } : {}),
          ...(remark ? { remark } : {}),
        }),
      }),
    onSuccess: () => {
      setName("");
      setMobile("");
      setRemark("");
      void queryClient.invalidateQueries({ queryKey: ["mc-record-customers"] });
    },
  });

  const rows = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return rowsQuery.data ?? [];
    return (rowsQuery.data ?? []).filter(
      (row) =>
        row.name.toLowerCase().includes(q) ||
        (row.mobile ?? "").toLowerCase().includes(q),
    );
  }, [rowsQuery.data, keyword]);

  return (
    <div>
      <PageHead kicker="RECORDS / CUSTOMERS" title="客户档案" />
      <section className="mc-panel">
        <form
          className="mc-form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <label className="mc-field">
            <span>姓名 *</span>
            <input
              value={name}
              required
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="mc-field">
            <span>手机（可选）</span>
            <input
              value={mobile}
              onChange={(event) => setMobile(event.target.value)}
            />
          </label>
          <label className="mc-field">
            <span>备注（可选）</span>
            <input
              value={remark}
              onChange={(event) => setRemark(event.target.value)}
            />
          </label>
          <div className="mc-button-row">
            <button
              type="submit"
              className="mc-btn mc-btn-primary"
              disabled={create.isPending}
            >
              <Plus size={15} />
              新建客户
            </button>
          </div>
        </form>
      </section>
      <section className="mc-panel">
        <div className="mc-filterbar">
          <label className="mc-searchbox">
            <Search size={15} />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索姓名/手机"
              aria-label="搜索客户"
            />
          </label>
        </div>
        <SimpleTable
          loading={rowsQuery.isPending}
          errorMessage={
            rowsQuery.error instanceof Error
              ? rowsQuery.error.message
              : null
          }
          headers={["客户", "手机", "备注", "状态", ""]}
          rows={rows}
          empty={<>暂无客户，先新建一个。</>}
          renderRow={(customer) => (
            <>
              <td>
                <b className="mc-cell-title">{customer.name}</b>
              </td>
              <td>{customer.mobile ?? "-"}</td>
              <td>{customer.remark ?? "-"}</td>
              <td>
                <StatusChip
                  text={customer.status === "ACTIVE" ? "正常" : "已停用"}
                  tone={customer.status === "ACTIVE" ? "done" : "muted"}
                />
              </td>
              <td>
                <Link
                  href={`/merchant-console/customers/${customer.id}`}
                  className="mc-btn mc-btn-ghost mc-btn-small"
                >
                  详情 <ArrowRight size={13} />
                </Link>
              </td>
            </>
          )}
        />
      </section>
    </div>
  );
}

export function PlayersConsoleView() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [baseYuan, setBaseYuan] = useState("");

  const rowsQuery = useQuery({
    queryKey: ["mc-record-players"],
    queryFn: () => apiFetch<PlayerRow[]>("/api/v1/tenant/players"),
  });
  const create = useMutation({
    mutationFn: async () => {
      const baseFen = yuanToFenString(baseYuan);
      if (!name.trim() || baseFen === null)
        throw new Error("请填写姓名与合法小时价");
      return apiFetch<PlayerRow>("/api/v1/tenant/players", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          mobile: mobile.trim() || undefined,
          basePricePerHourFen: baseFen,
        }),
      });
    },
    onSuccess: () => {
      setName("");
      setMobile("");
      setBaseYuan("");
      void queryClient.invalidateQueries({ queryKey: ["mc-record-players"] });
    },
  });
  const toggle = useMutation({
    mutationFn: (player: PlayerRow) =>
      apiFetch<PlayerRow>(`/api/v1/tenant/players/${player.id}`, {
        method: "PATCH",
        body: JSON.stringify({ acceptingOrders: !player.acceptingOrders }),
      }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["mc-record-players"] }),
  });

  return (
    <div>
      <PageHead kicker="RECORDS / PLAYERS" title="陪玩档案" />
      <section className="mc-panel">
        <form
          className="mc-form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <label className="mc-field">
            <span>姓名 *</span>
            <input
              value={name}
              required
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="mc-field">
            <span>手机（可选）</span>
            <input
              value={mobile}
              onChange={(event) => setMobile(event.target.value)}
            />
          </label>
          <label className="mc-field">
            <span>基础小时价（元）*</span>
            <input
              inputMode="decimal"
              value={baseYuan}
              required
              onChange={(event) => setBaseYuan(event.target.value)}
            />
          </label>
          <div className="mc-button-row">
            <button
              type="submit"
              className="mc-btn mc-btn-primary"
              disabled={create.isPending}
            >
              <Plus size={15} />
              新建陪玩
            </button>
          </div>
        </form>
      </section>
      <section className="mc-panel">
        <SimpleTable
          loading={rowsQuery.isPending}
          errorMessage={
            rowsQuery.error instanceof Error
              ? rowsQuery.error.message
              : null
          }
          headers={["姓名", "手机", "小时价", "接单", "操作"]}
          rows={rowsQuery.data ?? []}
          empty={<>暂无陪玩，先新建一个。</>}
          renderRow={(player) => (
            <>
              <td>
                <b className="mc-cell-title">{player.name}</b>
              </td>
              <td>{player.mobile ?? "-"}</td>
              <td className="mc-mono">
                {formatFenYuan(player.basePricePerHourFen)}/小时
              </td>
              <td>
                <StatusChip
                  text={player.acceptingOrders ? "接单中" : "暂停"}
                  tone={player.acceptingOrders ? "running" : "muted"}
                />
              </td>
              <td>
                <div className="mc-button-row">
                  <Link
                    href={`/merchant-console/players/${player.id}`}
                    className="mc-btn mc-btn-ghost mc-btn-small"
                  >
                    详情
                  </Link>
                  <button
                    type="button"
                    className="mc-btn mc-btn-small"
                    disabled={toggle.isPending}
                    onClick={() => toggle.mutate(player)}
                  >
                    {player.acceptingOrders ? "暂停接单" : "恢复接单"}
                  </button>
                </div>
              </td>
            </>
          )}
        />
      </section>
    </div>
  );
}

export function SessionsConsoleView() {
  const [status, setStatus] = useState("");
  const rowsQuery = useQuery({
    queryKey: ["mc-record-sessions", status],
    queryFn: () => {
      const query = status ? `?status=${encodeURIComponent(status)}` : "";
      return apiFetch<SessionRow[]>(`/api/v1/tenant/sessions${query}`);
    },
  });
  return (
    <div>
      <PageHead kicker="RECORDS / SESSIONS" title="场次与证据" />
      <section className="mc-panel">
        <div className="mc-filterbar">
          <label className="mc-field mc-field-narrow">
            <span>状态筛选</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">全部状态</option>
              <option value="SCHEDULED">待开始</option>
              <option value="STARTED">进行中</option>
              <option value="ENDED">已结束</option>
              <option value="ADJUSTMENT_PENDING">调整待复核</option>
              <option value="CONFIRMED">已确认</option>
            </select>
          </label>
        </div>
        <SimpleTable
          loading={rowsQuery.isPending}
          errorMessage={
            rowsQuery.error instanceof Error
              ? rowsQuery.error.message
              : null
          }
          headers={["订单", "流程", "客户 / 陪玩", "状态", "证据", ""]}
          rows={rowsQuery.data ?? []}
          empty={<>暂无场次。</>}
          renderRow={(session) => (
            <>
              <td>
                <span className="mc-mono">{session.orderNo}</span>
              </td>
              <td>
                <StatusChip
                  text={
                    session.flow === "GAME_DISPATCH" ? "GD" : "CLASSIC"
                  }
                  tone={
                    session.flow === "GAME_DISPATCH" ? "dispatch" : "assigned"
                  }
                />
              </td>
              <td>
                {session.customerName} × {session.playerName}
              </td>
              <td>
                <SessionStatusChip status={session.status} />
              </td>
              <td className="mc-mono">{session.evidenceCount}</td>
              <td>
                <Link
                  href={`/merchant-console/sessions/${session.id}`}
                  className="mc-btn mc-btn-ghost mc-btn-small"
                >
                  详情 <ArrowRight size={13} />
                </Link>
              </td>
            </>
          )}
        />
      </section>
    </div>
  );
}

export function DisputesConsoleView() {
  const rowsQuery = useQuery({
    queryKey: ["mc-record-disputes"],
    queryFn: () => apiFetch<DisputeRow[]>("/api/v1/tenant/disputes"),
  });
  return (
    <div>
      <PageHead kicker="RECORDS / DISPUTES" title="客诉记录" />
      <section className="mc-panel">
        <SimpleTable
          loading={rowsQuery.isPending}
          errorMessage={
            rowsQuery.error instanceof Error
              ? rowsQuery.error.message
              : null
          }
          headers={["订单", "客户 / 陪玩", "原因", "状态", "操作"]}
          rows={rowsQuery.data ?? []}
          empty={<>暂无争议。</>}
          renderRow={(dispute) => (
            <>
              <td>
                <span className="mc-mono">{dispute.orderNo}</span>
              </td>
              <td>
                {dispute.customerName} × {dispute.playerName}
              </td>
              <td>{dispute.reason}</td>
              <td>
                <StatusChip
                  text={dispute.status === "OPEN" ? "待处理" : "已处理"}
                  tone={dispute.status === "OPEN" ? "pending" : "done"}
                />
              </td>
              <td>
                <Link
                  href={`/merchant-console/disputes/${dispute.id}`}
                  className="mc-btn mc-btn-ghost mc-btn-small"
                >
                  详情 <ArrowRight size={13} />
                </Link>
              </td>
            </>
          )}
        />
      </section>
    </div>
  );
}

export function AuditConsoleView() {
  const [keyword, setKeyword] = useState("");
  const [action, setAction] = useState("");
  const [actorType, setActorType] = useState("");
  const [from] = useState("");
  const [to] = useState("");
  const [offset, setOffset] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);
  const PAGE_SIZE = 50;

  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });
  if (keyword.trim()) params.set("q", keyword.trim());
  if (action.trim()) params.set("action", action.trim());
  if (actorType) params.set("actorType", actorType);
  if (from) params.set("from", new Date(from).toISOString());
  if (to) params.set("to", new Date(to).toISOString());

  const rowsQuery = useQuery({
    queryKey: ["mc-record-audit", keyword, action, actorType, from, to, offset],
    queryFn: () =>
      apiFetch<AuditRow[]>(`/api/v1/tenant/audit?${params.toString()}`),
  });
  const rows = rowsQuery.data ?? [];
  const hasMore = rows.length === PAGE_SIZE;

  const exportCsv = async () => {
    setExporting(true);
    setDownloadMessage(null);
    try {
      const data = await apiFetch<{ csv: string; filename: string }>(
        `/api/v1/tenant/audit/export?${params.toString()}`,
      );
      const blob = new Blob(["\uFEFF" + data.csv], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = data.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setDownloadMessage(
        `已导出 ${Math.max(0, data.csv.split("\n").length - 1)} 条记录。`,
      );
    } catch (error) {
      setDownloadMessage(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <PageHead kicker="RECORDS / AUDIT" title="审计日志" />
      <section className="mc-panel">
        <div className="mc-filter-row">
          <label className="mc-searchbox">
            <Search size={15} />
            <input
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value);
                setOffset(0);
              }}
              placeholder="关键词"
            />
          </label>
          <input
            className="mc-input-inline"
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setOffset(0);
            }}
            placeholder="动作"
          />
          <select
            className="mc-input-inline"
            value={actorType}
            onChange={(event) => {
              setActorType(event.target.value);
              setOffset(0);
            }}
          >
            <option value="">全部操作者</option>
            <option value="TENANT_OWNER">店老板</option>
            <option value="TENANT_ADMIN">店长</option>
            <option value="CUSTOMER_SERVICE">客服</option>
            <option value="FINANCE">财务</option>
            <option value="PLAYER">陪玩</option>
            <option value="CUSTOMER">客户</option>
          </select>
          <button
            type="button"
            className="mc-btn"
            disabled={exporting || rowsQuery.isPending}
            onClick={() => void exportCsv()}
          >
            <Download size={14} />
            {exporting ? "导出中…" : "导出 CSV"}
          </button>
        </div>
        {downloadMessage ? (
          <p
            className={
              downloadMessage.startsWith("已导出")
                ? "mc-muted-text"
                : "mc-form-error"
            }
          >
            {downloadMessage}
          </p>
        ) : null}
        <SimpleTable
          loading={rowsQuery.isPending}
          errorMessage={
            rowsQuery.error instanceof Error
              ? rowsQuery.error.message
              : null
          }
          headers={["时间", "动作", "摘要", "操作者", "资源"]}
          rows={rows}
          empty={<>没有符合条件的审计记录。</>}
          renderRow={(row) => (
            <>
              <td>{new Date(row.createdAt).toLocaleString()}</td>
              <td className="mc-mono">{row.action}</td>
              <td>{row.summary ?? "-"}</td>
              <td>{row.actorType ?? "-"}</td>
              <td>
                {row.resourceType ?? "-"}
                {row.resourceId ? `:${row.resourceId.slice(0, 8)}` : ""}
              </td>
            </>
          )}
        />
        <div className="mc-table-foot">
          <button
            type="button"
            className="mc-btn mc-btn-small"
            disabled={offset === 0}
            onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}
          >
            上一页
          </button>
          <button
            type="button"
            className="mc-btn mc-btn-small"
            disabled={!hasMore}
            onClick={() => setOffset((value) => value + PAGE_SIZE)}
          >
            下一页
          </button>
        </div>
      </section>
    </div>
  );
}

function PageHead({
  kicker,
  title,
  description,
}: {
  kicker: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mc-pagehead">
      <div>
        <div className="mc-kicker">{kicker}</div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      <span className="mc-chip">真实接口</span>
    </div>
  );
}

function SimpleTable<T>({
  loading,
  errorMessage,
  headers,
  rows,
  empty,
  renderRow,
}: {
  loading: boolean;
  errorMessage: string | null;
  headers: string[];
  rows: T[];
  empty: ReactNode;
  renderRow: (row: T) => ReactNode;
}) {
  return (
    <>
      {loading ? <p className="mc-loading-text">加载中…</p> : null}
      {errorMessage ? <p className="mc-form-error">{errorMessage}</p> : null}
      {!loading && !errorMessage && rows.length === 0 ? (
        <div className="mc-empty">
          <p>{empty}</p>
        </div>
      ) : null}
      {!loading && rows.length > 0 ? (
        <div className="mc-table-wrap">
          <table>
            <thead>
              <tr>
                {headers.map((header) => (
                  <th key={header}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>{rows.map((row, index) => (
              <tr key={index}>{renderRow(row)}</tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

function StatusChip({
  text,
  tone,
}: {
  text: string;
  tone: "pending" | "running" | "done" | "muted" | "dispatch" | "assigned" | "cancelled";
}) {
  return <span className={`mc-status st-${tone}`}>{text}</span>;
}

function SessionStatusChip({ status }: { status: string }) {
  const map: Record<string, { text: string; tone: "pending" | "running" | "done" | "muted" | "assigned" }> = {
    SCHEDULED: { text: "待开始", tone: "assigned" },
    NOT_STARTED: { text: "待开始", tone: "assigned" },
    STARTED: { text: "进行中", tone: "running" },
    ENDED: { text: "已结束", tone: "pending" },
    ADJUSTMENT_PENDING: { text: "调整待复核", tone: "pending" },
    CONFIRMED: { text: "已确认", tone: "done" },
  };
  const meta = map[status];
  return meta ? (
    <StatusChip text={meta.text} tone={meta.tone} />
  ) : (
    <StatusChip text={status} tone="muted" />
  );
}

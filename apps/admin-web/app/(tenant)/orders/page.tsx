"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiFetch } from "../../_lib/api";
import { TenantNav } from "../../_lib/tenant-nav";
import { formatFenYuan as yuan } from "../../_lib/money";

interface Customer { id: string; name: string; mobile: string | null }
interface GameProduct {
  id: string;
  name: string;
  enabled: boolean;
  gameName: string;
  regionName: string | null;
}
interface Pricing { id: string; durationSeconds: number; priceFen: string; playerCostFen: string; enabled: boolean }
interface OrderRow {
  id: string;
  orderNo: string;
  status: string;
  customerName: string;
  createdAt: string;
}
interface OrderView extends OrderRow {
  requirement: {
    description: string;
    gameName: string | null;
    productName: string | null;
    desiredStartAt: string | null;
    durationSeconds: number | null;
    note: string | null;
  } | null;
  snapshot: Array<{ productName: string; unitPriceFen: string; lineTotalFen: string; durationSeconds: number }> | null;
  timeline: Array<{ eventType: string; fromStatus: string | null; toStatus: string | null; occurredAt: string }>;
}

type PageState =
  | { phase: "loading" }
  | { phase: "unauthenticated" }
  | { phase: "error"; message: string }
  | { phase: "ready" };

const STATUS: Record<string, { text: string; cls: string }> = {
  DRAFT: { text: "草稿", cls: "badge badge-inactive" },
  CONFIRMED: { text: "已确认", cls: "badge badge-active" },
  CANCELLED: { text: "已取消", cls: "badge badge-error" }
};

export default function OrdersPage() {
  const [page, setPage] = useState<PageState>({ phase: "loading" });
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<GameProduct[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [customerId, setCustomerId] = useState("");
  const [productId, setProductId] = useState("");
  const [durations, setDurations] = useState<Pricing[]>([]);
  const [durationSeconds, setDurationSeconds] = useState("");
  const [description, setDescription] = useState("");
  const [desiredStart, setDesiredStart] = useState("");
  const [note, setNote] = useState("");

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderView | null>(null);

  const load = useCallback(async () => {
    setPage({ phase: "loading" });
    try {
      const [orders, cust, prods] = await Promise.all([
        apiFetch<OrderRow[]>("/api/v1/tenant/orders"),
        apiFetch<Customer[]>("/api/v1/tenant/customers"),
        apiFetch<GameProduct[]>("/api/v1/tenant/catalog/products")
      ]);
      setRows(orders);
      setCustomers(cust);
      setProducts(prods.filter((p) => p.enabled));
      setPage({ phase: "ready" });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setPage({ phase: "unauthenticated" });
      else setPage({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadDurations = async (pid: string) => {
    setProductId(pid);
    setDurationSeconds("");
    if (!pid) {
      setDurations([]);
      return;
    }
    try {
      const rules = await apiFetch<Pricing[]>(`/api/v1/tenant/catalog/products/${pid}/pricing`);
      setDurations(rules.filter((r) => r.enabled));
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    }
  };

  const create = async () => {
    setBusy(true);
    setMsg(null);
    setOkMsg(null);
    try {
      const order = await apiFetch<OrderRow>("/api/v1/tenant/orders", {
        method: "POST",
        body: JSON.stringify({
          customerProfileId: customerId,
          requirement: {
            description,
            serviceProductId: productId,
            durationSeconds: Number(durationSeconds),
            ...(desiredStart ? { desiredStartAt: new Date(desiredStart).toISOString() } : {}),
            ...(note ? { note } : {})
          }
        })
      });
      setDescription("");
      setNote("");
      setDesiredStart("");
      setDurationSeconds("");
      setOkMsg(`已创建草稿 ${order.orderNo}。`);
      await load();
      await loadDetail(order.id);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const loadDetail = async (id: string) => {
    setDetailId(id);
    setDetail(null);
    setMsg(null);
    try {
      setDetail(await apiFetch<OrderView>(`/api/v1/tenant/orders/${id}`));
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    }
  };

  const transition = async (id: string, action: "confirm" | "cancel") => {
    setBusy(true);
    setMsg(null);
    setOkMsg(null);
    try {
      const init: RequestInit = { method: "POST" };
      if (action === "cancel") init.body = JSON.stringify({ reason: "手动取消" });
      await apiFetch<unknown>(`/api/v1/tenant/orders/${id}/${action}`, init);
      setOkMsg(action === "confirm" ? "订单已确认（价格快照已冻结）。" : "订单已取消。");
      await load();
      await loadDetail(id);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main>
      <TenantNav />
      <div className="page">
        <h1 className="page-title">订单</h1>
        <p className="page-desc">从客户需求创建草稿 → 生成不可变价格快照并确认 → 取消（状态机 409 保护）。</p>
        {msg ? <p className="banner banner-error">{msg}</p> : null}
        {okMsg ? <p className="banner banner-success">{okMsg}</p> : null}
        {page.phase === "unauthenticated" ? (
          <div className="card">
            <p>尚未登录门店账号。</p>
            <Link className="btn btn-primary" href="/store/login">去登录</Link>
          </div>
        ) : null}
        {page.phase === "error" ? <p className="banner banner-error">加载失败：{page.message}</p> : null}
        {page.phase === "ready" ? (
          <>
            <div className="card">
              <h2 className="card-title">新建订单（草稿）</h2>
              <div className="field-row">
                <div className="field">
                  <label>客户</label>
                  <select className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                    <option value="">选择客户…</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}（{c.mobile ?? "无手机"}）
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>服务产品</label>
                  <select className="input" value={productId} onChange={(e) => void loadDurations(e.target.value)}>
                    <option value="">选择产品…</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.gameName} · {p.name}
                        {p.regionName ? `（${p.regionName}）` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>时长</label>
                  <select className="input" value={durationSeconds} onChange={(e) => setDurationSeconds(e.target.value)}>
                    <option value="">选择时长…</option>
                    {durations.map((d) => (
                      <option key={d.id} value={d.durationSeconds}>
                        {Math.floor(d.durationSeconds / 60)} 分钟（{yuan(d.priceFen)}）
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>期望开始（可选）</label>
                  <input className="input" type="datetime-local" value={desiredStart} onChange={(e) => setDesiredStart(e.target.value)} />
                </div>
                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <label>需求描述</label>
                  <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="例如：找陪玩带排位，要求段位钻石以上" />
                </div>
                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <label>备注（可选）</label>
                  <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
              </div>
              <button className="btn btn-primary" disabled={busy || !customerId || !productId || !durationSeconds} onClick={() => void create()}>
                创建草稿
              </button>
            </div>

            <div className="card">
              <h2 className="card-title">订单列表（{rows.length}）</h2>
              {rows.length === 0 ? (
                <p className="muted">暂无订单。</p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>单号</th>
                      <th>客户</th>
                      <th>状态</th>
                      <th>创建时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((o) => {
                      const st = STATUS[o.status] ?? { text: o.status, cls: "badge badge-inactive" };
                      return (
                        <tr key={o.id}>
                          <td>{o.orderNo}</td>
                          <td>{o.customerName}</td>
                          <td>
                            <span className={st.cls}>{st.text}</span>
                          </td>
                          <td className="muted">{new Date(o.createdAt).toLocaleString()}</td>
                          <td>
                            <div className="row-actions">
                              <button className="btn" onClick={() => void loadDetail(o.id)}>详情</button>
                              {o.status === "DRAFT" ? (
                                <>
                                  <button className="btn btn-primary" disabled={busy} onClick={() => void transition(o.id, "confirm")}>确认</button>
                                  <button className="btn" disabled={busy} onClick={() => void transition(o.id, "cancel")}>取消</button>
                                </>
                              ) : null}
                              {o.status === "CONFIRMED" ? (
                                <button className="btn" disabled={busy} onClick={() => void transition(o.id, "cancel")}>取消</button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {detailId && detail ? (
              <div className="card">
                <h2 className="card-title">
                  {detail.orderNo} · 详情
                  <span className="badge badge-info" style={{ marginLeft: 8 }}>
                    {detail.status}
                  </span>
                </h2>
                <p className="muted">客户：{detail.customerName}</p>
                {detail.requirement ? (
                  <>
                    <p className="muted">需求：{detail.requirement.description}</p>
                    <p className="muted">
                      产品：{detail.requirement.productName ?? "未指定"} · 时长{" "}
                      {detail.requirement.durationSeconds ? Math.floor(detail.requirement.durationSeconds / 60) + " 分钟" : "-"}
                    </p>
                  </>
                ) : null}
                {detail.snapshot && detail.snapshot.length > 0 ? (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>产品</th>
                        <th>单价</th>
                        <th>小计</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.snapshot.map((s, i) => (
                        <tr key={i}>
                          <td>{s.productName}</td>
                          <td>{yuan(s.unitPriceFen)}</td>
                          <td>{yuan(s.lineTotalFen)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="muted">尚未生成价格快照（确认后冻结）。</p>
                )}
                <h3 className="card-title" style={{ marginTop: 16 }}>时间线</h3>
                <table className="data-table">
                  <tbody>
                    {detail.timeline.map((e, idx) => (
                      <tr key={idx}>
                        <td>{e.eventType}</td>
                        <td className="muted">
                          {e.fromStatus ?? "-"} → {e.toStatus ?? "-"}
                        </td>
                        <td className="muted">{new Date(e.occurredAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  );
}

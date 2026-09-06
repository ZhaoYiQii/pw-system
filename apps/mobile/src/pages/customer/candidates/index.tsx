import { Button, Input, Text, View } from "@tarojs/components";
import { useLoad } from "@tarojs/taro";
import { useState } from "react";
import { identityAdapter } from "@platform-identity";
import { session } from "@platform-session";
import { tenantLocator } from "@platform-locator";
import "./index.css";

interface OrderRow {
  id: string;
  orderNo: string;
  status: string;
  customerName: string;
}
interface Candidate {
  id: string;
  playerName: string;
  status: string;
  playerNote: string | null;
}

function base(): string {
  const cfg =
    typeof process !== "undefined" ? process.env?.TARO_APP_API_BASE : undefined;
  if (cfg) return cfg;
  if (typeof location !== "undefined") return location.origin;
  return "";
}

async function api(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message =
      data &&
      typeof data === "object" &&
      "message" in data &&
      typeof (data as { message?: unknown }).message === "string"
        ? (data as { message: string }).message
        : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return (data as { data?: unknown })?.data;
}

export default function CandidatesPage() {
  const [token, setToken] = useState<string | null>(session.getToken());
  const [tenantCode, setTenantCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [openOrder, setOpenOrder] = useState<string | null>(null);
  const [cands, setCands] = useState<Candidate[]>([]);

  const loadOrders = async (t: string) => {
    try {
      const list = (await api(
        "/api/v1/tenant/customer/orders",
        t,
      )) as OrderRow[];
      setOrders(list);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
      session.clearToken();
      setToken(null);
    }
  };

  useLoad(async () => {
    const t = session.getToken();
    setToken(t);
    if (t) await loadOrders(t);
    const info = await tenantLocator.resolveTenant();
    if (info.state === "ok" && info.tenant?.code)
      setTenantCode(info.tenant.code);
  });

  const login = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const loginInput: {
        kind: "tenant";
        username: string;
        password: string;
        tenantCode?: string;
      } = { kind: "tenant", username, password };
      if (tenantCode) loginInput.tenantCode = tenantCode;
      const s = await identityAdapter.login(loginInput);
      session.setToken(s.accessToken);
      setToken(s.accessToken);
      setPassword("");
      await loadOrders(s.accessToken);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const open = async (orderId: string) => {
    if (!token) return;
    setOpenOrder(orderId);
    setMsg(null);
    try {
      const list = (await api(
        `/api/v1/tenant/customer/orders/${orderId}/applications`,
        token,
      )) as Candidate[];
      setCands(
        list.filter(
          (c) => c.status === "APPLIED" || c.status === "SHORTLISTED",
        ),
      );
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    }
  };

  const select = async (orderId: string, appId: string) => {
    if (!token) return;
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/v1/tenant/customer/orders/${orderId}/assignment`, token, {
        method: "POST",
        body: JSON.stringify({ applicationId: appId }),
      });
      setMsg("已选定陪玩，其余报名自动过期。");
      await loadOrders(token);
      setOpenOrder(null);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="page">
      <Text className="title">选择陪玩</Text>
      {token === null ? (
        <View className="card">
          <Text className="label">门店 code</Text>
          <Input
            className="input"
            value={tenantCode}
            onInput={(e) => setTenantCode(e.detail.value)}
            placeholder="demo"
          />
          <Text className="label">账号（客户/老板）</Text>
          <Input
            className="input"
            value={username}
            onInput={(e) => setUsername(e.detail.value)}
            placeholder="customer"
          />
          <Text className="label">密码</Text>
          <Input
            className="input"
            password
            value={password}
            onInput={(e) => setPassword(e.detail.value)}
            placeholder="••••"
          />
          <Button className="btn" disabled={busy} onClick={() => void login()}>
            登录并查看我的订单
          </Button>
          {msg ? <Text className="err">{msg}</Text> : null}
        </View>
      ) : (
        <>
          {msg ? <Text className="err">{msg}</Text> : null}
          {orders.length === 0 ? (
            <Text className="muted">
              暂无订单（可由商家端为你创建并确认/发布）
            </Text>
          ) : null}
          {orders.map((o) => (
            <View key={o.id} className="card">
              <View className="row">
                <Text className="strong">{o.orderNo}</Text>
                <Text className="badge open">
                  {o.status === "DISPATCHING" ? "正在选人" : o.status}
                </Text>
              </View>
              {o.status === "DISPATCHING" ? (
                <>
                  {openOrder === o.id ? (
                    cands.length === 0 ? (
                      <Text className="muted">暂无候选</Text>
                    ) : null
                  ) : null}
                  {openOrder === o.id
                    ? cands.map((c) => (
                        <View key={c.id} className="row">
                          <View>
                            <Text className="label">{c.playerName}</Text>
                            {c.playerNote ? (
                              <Text className="muted">（{c.playerNote}）</Text>
                            ) : null}
                          </View>
                          <Button
                            size="mini"
                            disabled={busy}
                            onClick={() => void select(o.id, c.id)}
                          >
                            选 TA
                          </Button>
                        </View>
                      ))
                    : null}
                  {openOrder !== o.id ? (
                    <Button className="btn" onClick={() => void open(o.id)}>
                      查看候选并选人
                    </Button>
                  ) : null}
                </>
              ) : null}
            </View>
          ))}
        </>
      )}
    </View>
  );
}

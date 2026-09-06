import { Button, Input, Text, View } from "@tarojs/components";
import { useLoad } from "@tarojs/taro";
import { useState } from "react";
import { identityAdapter } from "@platform-identity";
import { session } from "@platform-session";
import { tenantLocator } from "@platform-locator";
import { apiAdapter } from "@platform-api";
import { formatFenYuan } from "../../../features/money/money";
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

interface CatalogProduct {
  id: string;
  name: string;
  gameName: string;
  regionName: string | null;
  description: string | null;
}

interface CatalogRule {
  id: string;
  serviceProductId: string;
  durationSeconds: number;
  priceFen: string;
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
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [rules, setRules] = useState<CatalogRule[]>([]);
  const [newProductId, setNewProductId] = useState("");
  const [newDuration, setNewDuration] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [selfEnabled, setSelfEnabled] = useState(true);
  const [disputeOrderId, setDisputeOrderId] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState("");

  const loadOrders = async (t: string) => {
    try {
      const list = await apiAdapter.request<OrderRow[]>(
        "/api/v1/tenant/customer/orders",
        { token: t },
      );
      setOrders(list);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
      session.clearToken();
      setToken(null);
    }
  };

  const loadCatalog = async (t: string) => {
    try {
      const data = await apiAdapter.request<{
        products: CatalogProduct[];
        rules: CatalogRule[];
      }>("/api/v1/tenant/customer/catalog", { token: t });
      setProducts(data.products);
      setRules(data.rules);
    } catch {
      setProducts([]);
      setRules([]);
    }
  };

  const loadFeatureGate = async (t: string) => {
    try {
      const feats = await apiAdapter.request<
        Array<{ featureKey: string; enabled: boolean }>
      >("/api/v1/tenant/features", { token: t });
      const enabled = feats.find(
        (f) => f.featureKey === "addon.customer_self_service",
      )?.enabled;
      setSelfEnabled(enabled !== false);
      if (enabled === false)
        setMsg("该门店未开通客户自助服务，无法自助下单/选人。");
    } catch {
      setSelfEnabled(true);
    }
  };

  const createOrder = async () => {
    if (!token) return;
    if (!newProductId || !newDuration || !newDescription.trim()) {
      setMsg("请选择产品/时长并填写需求描述");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await apiAdapter.request("/api/v1/tenant/customer/orders", {
        method: "POST",
        token,
        body: {
          requirement: {
            description: newDescription.trim(),
            serviceProductId: newProductId,
            durationSeconds: Number(newDuration),
          },
        },
      });
      setMsg("已创建订单草稿，等待门店确认与派单。");
      setNewDescription("");
      await loadOrders(token);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  useLoad(async () => {
    const t = session.getToken();
    setToken(t);
    if (t) {
      await loadOrders(t);
      await loadFeatureGate(t);
    }
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
      await loadCatalog(s.accessToken);
      await loadFeatureGate(s.accessToken);
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
      const list = await apiAdapter.request<Candidate[]>(
        `/api/v1/tenant/customer/orders/${orderId}/applications`,
        { token },
      );
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
      await apiAdapter.request(
        `/api/v1/tenant/customer/orders/${orderId}/assignment`,
        { method: "POST", token, body: { applicationId: appId } },
      );
      setMsg("已选定陪玩，其余报名自动过期。");
      await loadOrders(token);
      setOpenOrder(null);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const confirmComplete = async (orderId: string) => {
    if (!token) return;
    setBusy(true);
    setMsg(null);
    try {
      await apiAdapter.request(
        `/api/v1/tenant/customer/orders/${orderId}/complete`,
        { method: "POST", token },
      );
      setMsg("已确认完成，收入已核算。");
      await loadOrders(token);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const openDispute = async (orderId: string) => {
    if (!token || !disputeReason.trim()) {
      setMsg("请填写投诉原因");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await apiAdapter.request(`/api/v1/tenant/orders/${orderId}/disputes`, {
        method: "POST",
        token,
        body: { reason: disputeReason.trim() },
      });
      setMsg("投诉已提交，门店/平台将处理。");
      setDisputeOrderId(null);
      setDisputeReason("");
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
          {selfEnabled && products.length > 0 ? (
            <View className="card">
              <Text className="strong">自助下单</Text>
              <Text className="label">选择服务产品</Text>
              {products.map((p) => (
                <Button
                  key={p.id}
                  size="mini"
                  onClick={() => {
                    setNewProductId(p.id);
                    setNewDuration("");
                  }}
                >
                  {p.gameName} · {p.name}
                  {p.regionName ? `（${p.regionName}）` : ""}
                </Button>
              ))}
              {newProductId ? (
                <>
                  <Text className="label">时长</Text>
                  {rules
                    .filter((r) => r.serviceProductId === newProductId)
                    .map((r) => (
                      <Button
                        key={r.id}
                        size="mini"
                        onClick={() =>
                          setNewDuration(String(r.durationSeconds))
                        }
                      >
                        {Math.floor(r.durationSeconds / 60)} 分钟 ·{" "}
                        {formatFenYuan(r.priceFen)}
                      </Button>
                    ))}
                  <Text className="label">需求描述</Text>
                  <Input
                    className="input"
                    value={newDescription}
                    onInput={(e) => setNewDescription(e.detail.value)}
                    placeholder="例如：钻石以上双排两小时"
                  />
                  <Button
                    className="btn primary"
                    disabled={busy || !newDuration}
                    onClick={() => void createOrder()}
                  >
                    提交订单
                  </Button>
                </>
              ) : null}
            </View>
          ) : null}
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
              {o.status === "PENDING_CONFIRMATION" ? (
                <View className="row">
                  <Text className="muted">
                    服务已结束，请确认完成（超时将由门店自动确认）。
                  </Text>
                  <Button
                    className="btn primary"
                    disabled={busy}
                    onClick={() => void confirmComplete(o.id)}
                  >
                    确认完成
                  </Button>
                </View>
              ) : null}
              {o.status === "COMPLETED" ||
              o.status === "PENDING_CONFIRMATION" ? (
                <View className="row">
                  {disputeOrderId === o.id ? (
                    <>
                      <Input
                        className="input"
                        value={disputeReason}
                        onInput={(e) => setDisputeReason(e.detail.value)}
                        placeholder="投诉原因"
                      />
                      <Button
                        size="mini"
                        disabled={busy}
                        onClick={() => void openDispute(o.id)}
                      >
                        提交
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="mini"
                      onClick={() => {
                        setDisputeOrderId(o.id);
                        setDisputeReason("");
                      }}
                    >
                      投诉
                    </Button>
                  )}
                </View>
              ) : null}
            </View>
          ))}
        </>
      )}
    </View>
  );
}

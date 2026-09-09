import { Button, Text, View } from "@tarojs/components";
import { useLoad, useRouter } from "@tarojs/taro";
import { useState } from "react";
import { apiAdapter } from "@platform-api";
import { session } from "@platform-session";
import {
  CustomerLoginCard,
  CustomerMessage,
  CustomerShell,
  goCustomer,
} from "../../../components/customer-ui";
import {
  customerLogin,
  resolveTenantCode,
} from "../../../features/customer-ui/session";

interface Candidate {
  id: string;
  playerName: string;
  status: string;
  playerNote: string | null;
}

interface OrderOption {
  id: string;
  orderNo: string;
  status: string;
}

export default function CustomerCandidatesPage() {
  const router = useRouter();
  const initialOrderId = String(router.params.orderId ?? "");
  const [token, setToken] = useState<string | null>(session.getToken());
  const [tenantCode, setTenantCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [orderId, setOrderId] = useState(initialOrderId);
  const [dispatchingOrders, setDispatchingOrders] = useState<OrderOption[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState<{
    tone: "error" | "success" | "info";
    text: string;
  } | null>(null);

  const loadOrderList = async (accessToken: string) => {
    try {
      const all = await apiAdapter.request<OrderOption[]>(
        "/api/v1/tenant/customer/orders",
        { token: accessToken },
      );
      const dispatching = all.filter((order) => order.status === "DISPATCHING");
      setDispatchingOrders(dispatching);
      if (!orderId && dispatching.length > 0)
        setOrderId(dispatching[0]?.id ?? "");
      return dispatching;
    } catch (error) {
      setMsg({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
      session.clearToken();
      setToken(null);
      return [];
    }
  };

  const loadCandidates = async (accessToken: string, targetOrderId: string) => {
    setMsg(null);
    try {
      const data = await apiAdapter.request<Candidate[]>(
        `/api/v1/tenant/customer/orders/${targetOrderId}/applications`,
        { token: accessToken },
      );
      setCandidates(
        data.filter(
          (candidate) =>
            candidate.status === "APPLIED" ||
            candidate.status === "SHORTLISTED",
        ),
      );
    } catch (error) {
      setMsg({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    }
  };

  useLoad(async () => {
    const accessToken = session.getToken();
    setToken(accessToken);
    if (accessToken) {
      const dispatching = await loadOrderList(accessToken);
      const target = orderId || dispatching[0]?.id;
      if (target) await loadCandidates(accessToken, target);
    }
    const code = await resolveTenantCode();
    if (code) setTenantCode(code);
    setLoaded(true);
  });

  const login = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const accessToken = await customerLogin(tenantCode, username, password);
      setToken(accessToken);
      setPassword("");
      const dispatching = await loadOrderList(accessToken);
      const target = orderId || dispatching[0]?.id;
      if (target) await loadCandidates(accessToken, target);
    } catch (error) {
      setMsg({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
      setLoaded(true);
    }
  };

  const chooseOrder = async (id: string) => {
    if (!token) return;
    setOrderId(id);
    await loadCandidates(token, id);
  };

  const selectCandidate = async (applicationId: string) => {
    if (!token || !orderId) return;
    setBusy(true);
    setMsg(null);
    try {
      await apiAdapter.request(
        `/api/v1/tenant/customer/orders/${orderId}/assignment`,
        { method: "POST", token, body: { applicationId } },
      );
      setMsg({ tone: "success", text: "已选定陪玩，其余报名自动过期。" });
      await loadCandidates(token, orderId);
    } catch (error) {
      setMsg({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <CustomerShell title="选择陪玩" subtitle="我的待选订单" active="home">
      {!token ? (
        <CustomerLoginCard
          tenantCode={tenantCode}
          username={username}
          password={password}
          busy={busy}
          actionLabel="登录并查看候选"
          onTenantCode={setTenantCode}
          onUsername={setUsername}
          onPassword={setPassword}
          onLogin={() => void login()}
        />
      ) : null}
      {msg ? (
        <CustomerMessage tone={msg.tone}>{msg.text}</CustomerMessage>
      ) : null}
      {token && !loaded ? (
        <View className="cu-loading">正在加载候选…</View>
      ) : null}
      {token && loaded ? (
        <>
          {dispatchingOrders.length > 0 ? (
            <View className="cu-tabs">
              {dispatchingOrders.map((order) => (
                <Button
                  key={order.id}
                  className={`cu-tab${orderId === order.id ? " is-active" : ""}`}
                  onClick={() => void chooseOrder(order.id)}
                >
                  {order.orderNo}
                </Button>
              ))}
            </View>
          ) : null}
          {candidates.length === 0 ? (
            <View className="cu-empty">
              当前订单暂无候选陪玩。等待陪玩报名后这里会显示人选。
              <Button
                className="cu-button cu-button-outline cu-button-small cu-button-full"
                style={{ marginTop: 24 }}
                onClick={() => goCustomer("/pages/customer/orders/index")}
              >
                返回我的订单
              </Button>
            </View>
          ) : null}
          {candidates.map((candidate) => (
            <View className="cu-card" key={candidate.id}>
              <View className="cu-person">
                <View className="cu-avatar">
                  {candidate.playerName.slice(0, 1)}
                </View>
                <View className="cu-grow">
                  <Text className="cu-card-title">{candidate.playerName}</Text>
                  {candidate.playerNote ? (
                    <Text className="cu-meta">{candidate.playerNote}</Text>
                  ) : null}
                </View>
                <Button
                  className="cu-button cu-button-small cu-button-outline"
                  disabled={busy}
                  onClick={() => void selectCandidate(candidate.id)}
                >
                  选 TA
                </Button>
              </View>
            </View>
          ))}
        </>
      ) : null}
    </CustomerShell>
  );
}

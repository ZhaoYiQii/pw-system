import { Button, Text, Textarea, View } from "@tarojs/components";
import { useLoad, useRouter } from "@tarojs/taro";
import { useState } from "react";
import { apiAdapter } from "@platform-api";
import { session } from "@platform-session";
import {
  CustomerLoginCard,
  CustomerMessage,
  CustomerShell,
} from "../../../components/customer-ui";
import {
  customerLogin,
  resolveTenantCode,
} from "../../../features/customer-ui/session";

interface OrderOption {
  id: string;
  orderNo: string;
  status: string;
  createdAt: string;
}

export default function CustomerDisputeCreatePage() {
  const router = useRouter();
  const preselect = String(router.params.orderId ?? "");
  const [token, setToken] = useState<string | null>(session.getToken());
  const [tenantCode, setTenantCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [orderId, setOrderId] = useState(preselect);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{
    tone: "error" | "success" | "info";
    text: string;
  } | null>(null);

  const loadOrders = async (accessToken: string) => {
    setMsg(null);
    try {
      const all = await apiAdapter.request<OrderOption[]>(
        "/api/v1/tenant/customer/orders",
        { token: accessToken },
      );
      const candidates = all.filter(
        (order) =>
          order.status === "COMPLETED" ||
          order.status === "PENDING_CONFIRMATION",
      );
      setOrders(candidates);
      const preselected = candidates.find((order) => order.id === preselect);
      if (!preselected && candidates.length > 0)
        setOrderId(candidates[0]?.id ?? "");
    } catch (error) {
      setMsg({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
      session.clearToken();
      setToken(null);
    }
  };

  useLoad(async () => {
    const accessToken = session.getToken();
    setToken(accessToken);
    if (accessToken) await loadOrders(accessToken);
    const code = await resolveTenantCode();
    if (code) setTenantCode(code);
  });

  const login = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const accessToken = await customerLogin(tenantCode, username, password);
      setToken(accessToken);
      setPassword("");
      await loadOrders(accessToken);
    } catch (error) {
      setMsg({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!token || !orderId) {
      setMsg({ tone: "error", text: "请选择已结束/待确认的订单" });
      return;
    }
    if (!reason.trim()) {
      setMsg({ tone: "error", text: "请填写争议原因" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await apiAdapter.request(`/api/v1/tenant/orders/${orderId}/disputes`, {
        method: "POST",
        token,
        body: { reason: reason.trim() },
      });
      setReason("");
      setMsg({
        tone: "success",
        text: "争议已提交，门店与平台可见；争议期间关联结算会被冻结。",
      });
    } catch (error) {
      setMsg({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    token !== null && orderId !== "" && reason.trim() !== "" && !busy;

  return (
    <CustomerShell
      title="发起争议"
      subtitle="限已结束或待确认的订单"
      active="profile"
    >
      {!token ? (
        <CustomerLoginCard
          tenantCode={tenantCode}
          username={username}
          password={password}
          busy={busy}
          actionLabel="登录并发起争议"
          onTenantCode={setTenantCode}
          onUsername={setUsername}
          onPassword={setPassword}
          onLogin={() => void login()}
        />
      ) : null}
      {msg ? (
        <CustomerMessage tone={msg.tone}>{msg.text}</CustomerMessage>
      ) : null}
      {token ? (
        <>
          <View className="cu-card">
            <Text className="cu-card-title">选择订单</Text>
            {orders.length === 0 ? (
              <View className="cu-empty">
                暂无可发起争议的订单。订单完成或进入待确认后才可发起。
              </View>
            ) : null}
            <View className="cu-tabs" style={{ marginTop: "20px" }}>
              {orders.map((order) => (
                <Button
                  key={order.id}
                  className={`cu-tab${orderId === order.id ? " is-active" : ""}`}
                  onClick={() => setOrderId(order.id)}
                >
                  {order.orderNo}
                </Button>
              ))}
            </View>
          </View>
          <View className="cu-card">
            <Text className="cu-card-title">争议原因</Text>
            <Textarea
              className="cu-textarea"
              name="disputeReason"
              aria-label="争议原因"
              value={reason}
              onInput={(event) => setReason(event.detail.value)}
              placeholder="说明实际情况，例如：实际服务时长与结束时间不一致、陪玩提前离开…"
            />
            <Text className="cu-meta">
              如有时长或扣费疑问，建议附上服务端时间截图。
            </Text>
          </View>
          <Button
            className={`cu-button cu-button-primary cu-button-full${canSubmit ? "" : " is-disabled"}`}
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {busy ? "提交中…" : "提交争议"}
          </Button>
        </>
      ) : null}
    </CustomerShell>
  );
}

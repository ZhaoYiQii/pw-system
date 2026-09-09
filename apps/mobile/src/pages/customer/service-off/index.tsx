import { Button, Text, View } from "@tarojs/components";
import { useLoad } from "@tarojs/taro";
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

export default function CustomerServiceOffPage() {
  const [token, setToken] = useState<string | null>(session.getToken());
  const [tenantCode, setTenantCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState<{
    tone: "error" | "success" | "info";
    text: string;
  } | null>(null);

  const loadFeature = async (accessToken: string) => {
    setMsg(null);
    try {
      const features = await apiAdapter.request<
        Array<{ featureKey: string; enabled: boolean }>
      >("/api/v1/tenant/features", { token: accessToken });
      const feature = features.find(
        (item) => item.featureKey === "addon.customer_self_service",
      );
      setEnabled(feature ? feature.enabled : false);
    } catch (error) {
      setMsg({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
      session.clearToken();
      setToken(null);
    } finally {
      setLoaded(true);
    }
  };

  useLoad(async () => {
    const accessToken = session.getToken();
    setToken(accessToken);
    if (accessToken) await loadFeature(accessToken);
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
      await loadFeature(accessToken);
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
    <CustomerShell title="自助下单" subtitle="服务开关状态" active="order">
      {!token ? (
        <CustomerLoginCard
          tenantCode={tenantCode}
          username={username}
          password={password}
          busy={busy}
          actionLabel="登录并检查服务状态"
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
        <View className="cu-loading">正在检查服务状态…</View>
      ) : null}
      {token && loaded && enabled === false ? (
        <>
          <View className="cu-empty">
            <View className="cu-empty-mark">OFF</View>
            <Text className="cu-empty-title">自助下单未开通</Text>
            <Text>
              这家门店暂未开启老板自助服务。你可以联系门店客服下单，开通后即可自助下单与选人。
            </Text>
          </View>
          <Button
            className="cu-button cu-button-dark cu-button-full"
            onClick={() => goCustomer("/pages/customer/orders/index")}
          >
            返回我的订单
          </Button>
        </>
      ) : null}
      {token && loaded && enabled !== false ? (
        <View className="cu-card">
          <Text className="cu-card-title">自助下单已开通</Text>
          <Text className="cu-meta">
            该门店已启用老板自助服务，可直接选择服务模板下单。
          </Text>
          <Button
            className="cu-button cu-button-primary cu-button-full"
            onClick={() => goCustomer("/pages/customer/game-order/index")}
          >
            去下单
          </Button>
        </View>
      ) : null}
    </CustomerShell>
  );
}

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
  StatusPill,
} from "../../../components/customer-ui";
import {
  customerLogin,
  resolveTenantCode,
} from "../../../features/customer-ui/session";

interface AppView {
  id: string;
  playerName: string;
  status: string;
}

interface LineView {
  id: string;
  positionLabel: string;
  requiredCount: number;
  applications: AppView[];
}

interface SelectView {
  orderId: string;
  dispatchNo: string;
  status: string;
  lines: LineView[];
}

export default function GameSelectPage() {
  const router = useRouter();
  const orderId = String(router.params.orderId ?? "");
  const tenant = String(router.params.tenant ?? "");
  const [token, setToken] = useState<string | null>(session.getToken());
  const [tenantCode, setTenantCode] = useState(tenant);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<SelectView | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{
    tone: "error" | "success" | "info";
    text: string;
  } | null>(null);

  const load = async (accessToken: string) => {
    setMsg(null);
    try {
      const data = await apiAdapter.request<SelectView>(
        `/api/v1/tenant/game-dispatch/customer/orders/${orderId}/select`,
        { token: accessToken },
      );
      setView(data);
      setPicked({});
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
    if (accessToken && orderId) await load(accessToken);
    const code = tenant || (await resolveTenantCode());
    if (code) setTenantCode(code);
  });

  const login = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const accessToken = await customerLogin(tenantCode, username, password);
      setToken(accessToken);
      setPassword("");
      if (orderId) await load(accessToken);
    } catch (error) {
      setMsg({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const toggle = (lineId: string, appId: string) => {
    setPicked((prev) => ({
      ...prev,
      [lineId]: prev[lineId] === appId ? "" : appId,
    }));
  };

  const confirm = async () => {
    if (!token || !orderId) return;
    const ids = Object.values(picked).filter(Boolean);
    if (ids.length === 0) {
      setMsg({ tone: "error", text: "请先为需要的位置选择陪玩" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const data = await apiAdapter.request<SelectView>(
        `/api/v1/tenant/game-dispatch/customer/orders/${orderId}/assignment`,
        { method: "POST", token, body: { applicationIds: ids } },
      );
      setView(data);
      setMsg({ tone: "success", text: "已确认所选陪玩。" });
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
    <CustomerShell
      title="选择陪玩"
      subtitle={view?.dispatchNo ? `派单 ${view.dispatchNo}` : "等待门店推送"}
      active="order"
    >
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
      {token && orderId && !view && !busy ? (
        <View className="cu-loading">正在加载可选陪玩…</View>
      ) : null}
      {token && !orderId ? (
        <View className="cu-empty">
          缺少订单编号。请从门店推送的链接或我的订单进入。
        </View>
      ) : null}
      {token && view ? (
        <>
          {view.status === "DISPATCHING" ? (
            <View className="cu-row">
              <StatusPill wait>正在选人</StatusPill>
            </View>
          ) : (
            <View className="cu-card">
              <Text className="cu-meta">
                当前订单状态：{view.status}；仅“正在选人”阶段可操作。
              </Text>
            </View>
          )}
          {view.lines.map((line) => (
            <View className="cu-card" key={line.id}>
              <View className="cu-row cu-row-first">
                <Text className="cu-card-title">
                  {line.positionLabel} · 需 {line.requiredCount} 人
                </Text>
                <StatusPill
                  wait={!picked[line.id] && view.status === "DISPATCHING"}
                >
                  {picked[line.id] ? "已选" : "待选"}
                </StatusPill>
              </View>
              {line.applications.filter((app) => app.status === "APPLIED")
                .length === 0 ? (
                <View className="cu-empty">该位置暂无报名。</View>
              ) : null}
              {line.applications
                .filter((app) => app.status === "APPLIED")
                .map((app) => (
                  <View className="cu-person" key={app.id}>
                    <View className="cu-avatar">
                      {app.playerName.slice(0, 1)}
                    </View>
                    <View className="cu-grow">
                      <Text className="cu-card-title">{app.playerName}</Text>
                    </View>
                    <Button
                      className={`cu-button cu-button-small ${picked[line.id] === app.id ? "cu-button-soft" : "cu-button-outline"}`}
                      disabled={view.status !== "DISPATCHING" || busy}
                      onClick={() => toggle(line.id, app.id)}
                    >
                      {picked[line.id] === app.id ? "已选" : "选择"}
                    </Button>
                  </View>
                ))}
            </View>
          ))}
          {view.status === "DISPATCHING" ? (
            <Button
              className={`cu-button cu-button-primary cu-button-full${Object.values(picked).filter(Boolean).length === 0 || busy ? " is-disabled" : ""}`}
              disabled={
                Object.values(picked).filter(Boolean).length === 0 || busy
              }
              onClick={() => void confirm()}
            >
              {busy ? "确认中…" : "确认陪玩"}
            </Button>
          ) : null}
          <Button
            className="cu-button cu-button-outline cu-button-small cu-button-full"
            style={{ marginTop: 18 }}
            onClick={() => goCustomer("/pages/customer/orders/index")}
          >
            返回我的订单
          </Button>
        </>
      ) : null}
    </CustomerShell>
  );
}

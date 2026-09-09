import { Text, View } from "@tarojs/components";
import { useLoad } from "@tarojs/taro";
import { useState } from "react";
import { identityAdapter } from "@platform-identity";
import { session } from "@platform-session";
import { tenantLocator } from "@platform-locator";
import { apiAdapter } from "@platform-api";
import {
  PlayerLoginCard,
  PlayerMessage,
  PlayerPage,
} from "../../../components/player-ui";
import "./index.css";

interface DisputeRow {
  id: string;
  orderNo: string;
  status: "OPEN" | "RESOLVED";
  reason: string;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function PlayerDisputesPage() {
  const [token, setToken] = useState<string | null>(session.getToken());
  const [tenantCode, setTenantCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [rows, setRows] = useState<DisputeRow[]>([]);

  const load = async (accessToken: string) => {
    try {
      setRows(
        await apiAdapter.request<DisputeRow[]>(
          "/api/v1/tenant/player/disputes",
          { token: accessToken },
        ),
      );
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
      session.clearToken();
      setToken(null);
    }
  };

  useLoad(async () => {
    const accessToken = session.getToken();
    setToken(accessToken);
    if (accessToken) await load(accessToken);
    const info = await tenantLocator.resolveTenant();
    if (info.state === "ok" && info.tenant?.code)
      setTenantCode(info.tenant.code);
  });

  const login = async () => {
    setMsg(null);
    try {
      const input: {
        kind: "tenant";
        username: string;
        password: string;
        tenantCode?: string;
      } = { kind: "tenant", username, password };
      if (tenantCode) input.tenantCode = tenantCode;
      const loginSession = await identityAdapter.login(input);
      session.setToken(loginSession.accessToken);
      setToken(loginSession.accessToken);
      setPassword("");
      await load(loginSession.accessToken);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    }
  };

  const openCount = rows.filter((row) => row.status === "OPEN").length;

  return (
    <PlayerPage
      title="我的争议"
      subtitle="查看反馈与门店处理进度"
      activeNav="profile"
      badge={
        token ? (
          <Text
            className={`pw-badge ${openCount ? "pw-badge-wait" : "pw-badge-live"}`}
          >
            {openCount ? `${openCount} 条处理中` : "暂无待处理"}
          </Text>
        ) : undefined
      }
    >
      {!token ? (
        <PlayerLoginCard
          tenantCode={tenantCode}
          username={username}
          password={password}
          actionLabel="登录并查看争议"
          onTenantCode={setTenantCode}
          onUsername={setUsername}
          onPassword={setPassword}
          onLogin={() => void login()}
        />
      ) : null}
      {msg ? <PlayerMessage>{msg}</PlayerMessage> : null}
      {token && rows.length === 0 ? (
        <Text className="pw-empty">
          没有争议记录。争议仅用于反馈真实订单异常。
        </Text>
      ) : null}
      {token
        ? rows.map((item) => (
            <View key={item.id} className="pw-card dispute-card">
              <View className="pw-row-between">
                <Text className="pw-card-title">订单 {item.orderNo}</Text>
                <Text
                  className={`pw-badge ${item.status === "OPEN" ? "pw-badge-wait" : "pw-badge-live"}`}
                >
                  {item.status === "OPEN" ? "处理中" : "已处理"}
                </Text>
              </View>
              <View className="dispute-detail">
                <Text className="pw-section-label">我的反馈</Text>
                <Text className="dispute-copy">{item.reason}</Text>
              </View>
              <View className="dispute-detail">
                <Text className="pw-section-label">处理结果</Text>
                <Text className="dispute-copy">
                  {item.resolution ?? "等待门店处理"}
                </Text>
              </View>
              <Text className="pw-muted">
                更新于 {new Date(item.updatedAt).toLocaleString()}
              </Text>
            </View>
          ))
        : null}
    </PlayerPage>
  );
}

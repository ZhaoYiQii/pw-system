import { Button, Text, View } from "@tarojs/components";
import Taro, { useLoad } from "@tarojs/taro";
import { useState } from "react";
import { identityAdapter } from "@platform-identity";
import { session } from "@platform-session";
import { tenantLocator } from "@platform-locator";
import { apiAdapter } from "@platform-api";
import { formatFenYuan } from "../../../features/money/money";
import {
  PlayerLoginCard,
  PlayerMessage,
  PlayerPage,
} from "../../../components/player-ui";
import "./index.css";

interface PlayerMe {
  id: string;
  name: string;
  intro: string | null;
  mobile: string | null;
  acceptingOrders: boolean;
  availability: Array<{
    id: string;
    startsAt: string;
    endsAt: string;
    reason: string | null;
  }>;
}

interface PlayerFinance {
  pendingFen: string;
  batchedFen: string;
  paidFen: string;
}

export default function PlayerProfilePage() {
  const [token, setToken] = useState<string | null>(session.getToken());
  const [tenantCode, setTenantCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<PlayerMe | null>(null);
  const [finance, setFinance] = useState<PlayerFinance | null>(null);

  const load = async (accessToken: string) => {
    try {
      const [profile, money] = await Promise.all([
        apiAdapter.request<PlayerMe>("/api/v1/tenant/player/me", {
          token: accessToken,
        }),
        apiAdapter.request<PlayerFinance>("/api/v1/tenant/player/finance", {
          token: accessToken,
        }),
      ]);
      setMe(profile);
      setFinance(money);
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
    setBusy(true);
    setMsg(null);
    try {
      const input: {
        kind: "tenant";
        username: string;
        password: string;
        tenantCode?: string;
      } = {
        kind: "tenant",
        username,
        password,
      };
      if (tenantCode) input.tenantCode = tenantCode;
      const loginSession = await identityAdapter.login(input);
      session.setToken(loginSession.accessToken);
      setToken(loginSession.accessToken);
      setPassword("");
      await load(loginSession.accessToken);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const toggleAccepting = async () => {
    if (!token || !me) return;
    setBusy(true);
    setMsg(null);
    try {
      await apiAdapter.request("/api/v1/tenant/player/me", {
        method: "PATCH",
        token,
        body: { acceptingOrders: !me.acceptingOrders },
      });
      await load(token);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const logout = () => {
    session.clearToken();
    setToken(null);
    setMe(null);
    setFinance(null);
    setMsg(null);
  };

  return (
    <PlayerPage
      title={token ? "我的资料" : "陪玩工作台"}
      subtitle={
        token ? "资料、接单状态与工作入口" : "登录后查看门店订单与服务进度"
      }
      activeNav="profile"
      badge={
        me ? (
          <Text
            className={`pw-badge ${me.acceptingOrders ? "pw-badge-live" : ""}`}
          >
            {me.acceptingOrders ? "接单中" : "已暂停"}
          </Text>
        ) : undefined
      }
    >
      {!token ? (
        <>
          <View className="pw-stat-card">
            <Text className="pw-stat-label">陪玩工作台</Text>
            <Text className="profile-welcome">准时接单，清楚结算</Text>
            <Text className="pw-stat-note">
              登录后可报名、管理场次并查看收入
            </Text>
          </View>
          <PlayerLoginCard
            tenantCode={tenantCode}
            username={username}
            password={password}
            busy={busy}
            actionLabel="账号密码登录"
            onTenantCode={setTenantCode}
            onUsername={setUsername}
            onPassword={setPassword}
            onLogin={() => void login()}
          />
        </>
      ) : null}

      {msg ? <PlayerMessage>{msg}</PlayerMessage> : null}

      {token && me ? (
        <>
          <View className="profile-identity">
            <View className="profile-avatar">
              <Text>{me.name.slice(0, 1)}</Text>
            </View>
            <View className="pw-row-copy">
              <Text className="pw-card-title">{me.name}</Text>
              <Text className="pw-muted">
                {me.mobile ? `手机 ${me.mobile}` : "手机号未填写"}
              </Text>
              <View className="profile-tags">
                <Text className="profile-tag">门店陪玩</Text>
                <Text className="profile-tag">
                  {me.acceptingOrders ? "当前可接单" : "暂停接单"}
                </Text>
              </View>
            </View>
          </View>

          <View className="pw-card">
            <Text className="pw-card-title">接单状态</Text>
            <View className="pw-row-between">
              <Text className="pw-muted">暂停后不会收到新的大厅订单</Text>
              <Button
                className="pw-button pw-button-small pw-button-soft"
                disabled={busy}
                onClick={() => void toggleAccepting()}
              >
                {me.acceptingOrders ? "暂停接单" : "恢复接单"}
              </Button>
            </View>
          </View>

          <View className="pw-card pw-divider-list">
            <Button
              className="profile-menu"
              onClick={() =>
                void Taro.reLaunch({ url: "/pages/player/availability/index" })
              }
            >
              <View className="pw-row-copy">
                <Text>接单时间</Text>
                <Text className="pw-muted">
                  {me.availability.length} 个不可接时段
                </Text>
              </View>
              <Text className="profile-chevron">›</Text>
            </Button>
            <Button
              className="profile-menu"
              onClick={() =>
                void Taro.reLaunch({ url: "/pages/player/income/index" })
              }
            >
              <View className="pw-row-copy">
                <Text>收入详情</Text>
                <Text className="pw-muted">
                  {finance
                    ? `待结算 ${formatFenYuan(finance.pendingFen)}`
                    : "查看结算记录"}
                </Text>
              </View>
              <Text className="profile-chevron">›</Text>
            </Button>
            <Button
              className="profile-menu"
              onClick={() =>
                void Taro.reLaunch({ url: "/pages/player/disputes/index" })
              }
            >
              <View className="pw-row-copy">
                <Text>我的争议</Text>
                <Text className="pw-muted">查看处理进度</Text>
              </View>
              <Text className="profile-chevron">›</Text>
            </Button>
            <Button
              className="profile-menu"
              onClick={() =>
                void Taro.reLaunch({ url: "/pages/player/order-hall/index" })
              }
            >
              <View className="pw-row-copy">
                <Text>接单大厅</Text>
                <Text className="pw-muted">查看可报名订单</Text>
              </View>
              <Text className="profile-chevron">›</Text>
            </Button>
          </View>

          <View className="pw-card">
            <Text className="pw-section-label">简介</Text>
            <Text className="pw-muted">{me.intro ?? "还没有填写个人简介"}</Text>
          </View>
          <Button className="pw-button pw-button-plain" onClick={logout}>
            安全退出
          </Button>
        </>
      ) : null}
    </PlayerPage>
  );
}

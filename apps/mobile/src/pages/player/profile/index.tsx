import { Button, Input, Text, View } from "@tarojs/components";
import Taro, { useLoad } from "@tarojs/taro";
import { useState } from "react";
import { identityAdapter } from "@platform-identity";
import { session } from "@platform-session";
import { tenantLocator } from "@platform-locator";
import { apiAdapter } from "@platform-api";
import { formatFenYuan } from "../../../features/money/money";
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

  const load = async (t: string) => {
    try {
      const [profile, money] = await Promise.all([
        apiAdapter.request<PlayerMe>("/api/v1/tenant/player/me", {
          token: t,
        }),
        apiAdapter.request<PlayerFinance>("/api/v1/tenant/player/finance", {
          token: t,
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
    const t = session.getToken();
    setToken(t);
    if (t) await load(t);
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
      } = { kind: "tenant", username, password };
      if (tenantCode) input.tenantCode = tenantCode;
      const s = await identityAdapter.login(input);
      session.setToken(s.accessToken);
      setToken(s.accessToken);
      setPassword("");
      await load(s.accessToken);
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
    <View className="page">
      <Text className="title">我的陪玩资料</Text>
      {token === null ? (
        <View className="card">
          <Text className="label">门店 code</Text>
          <Input
            className="input"
            value={tenantCode}
            onInput={(e) => setTenantCode(e.detail.value)}
            placeholder="demo"
          />
          <Text className="label">账号（陪玩）</Text>
          <Input
            className="input"
            value={username}
            onInput={(e) => setUsername(e.detail.value)}
            placeholder="player"
          />
          <Text className="label">密码</Text>
          <Input
            className="input"
            password
            value={password}
            onInput={(e) => setPassword(e.detail.value)}
            placeholder="••••"
          />
          <Button
            className="btn primary"
            disabled={busy}
            onClick={() => void login()}
          >
            登录并读取资料
          </Button>
          {msg ? <Text className="err">{msg}</Text> : null}
        </View>
      ) : null}
      {token && me ? (
        <View className="card">
          <View className="row">
            <Text className="strong">{me.name}</Text>
            <Text className="badge active">
              {me.acceptingOrders ? "接单中" : "暂停接单"}
            </Text>
          </View>
          <Text className="muted">
            {me.mobile ? `手机 ${me.mobile} · ` : ""}
            {me.intro ?? "暂无简介"}
          </Text>
          <View className="row" style={{ marginTop: 12 }}>
            <Button
              size="mini"
              disabled={busy}
              onClick={() => void toggleAccepting()}
            >
              {me.acceptingOrders ? "暂停接单" : "恢复接单"}
            </Button>
            <Button size="mini" onClick={logout}>
              退出
            </Button>
          </View>
          {finance ? (
            <View className="card" style={{ marginTop: 12 }}>
              <Text className="strong">收入</Text>
              <Text className="muted">
                待结算 {formatFenYuan(finance.pendingFen)} · 已入批{" "}
                {formatFenYuan(finance.batchedFen)} · 已打款{" "}
                {formatFenYuan(finance.paidFen)}
              </Text>
              <Button
                size="mini"
                onClick={() =>
                  void Taro.reLaunch({ url: "/pages/player/income/index" })
                }
              >
                收入详情
              </Button>
            </View>
          ) : null}
          {msg ? <Text className="err">{msg}</Text> : null}
        </View>
      ) : null}
      <View className="row-actions">
        <Button
          className="btn"
          onClick={() =>
            void Taro.reLaunch({ url: "/pages/player/disputes/index" })
          }
        >
          争议记录
        </Button>
        <Button
          className="btn"
          onClick={() =>
            void Taro.reLaunch({ url: "/pages/player/availability/index" })
          }
        >
          维护接单时间
        </Button>
        <Button
          className="btn"
          onClick={() =>
            void Taro.reLaunch({ url: "/pages/player/order-hall/index" })
          }
        >
          接单大厅
        </Button>
        <Button
          className="btn"
          onClick={() => void Taro.reLaunch({ url: "/pages/index/index" })}
        >
          回首页
        </Button>
      </View>
    </View>
  );
}

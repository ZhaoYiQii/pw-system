import { Button, Input, Text, View } from "@tarojs/components";
import Taro, { useLoad } from "@tarojs/taro";
import { useState } from "react";
import { identityAdapter } from "@platform-identity";
import { session } from "@platform-session";
import { tenantLocator } from "@platform-locator";
import { apiAdapter } from "@platform-api";
import "./index.css";

interface PlayerMe {
  availability: Array<{
    id: string;
    startsAt: string;
    endsAt: string;
    reason: string | null;
  }>;
}

export default function PlayerAvailabilityPage() {
  const [token, setToken] = useState<string | null>(session.getToken());
  const [tenantCode, setTenantCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<PlayerMe | null>(null);

  const load = async (t: string) => {
    try {
      const profile = await apiAdapter.request<PlayerMe>(
        "/api/v1/tenant/player/me",
        {
          token: t,
        },
      );
      setMe(profile);
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

  const add = async () => {
    if (!token) return;
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (
      !startsAt ||
      !endsAt ||
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime())
    ) {
      setMsg("请填写合法开始/结束时间");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await apiAdapter.request("/api/v1/tenant/player/availability", {
        method: "POST",
        token,
        body: {
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
          ...(reason ? { reason } : {}),
        },
      });
      setStartsAt("");
      setEndsAt("");
      setReason("");
      await load(token);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (availabilityId: string) => {
    if (!token) return;
    setBusy(true);
    setMsg(null);
    try {
      await apiAdapter.request(
        `/api/v1/tenant/player/availability/${availabilityId}`,
        { method: "DELETE", token },
      );
      await load(token);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="page">
      <Text className="title">接单时间</Text>
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
            登录
          </Button>
          {msg ? <Text className="err">{msg}</Text> : null}
        </View>
      ) : null}
      {token && me ? (
        <>
          {msg ? <Text className="err">{msg}</Text> : null}
          <View className="card">
            <Text className="label">开始（例 2026-09-08T10:00）</Text>
            <Input
              className="input"
              value={startsAt}
              onInput={(e) => setStartsAt(e.detail.value)}
              placeholder="2026-09-08T10:00"
            />
            <Text className="label">结束</Text>
            <Input
              className="input"
              value={endsAt}
              onInput={(e) => setEndsAt(e.detail.value)}
              placeholder="2026-09-08T12:00"
            />
            <Text className="label">原因（可选）</Text>
            <Input
              className="input"
              value={reason}
              onInput={(e) => setReason(e.detail.value)}
              placeholder="外出"
            />
            <Button
              className="btn primary"
              disabled={busy}
              onClick={() => void add()}
            >
              添加不可接单时段
            </Button>
          </View>
          <View className="card">
            <Text className="strong">当前排期（{me.availability.length}）</Text>
            {me.availability.length === 0 ? (
              <Text className="muted">暂无不可接单时段。</Text>
            ) : null}
            {me.availability.map((a) => (
              <View key={a.id} className="row">
                <Text className="muted">
                  {new Date(a.startsAt).toLocaleString()} →{" "}
                  {new Date(a.endsAt).toLocaleString()}
                  {a.reason ? `（${a.reason}）` : ""}
                </Text>
                <Button
                  size="mini"
                  disabled={busy}
                  onClick={() => void remove(a.id)}
                >
                  删除
                </Button>
              </View>
            ))}
          </View>
        </>
      ) : null}
      <Button
        className="btn"
        onClick={() =>
          void Taro.reLaunch({ url: "/pages/player/profile/index" })
        }
      >
        返回资料
      </Button>
    </View>
  );
}

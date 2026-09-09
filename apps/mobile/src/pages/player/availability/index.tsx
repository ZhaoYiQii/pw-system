import { Button, Input, Text, View } from "@tarojs/components";
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

  const load = async (accessToken: string) => {
    try {
      setMe(
        await apiAdapter.request<PlayerMe>("/api/v1/tenant/player/me", {
          token: accessToken,
        }),
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
      setMsg("请填写合法的开始和结束时间。");
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
      setMsg("不可接时段已添加。");
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
      setMsg("时段已删除。");
      await load(token);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PlayerPage
      title="接单时间"
      subtitle="维护不能接单的具体时段"
      activeNav="profile"
      badge={
        me ? (
          <Text className="pw-badge pw-badge-live">
            {me.availability.length === 0
              ? "空闲中"
              : `${me.availability.length} 个时段`}
          </Text>
        ) : undefined
      }
    >
      {!token ? (
        <PlayerLoginCard
          tenantCode={tenantCode}
          username={username}
          password={password}
          busy={busy}
          actionLabel="登录并维护时间"
          onTenantCode={setTenantCode}
          onUsername={setUsername}
          onPassword={setPassword}
          onLogin={() => void login()}
        />
      ) : null}
      {msg ? (
        <PlayerMessage
          tone={
            msg === "不可接时段已添加。" || msg === "时段已删除。"
              ? "success"
              : "error"
          }
        >
          {msg}
        </PlayerMessage>
      ) : null}
      {token && me ? (
        <>
          <View className="pw-card pw-divider-list">
            {me.availability.length === 0 ? (
              <Text className="pw-empty">
                暂无不可接时段，当前默认为可接单。
              </Text>
            ) : null}
            {me.availability.map((item) => (
              <View key={item.id} className="availability-row">
                <View className="pw-row-copy">
                  <Text className="availability-time">
                    {new Date(item.startsAt).toLocaleString()}
                  </Text>
                  <Text className="pw-muted">
                    至 {new Date(item.endsAt).toLocaleString()}
                    {item.reason ? ` · ${item.reason}` : ""}
                  </Text>
                </View>
                <Button
                  className="availability-delete"
                  disabled={busy}
                  onClick={() => void remove(item.id)}
                >
                  删除
                </Button>
              </View>
            ))}
          </View>
          <View className="pw-card">
            <Text className="pw-card-title">添加不可接时段</Text>
            <View className="pw-field">
              <Text className="pw-field-label">开始时间</Text>
              <Input
                className="pw-input"
                value={startsAt}
                onInput={(event) => setStartsAt(event.detail.value)}
                placeholder="2026-09-08T19:00"
              />
            </View>
            <View className="pw-field">
              <Text className="pw-field-label">结束时间</Text>
              <Input
                className="pw-input"
                value={endsAt}
                onInput={(event) => setEndsAt(event.detail.value)}
                placeholder="2026-09-08T23:00"
              />
            </View>
            <View className="pw-field">
              <Text className="pw-field-label">备注（选填）</Text>
              <Input
                className="pw-input"
                value={reason}
                onInput={(event) => setReason(event.detail.value)}
                placeholder="例如：临时有事"
              />
            </View>
            <Button
              className="pw-button pw-button-dark"
              disabled={busy}
              onClick={() => void add()}
            >
              添加时段
            </Button>
          </View>
        </>
      ) : null}
    </PlayerPage>
  );
}

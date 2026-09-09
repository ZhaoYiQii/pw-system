import { Button, Text, View } from "@tarojs/components";
import { useLoad, useRouter } from "@tarojs/taro";
import { useState } from "react";
import { identityAdapter } from "@platform-identity";
import { session } from "@platform-session";
import { apiAdapter } from "@platform-api";
import {
  PlayerLoginCard,
  PlayerMessage,
  PlayerPage,
} from "../../../components/player-ui";
import "./index.css";

interface SignupLine {
  lineId: string;
  positionLabel: string;
  requiredCount: number;
  myApplicationId: string | null;
  myStatus: string | null;
}

export default function GameSignupPage() {
  const router = useRouter();
  const orderId = String(router.params.orderId ?? "");
  const tenant = String(router.params.tenant ?? "");
  const [token, setToken] = useState<string | null>(session.getToken());
  const [tenantCode, setTenantCode] = useState(tenant);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [lines, setLines] = useState<SignupLine[]>([]);
  const [status, setStatus] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = async (accessToken: string) => {
    try {
      const data = await apiAdapter.request<{
        status: string;
        lines: SignupLine[];
      }>(`/api/v1/tenant/game-dispatch/player/orders/${orderId}/signup`, {
        token: accessToken,
      });
      setStatus(data.status);
      setLines(data.lines);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    }
  };

  useLoad(() => {
    const accessToken = session.getToken();
    setToken(accessToken);
    if (accessToken) void load(accessToken);
  });

  const login = async () => {
    setMsg(null);
    try {
      const loginSession = await identityAdapter.login({
        kind: "tenant",
        tenantCode,
        username,
        password,
      });
      session.setToken(loginSession.accessToken);
      setToken(loginSession.accessToken);
      setPassword("");
      await load(loginSession.accessToken);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    }
  };

  const apply = async (lineId: string) => {
    if (!token) return;
    setMsg(null);
    try {
      await apiAdapter.request(
        `/api/v1/tenant/game-dispatch/orders/${orderId}/lines/${lineId}/applications`,
        { method: "POST", token, body: {} },
      );
      setMsg("岗位报名成功。");
      await load(token);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    }
  };

  const withdraw = async (applicationId: string) => {
    if (!token) return;
    setMsg(null);
    try {
      await apiAdapter.request(
        `/api/v1/tenant/game-dispatch/applications/${applicationId}/withdraw`,
        { method: "POST", token, body: {} },
      );
      setMsg("已撤销岗位报名。");
      await load(token);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    }
  };

  const isOpen = status === "DISPATCHING";

  return (
    <PlayerPage
      title="陪玩报名"
      subtitle={orderId ? `订单 ${orderId.slice(0, 10)}…` : "按岗位独立报名"}
      activeNav="orders"
      badge={
        token ? (
          <Text
            className={`pw-badge ${isOpen ? "pw-badge-live" : "pw-badge-wait"}`}
          >
            {isOpen ? "报名开放" : "报名关闭"}
          </Text>
        ) : undefined
      }
    >
      {!token ? (
        <PlayerLoginCard
          tenantCode={tenantCode}
          username={username}
          password={password}
          actionLabel="登录并查看可报岗位"
          onTenantCode={setTenantCode}
          onUsername={setUsername}
          onPassword={setPassword}
          onLogin={() => void login()}
        />
      ) : null}
      {msg ? (
        <PlayerMessage
          tone={
            msg.includes("成功") || msg.includes("已撤销") ? "success" : "error"
          }
        >
          {msg}
        </PlayerMessage>
      ) : null}
      {token ? (
        <>
          <View className="pw-card signup-intro">
            <Text className="pw-card-title">选择报名岗位</Text>
            <Text className="pw-muted">
              同一订单的不同岗位独立报名，门店选中后进入服务列表。
            </Text>
          </View>
          {lines.length === 0 ? (
            <Text className="pw-empty">当前订单没有可报名岗位。</Text>
          ) : null}
          {lines.map((line) => {
            const applied = line.myStatus === "APPLIED";
            return (
              <View key={line.lineId} className="pw-card">
                <View className="pw-row-between">
                  <View className="pw-row-copy">
                    <Text className="pw-card-title">{line.positionLabel}</Text>
                    <Text className="pw-muted">
                      需要 {line.requiredCount} 人
                    </Text>
                  </View>
                  <Text
                    className={`pw-badge ${applied ? "pw-badge-live" : "pw-badge-wait"}`}
                  >
                    {applied ? "我：已报名" : "未报名"}
                  </Text>
                </View>
                {applied ? (
                  <Button
                    className="pw-button pw-button-plain"
                    onClick={() =>
                      line.myApplicationId
                        ? void withdraw(line.myApplicationId)
                        : undefined
                    }
                  >
                    撤销报名
                  </Button>
                ) : (
                  <Button
                    className="pw-button pw-button-primary"
                    disabled={!isOpen}
                    onClick={() => void apply(line.lineId)}
                  >
                    报名这个岗位
                  </Button>
                )}
              </View>
            );
          })}
          <Text className="pw-footnote">
            报名截止后不可新增报名；每个岗位只保留一个有效报名记录。
          </Text>
        </>
      ) : null}
    </PlayerPage>
  );
}

import { Button, Input, Text, View } from "@tarojs/components";
import { useLoad, useRouter } from "@tarojs/taro";
import { useState, type CSSProperties } from "react";
import { identityAdapter } from "@platform-identity";
import { session } from "@platform-session";
import { apiAdapter } from "@platform-api";

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

  const load = async (t: string) => {
    try {
      const data = await apiAdapter.request<{
        status: string;
        lines: SignupLine[];
      }>(`/api/v1/tenant/game-dispatch/player/orders/${orderId}/signup`, {
        token: t,
      });
      setStatus(data.status);
      setLines(data.lines);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    }
  };

  useLoad(() => {
    const t = session.getToken();
    setToken(t);
    if (t) void load(t);
  });

  const login = async () => {
    setMsg(null);
    try {
      const s = await identityAdapter.login({
        kind: "tenant",
        tenantCode,
        username,
        password,
      });
      session.setToken(s.accessToken);
      setToken(s.accessToken);
      await load(s.accessToken);
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
      await load(token);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <View
      style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}
    >
      <Text style={{ fontSize: 20, fontWeight: "bold" }}>陪玩报名</Text>
      {msg ? <Text style={{ color: "#dc2626" }}>{msg}</Text> : null}
      {!token ? (
        <>
          <Input
            style={inputStyle}
            value={tenantCode}
            placeholder="门店 code"
            onInput={(e) => setTenantCode(e.detail.value)}
          />
          <Input
            style={inputStyle}
            value={username}
            placeholder="陪玩账号"
            onInput={(e) => setUsername(e.detail.value)}
          />
          <Input
            style={inputStyle}
            password
            value={password}
            placeholder="密码"
            onInput={(e) => setPassword(e.detail.value)}
          />
          <Button onClick={() => void login()}>登录并查看可报位置</Button>
        </>
      ) : (
        <>
          <Button size="mini" onClick={() => void load(token)}>
            刷新
          </Button>
          {lines.map((line) => (
            <View key={line.lineId} style={cardStyle}>
              <Text style={{ fontWeight: "bold" }}>
                {line.positionLabel}（需 {line.requiredCount} 人）
              </Text>
              {line.myStatus === "APPLIED" ? (
                <Button
                  size="mini"
                  onClick={() =>
                    line.myApplicationId
                      ? void withdraw(line.myApplicationId)
                      : undefined
                  }
                >
                  取消报名
                </Button>
              ) : (
                <Button
                  size="mini"
                  disabled={status !== "DISPATCHING"}
                  onClick={() => void apply(line.lineId)}
                >
                  报名
                </Button>
              )}
            </View>
          ))}
        </>
      )}
    </View>
  );
}

const inputStyle: CSSProperties = {
  border: "1px solid #d1d5db",
  borderRadius: 8,
  padding: 8,
  height: 40,
};
const cardStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: 12,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

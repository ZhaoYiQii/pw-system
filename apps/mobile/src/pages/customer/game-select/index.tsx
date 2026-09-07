import { Button, Input, Text, View } from "@tarojs/components";
import { useLoad, useRouter } from "@tarojs/taro";
import { useState, type CSSProperties } from "react";
import { identityAdapter } from "@platform-identity";
import { session } from "@platform-session";
import { apiAdapter } from "@platform-api";

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

export default function GameSelectPage() {
  const router = useRouter();
  const orderId = String(router.params.orderId ?? "");
  const tenant = String(router.params.tenant ?? "");
  const [token, setToken] = useState<string | null>(session.getToken());
  const [tenantCode, setTenantCode] = useState(tenant);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [lines, setLines] = useState<LineView[]>([]);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const load = async (t: string) => {
    try {
      const data = await apiAdapter.request<{ lines: LineView[] }>(
        `/api/v1/tenant/game-dispatch/customer/orders/${orderId}/select`,
        { token: t },
      );
      setLines(data.lines);
      setPicked({});
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

  const confirm = async () => {
    if (!token) return;
    const ids = Object.values(picked).filter(Boolean);
    setMsg(null);
    try {
      await apiAdapter.request(
        `/api/v1/tenant/game-dispatch/customer/orders/${orderId}/assignment`,
        { method: "POST", token, body: { applicationIds: ids } },
      );
      setMsg("已确认所选陪玩。");
      await load(token);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    }
  };

  const toggle = (lineId: string, appId: string) => {
    setPicked((prev) => ({
      ...prev,
      [lineId]: prev[lineId] === appId ? "" : appId,
    }));
  };

  return (
    <View
      style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}
    >
      <Text style={{ fontSize: 20, fontWeight: "bold" }}>选择陪玩</Text>
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
            placeholder="老板账号"
            onInput={(e) => setUsername(e.detail.value)}
          />
          <Input
            style={inputStyle}
            password
            value={password}
            placeholder="密码"
            onInput={(e) => setPassword(e.detail.value)}
          />
          <Button onClick={() => void login()}>登录并查看报名</Button>
        </>
      ) : (
        <>
          <Button size="mini" onClick={() => token && void load(token)}>
            刷新报名
          </Button>
          {lines.map((line) => (
            <View key={line.id} style={cardStyle}>
              <Text style={{ fontWeight: "bold" }}>
                {line.positionLabel}（需 {line.requiredCount} 人）
              </Text>
              {line.applications
                .filter((a) => a.status === "APPLIED")
                .map((app) => (
                  <View
                    key={app.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Text>{app.playerName}</Text>
                    <Button
                      size="mini"
                      disabled={picked[line.id] === app.id}
                      onClick={() => toggle(line.id, app.id)}
                    >
                      {picked[line.id] === app.id ? "已选" : "选择"}
                    </Button>
                  </View>
                ))}
            </View>
          ))}
          <Button
            disabled={Object.values(picked).filter(Boolean).length === 0}
            onClick={() => void confirm()}
          >
            确认陪玩
          </Button>
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
  flexDirection: "column",
  gap: 8,
};
